import {
  app,
  autoUpdater as nativeUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  shell,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SettingsStore } from './settings'
import { TerminalService } from './terminals'
import { WorkspaceService } from './workspace'
import { configuredHosts } from './ssh/config'
import { SshAuthentication } from './ssh/auth'
import { SshConnection } from './ssh/connection'
import { SshBackend } from './ssh/backend'
import { UpdateService } from './updates'
import type { SshConnectInput } from '../shared/types'
import {
  createWorktreeSchema,
  diffSchema,
  idSchema,
  pathSchema,
  preferencesSchema,
  relativePathSchema,
  sizeSchema,
  sshConnectSchema,
} from './schema'

// Dedicated profile and workspace for repeatable desktop smoke tests.
if (process.env.AGENT_WORKSPACE_USER_DATA)
  app.setPath('userData', process.env.AGENT_WORKSPACE_USER_DATA)
app.setName('Agent Workspace')
app.commandLine.appendSwitch('lang', 'en-US')

let window: BrowserWindow | null = null
let closing = false
let confirmingClose = false
let updates: UpdateService
const settings = new SettingsStore(path.join(app.getPath('userData'), 'workspaces'))
const terminals = new TerminalService((event) => {
  if (window && !window.isDestroyed()) window.webContents.send('terminal:event', event)
})
const workspace = new WorkspaceService(settings, terminals)
let pendingRemote: SshBackend | null = null
const send = (channel: string, value: unknown) => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value)
}
const authentication = new SshAuthentication(
  path.join(app.getPath('userData'), 'ssh'),
  process.execPath,
  app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'out/main/askpass.js')
    : path.join(__dirname, 'askpass.js'),
  (prompt) => send('ssh:prompt', prompt),
  (id) => send('ssh:prompt-closed', id),
)

function remoteBackend(input: SshConnectInput): SshBackend {
  const backend = new SshBackend(
    new SshConnection(
      input,
      authentication,
      path.join(__dirname, '../remote/agent.cjs'),
      (message) => {
        if (workspace.backend !== backend) return
        terminals.closeAll()
        send('ssh:status', { state: 'disconnected', host: input.host, message })
      },
    ),
  )
  return backend
}

function requirePending(id: string): SshBackend {
  if (!pendingRemote || pendingRemote.connection.id !== id)
    throw new Error('SSH connection is no longer available.')
  return pendingRemote
}

async function restoreRemote(target: { host: string; nodePath: string; path: string }) {
  const backend = remoteBackend({ id: randomUUID(), host: target.host, nodePath: target.nodePath })
  try {
    await backend.connection.start()
    return await workspace.open(target.path, backend)
  } catch (error) {
    backend.close()
    throw error
  }
}

function trusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error('Unknown IPC sender.')
  }
}

function handle(channel: string, callback: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    trusted(event)
    return callback(...args)
  })
}

async function confirmWorkspaceSwitch(): Promise<boolean> {
  if (!terminals.hasRunning() || !window) return true
  const result = await dialog.showMessageBox(window, {
    type: 'question',
    message: 'Switch workspace?',
    detail: 'Running terminals in the current workspace will be stopped. The layout will be saved.',
    buttons: ['Cancel', 'Switch workspace'],
    defaultId: 0,
    cancelId: 0,
  })
  return result.response === 1
}

function registerIpc(): void {
  handle('updates:state', () => updates.snapshot)
  handle('updates:check', () => updates.check())
  handle('updates:download', () => updates.download())
  handle('updates:cancel', () => updates.cancel())
  handle('updates:install', () =>
    workspace.serialize(async () => {
      if (closing || confirmingClose || updates.snapshot.status !== 'downloaded')
        return updates.snapshot
      confirmingClose = true
      try {
        if (terminals.hasRunning() && window) {
          const result = await dialog.showMessageBox(window, {
            type: 'question',
            message: 'Install update and close Agent Workspace?',
            detail:
              'Running local and SSH terminals will be stopped. Your workspace layout will be saved and restored with new shells.',
            buttons: ['Cancel', 'Install update'],
            defaultId: 0,
            cancelId: 0,
          })
          if (result.response !== 1) return updates.snapshot
        }
        await settings.flush()
        const state = await updates.install()
        if (state.status === 'installing' && state.installation === 'dmg') {
          closing = true
          app.quit()
        }
        return state
      } finally {
        confirmingClose = false
      }
    }),
  )
  handle('workspace:bootstrap', () =>
    workspace.serialize(async () => {
      if (workspace.current) {
        if (
          workspace.current.remote &&
          workspace.backend instanceof SshBackend &&
          !workspace.backend.connection.connected
        ) {
          return restoreRemote({ ...workspace.current.remote, path: workspace.current.rootPath })
        }
        return {
          workspace: workspace.current,
          preferences: await settings.load(workspace.current.id),
        }
      }
      const directory = process.env.AGENT_WORKSPACE_OPEN || (await settings.lastWorkspace())
      if (directory) return workspace.open(directory)
      const remote = await settings.lastRemote()
      return remote ? restoreRemote(remote) : null
    }),
  )
  handle('workspace:open', () =>
    workspace.serialize(async () => {
      if (!window) return null
      const result = await dialog.showOpenDialog(window, {
        title: 'Open Git repository',
        properties: ['openDirectory'],
      })
      if (result.canceled || !result.filePaths[0] || !(await confirmWorkspaceSwitch())) return null
      return workspace.open(result.filePaths[0])
    }),
  )
  handle('workspace:refresh', () => workspace.serialize(() => workspace.refresh()))
  handle('ssh:hosts', () => configuredHosts())
  handle('ssh:connect', async (value) => {
    const input = sshConnectSchema.parse(value)
    pendingRemote?.close()
    const backend = remoteBackend(input)
    pendingRemote = backend
    try {
      await backend.connection.start()
      return await backend.browse('~')
    } catch (error) {
      backend.close()
      if (pendingRemote === backend) pendingRemote = null
      throw error
    }
  })
  handle('ssh:browse', (id, directory) =>
    requirePending(idSchema.parse(id)).browse(pathSchema.parse(directory)),
  )
  handle('ssh:open', (id, directory) => {
    const connectionId = idSchema.parse(id)
    const remotePath = pathSchema.parse(directory)
    return workspace.serialize(async () => {
      if (!(await confirmWorkspaceSwitch())) return null
      const backend = requirePending(connectionId)
      const result = await workspace.open(remotePath, backend)
      pendingRemote = null
      return result
    })
  })
  handle('ssh:cancel', (id) => {
    if (pendingRemote?.connection.id === idSchema.parse(id)) {
      pendingRemote.close()
      pendingRemote = null
    }
  })
  handle('ssh:reconnect', () =>
    workspace.serialize(async () => {
      const current = workspace.requireWorkspace()
      if (!current.remote) throw new Error('No SSH workspace is open.')
      return restoreRemote({ ...current.remote, path: current.rootPath })
    }),
  )
  ipcMain.on('ssh:answer', (event, id, answer) => {
    trusted(event)
    const input = z.tuple([idSchema, z.string().max(4096).nullable()]).safeParse([id, answer])
    if (input.success) authentication.answer(...input.data)
  })
  handle('worktree:create', (input) => {
    const value = createWorktreeSchema.parse(input)
    return workspace.serialize(() => workspace.create(value.branch, value.base, value.task))
  })
  handle('worktree:remove', (value) => {
    const worktreePath = pathSchema.parse(value)
    return workspace.serialize(() => workspace.remove(worktreePath))
  })
  handle('preferences:save', (commonDir, value) =>
    workspace.save(pathSchema.parse(commonDir), preferencesSchema.parse(value)),
  )
  handle('git:changes', (value) =>
    workspace.backend.changes(workspace.requireWorktree(pathSchema.parse(value)).path),
  )
  handle('git:history', (value) =>
    workspace.backend.history(workspace.requireWorktree(pathSchema.parse(value)).path),
  )
  handle('git:diff', (value, request) =>
    workspace.backend.diff(
      workspace.requireWorktree(pathSchema.parse(value)).path,
      diffSchema.parse(request),
    ),
  )
  handle('files:list', (value, relativePath) =>
    workspace.backend.listFiles(
      workspace.requireWorktree(pathSchema.parse(value)).path,
      relativePathSchema.parse(relativePath),
    ),
  )
  handle('files:read', (value, relativePath) =>
    workspace.backend.readFile(
      workspace.requireWorktree(pathSchema.parse(value)).path,
      relativePathSchema.parse(relativePath),
    ),
  )
  handle('terminal:open', (id, worktreePath, cols, rows) =>
    terminals.open(
      idSchema.parse(id),
      workspace.requireWorktree(pathSchema.parse(worktreePath)).path,
      sizeSchema.parse(cols),
      sizeSchema.parse(rows),
      workspace.backend.terminal?.(pathSchema.parse(worktreePath)),
    ),
  )
  handle('terminal:close', (id) => terminals.close(idSchema.parse(id)))
  ipcMain.on('terminal:write', (event, id, data) => {
    trusted(event)
    const validId = idSchema.safeParse(id)
    const validData = z
      .string()
      .max(1024 * 1024)
      .safeParse(data)
    if (validId.success && validData.success) terminals.write(validId.data, validData.data)
  })
  ipcMain.on('terminal:resize', (event, id, cols, rows) => {
    trusted(event)
    const input = z.tuple([idSchema, sizeSchema, sizeSchema]).safeParse([id, cols, rows])
    if (input.success) terminals.resize(...input.data)
  })
  ipcMain.on('terminal:acknowledge', (event, id, sequence) => {
    trusted(event)
    const input = z.tuple([idSchema, z.number().int().nonnegative()]).safeParse([id, sequence])
    if (input.success) terminals.acknowledge(...input.data)
  })
  handle('external:open', (value) => {
    const url = new URL(z.string().max(8192).parse(value))
    if (!['https:', 'http:'].includes(url.protocol))
      throw new Error('Only HTTP and HTTPS links are supported.')
    return shell.openExternal(url.toString())
  })
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#0c0e14',
    title: 'Agent Workspace',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 17, y: 19 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window?.show())
  window.on('focus', () => window?.webContents.send('workspace:changed'))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  window.on('close', (event) => {
    if (closing) return
    event.preventDefault()
    if (confirmingClose) return
    confirmingClose = true
    void (async () => {
      if (terminals.hasRunning() && window) {
        const result = await dialog.showMessageBox(window, {
          type: 'question',
          message: 'Close Agent Workspace?',
          detail:
            'Running terminal processes will be stopped. Your workspace layout will be saved.',
          buttons: ['Cancel', 'Quit'],
          defaultId: 0,
          cancelId: 0,
        })
        if (result.response !== 1) return
      }
      await settings.flush()
      workspace.close()
      pendingRemote?.close()
      closing = true
      window?.close()
    })()
      .catch((error) => dialog.showErrorBox('Could not close workspace', String(error)))
      .finally(() => {
        confirmingClose = false
      })
  })
  window.on('closed', () => {
    window = null
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'))
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  void app.whenReady().then(() => {
    updates = new UpdateService(
      autoUpdater,
      {
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        directory: path.join(app.getPath('userData'), 'updates'),
        fetch: (url, options) => net.fetch(url instanceof URL ? url.toString() : url, options),
        openFile: (filename) => shell.openPath(filename),
      },
      (state) => send('updates:state', state),
    )
    nativeUpdater.on('before-quit-for-update', () => {
      closing = true
    })
    registerIpc()
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'File',
        submenu: [
          {
            label: 'Open workspace …',
            accelerator: 'CmdOrCtrl+O',
            click: () => window?.webContents.send('workspace:open-requested'),
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        label: 'Help',
        submenu: [{ label: 'Check for updates …', click: () => send('updates:open', null) }],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    createWindow()
    if (app.isPackaged && process.env.AGENT_WORKSPACE_DISABLE_UPDATE_CHECK !== '1') {
      setTimeout(() => void updates.check(), 15_000).unref()
      setInterval(() => void updates.check(), 6 * 60 * 60_000).unref()
    }
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    updates?.cancel()
    workspace.close()
    pendingRemote?.close()
    authentication.dispose()
  })
}
