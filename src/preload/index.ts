import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI, SequencedTerminalEvent } from '../shared/types'

const api: DesktopAPI = {
  platform: process.platform,
  updateState: () => ipcRenderer.invoke('updates:state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  cancelUpdate: () => ipcRenderer.invoke('updates:cancel'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value)
    ipcRenderer.on('updates:state', handler)
    return () => ipcRenderer.removeListener('updates:state', handler)
  },
  onUpdateRequested: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('updates:open', handler)
    return () => ipcRenderer.removeListener('updates:open', handler)
  },
  bootstrap: () => ipcRenderer.invoke('workspace:bootstrap'),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  sshHosts: () => ipcRenderer.invoke('ssh:hosts'),
  connectSsh: (input) => ipcRenderer.invoke('ssh:connect', input),
  browseSsh: (id, directory) => ipcRenderer.invoke('ssh:browse', id, directory),
  openSshWorkspace: (id, directory) => ipcRenderer.invoke('ssh:open', id, directory),
  cancelSsh: (id) => ipcRenderer.invoke('ssh:cancel', id),
  reconnectWorkspace: () => ipcRenderer.invoke('ssh:reconnect'),
  answerSshPrompt: (id, answer) => ipcRenderer.send('ssh:answer', id, answer),
  onSshPrompt: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value)
    ipcRenderer.on('ssh:prompt', handler)
    return () => ipcRenderer.removeListener('ssh:prompt', handler)
  },
  onSshPromptClosed: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id)
    ipcRenderer.on('ssh:prompt-closed', handler)
    return () => ipcRenderer.removeListener('ssh:prompt-closed', handler)
  },
  onRemoteStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) =>
      listener(value)
    ipcRenderer.on('ssh:status', handler)
    return () => ipcRenderer.removeListener('ssh:status', handler)
  },
  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),
  createWorktree: (input) => ipcRenderer.invoke('worktree:create', input),
  removeWorktree: (path) => ipcRenderer.invoke('worktree:remove', path),
  fetchRepository: (workspaceId) => ipcRenderer.invoke('git:fetch', workspaceId),
  pushWorktree: (workspaceId, path) => ipcRenderer.invoke('git:push', workspaceId, path),
  savePreferences: (commonDir, preferences) =>
    ipcRenderer.invoke('preferences:save', commonDir, preferences),
  getChanges: (path) => ipcRenderer.invoke('git:changes', path),
  getHistory: (path) => ipcRenderer.invoke('git:history', path),
  getReview: (path, preferences, force) =>
    ipcRenderer.invoke('reviews:get', path, preferences, force),
  getDiff: (path, request) => ipcRenderer.invoke('git:diff', path, request),
  listFiles: (worktree, relativePath) => ipcRenderer.invoke('files:list', worktree, relativePath),
  readFile: (worktree, relativePath) => ipcRenderer.invoke('files:read', worktree, relativePath),
  openTerminal: (id, worktree, cols, rows) =>
    ipcRenderer.invoke('terminal:open', id, worktree, cols, rows),
  writeTerminal: (id, data) => ipcRenderer.send('terminal:write', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  acknowledgeTerminal: (id, sequence) => ipcRenderer.send('terminal:acknowledge', id, sequence),
  closeTerminal: (id) => ipcRenderer.invoke('terminal:close', id),
  onTerminalEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, data: SequencedTerminalEvent) =>
      listener(data)
    ipcRenderer.on('terminal:event', handler)
    return () => ipcRenderer.removeListener('terminal:event', handler)
  },
  onWorkspaceChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('workspace:changed', handler)
    return () => ipcRenderer.removeListener('workspace:changed', handler)
  },
  onOpenRequested: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('workspace:open-requested', handler)
    return () => ipcRenderer.removeListener('workspace:open-requested', handler)
  },
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
}

contextBridge.exposeInMainWorld('desktop', api)
