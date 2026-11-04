import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import path from 'node:path'
import { z } from 'zod'
import { changes, diff, history } from './git'
import { listFiles, readPreview } from './files'
import { SettingsStore } from './settings'
import { TerminalService } from './terminals'
import { WorkspaceService } from './workspace'
import {
  createWorktreeSchema,
  diffSchema,
  idSchema,
  pathSchema,
  preferencesSchema,
  relativePathSchema,
  sizeSchema,
} from './schema'

// Dedicated profile and workspace for repeatable desktop smoke tests.
if (process.env.AGENT_WORKSPACE_USER_DATA)
  app.setPath('userData', process.env.AGENT_WORKSPACE_USER_DATA)
app.setName('Agent Workspace')

let window: BrowserWindow | null = null
let closing = false
let confirmingClose = false
const settings = new SettingsStore(path.join(app.getPath('userData'), 'workspaces'))
const terminals = new TerminalService((event) => {
  if (window && !window.isDestroyed()) window.webContents.send('terminal:event', event)
})
const workspace = new WorkspaceService(settings, terminals)

function trusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    throw new Error('Unbekannter IPC-Absender.')
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
    message: 'Workspace wechseln?',
    detail:
      'Die laufenden Terminals des aktuellen Workspace werden beendet. Das Layout bleibt gespeichert.',
    buttons: ['Abbrechen', 'Workspace wechseln'],
    defaultId: 0,
    cancelId: 0,
  })
  return result.response === 1
}

function registerIpc(): void {
  handle('workspace:bootstrap', () =>
    workspace.serialize(async () => {
      if (workspace.current) {
        return {
          workspace: workspace.current,
          preferences: await settings.load(workspace.current.commonDir),
        }
      }
      const directory = process.env.AGENT_WORKSPACE_OPEN || (await settings.lastWorkspace())
      return directory ? workspace.open(directory) : null
    }),
  )
  handle('workspace:open', () =>
    workspace.serialize(async () => {
      if (!window) return null
      const result = await dialog.showOpenDialog(window, {
        title: 'Git-Repository öffnen',
        properties: ['openDirectory'],
      })
      if (result.canceled || !result.filePaths[0] || !(await confirmWorkspaceSwitch())) return null
      return workspace.open(result.filePaths[0])
    }),
  )
  handle('workspace:refresh', () => workspace.serialize(() => workspace.refresh()))
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
  handle('git:changes', (value) => changes(workspace.requireWorktree(pathSchema.parse(value)).path))
  handle('git:history', (value) => history(workspace.requireWorktree(pathSchema.parse(value)).path))
  handle('git:diff', (value, request) =>
    diff(workspace.requireWorktree(pathSchema.parse(value)).path, diffSchema.parse(request)),
  )
  handle('files:list', (value, relativePath) =>
    listFiles(
      workspace.requireWorktree(pathSchema.parse(value)).path,
      relativePathSchema.parse(relativePath),
    ),
  )
  handle('files:read', (value, relativePath) =>
    readPreview(
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
      throw new Error('Nur HTTP-Links werden unterstützt.')
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
          message: 'Agent Workspace schließen?',
          detail:
            'Die laufenden Terminalprozesse werden beendet. Dein Workspace-Layout bleibt gespeichert.',
          buttons: ['Abbrechen', 'Beenden'],
          defaultId: 0,
          cancelId: 0,
        })
        if (result.response !== 1) return
      }
      await settings.flush()
      terminals.closeAll()
      closing = true
      window?.close()
    })()
      .catch((error) => dialog.showErrorBox('Schließen fehlgeschlagen', String(error)))
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
    registerIpc()
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'Datei',
        submenu: [
          {
            label: 'Workspace öffnen …',
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
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => terminals.closeAll())
}
