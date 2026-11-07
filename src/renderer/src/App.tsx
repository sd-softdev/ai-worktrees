import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Command,
  FolderOpen,
  GitBranch,
  Layers3,
  RefreshCw,
  Server,
  Unplug,
  TerminalSquare,
  X,
} from 'lucide-react'
import { leaves } from '../../shared/layout'
import { openWorkspace, refreshWorkspace, useApp } from './store'
import { WorktreeSidebar } from './components/WorktreeSidebar'
import { TerminalWorkspace } from './components/Terminals'
import { Inspector } from './components/Inspector'
import { ResizeHandle } from './components/ResizeHandle'
import { SshConnectionDialog, SshPrompts } from './components/SshConnection'
import { Updates } from './components/Updates'
import { useReviewPolling } from './reviews'
import { useHookPolling } from './hooks'

export function App() {
  useReviewPolling()
  useHookPolling()
  const workspace = useApp((state) => state.workspace)
  const preferences = useApp((state) => state.preferences)
  const visited = useApp((state) => state.visited)
  const workspaceSession = useApp((state) => state.workspaceSession)
  const terminals = useApp((state) => state.terminals)
  const loading = useApp((state) => state.loading)
  const error = useApp((state) => state.error)
  const remoteStatus = useApp((state) => state.remoteStatus)
  const [sshDialog, setSshDialog] = useState(false)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const leftMax = Math.min(400, Math.floor(windowWidth * 0.3))
  const rightMax = Math.min(600, Math.floor(windowWidth * 0.36))
  const leftWidth = Math.min(preferences.leftWidth, leftMax)
  const rightWidth = Math.min(preferences.rightWidth, rightMax)
  const active = workspace?.worktrees.find(
    (worktree) => worktree.path === preferences.activeWorktree,
  )
  const running = Object.values(terminals).filter((terminal) => terminal.state === 'running').length
  const modifier = window.desktop.platform === 'darwin' ? '⌘' : 'Ctrl+'

  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    void window.desktop
      .bootstrap()
      .then((result) => {
        if (result) useApp.getState().acceptWorkspace(result)
      })
      .catch(useApp.getState().setError)
      .finally(() => useApp.getState().setLoading(false))
    const unsubscribe = window.desktop.onOpenRequested(() => void openWorkspace())
    const changed = window.desktop.onWorkspaceChanged(() => void refreshWorkspace())
    const remote = window.desktop.onRemoteStatus((status) =>
      useApp.getState().setRemoteStatus(status),
    )
    const timer = setInterval(() => {
      if (!document.hidden) void refreshWorkspace()
    }, 5000)
    return () => {
      unsubscribe()
      changed()
      remote()
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const modifierPressed = window.desktop.platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.altKey || document.querySelector('dialog[open]')) return
      const app = useApp.getState()
      const worktree = app.preferences.activeWorktree
      if (!worktree) return
      if (event.key.toLowerCase() === 't') {
        event.preventDefault()
        event.stopPropagation()
        app.addTerminal(worktree)
      }
      if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        event.stopPropagation()
        const settings = app.preferences.worktrees[worktree]
        const tab = settings?.tabs.find((item) => item.id === settings.activeTab)
        if (!tab) return
        const terminal =
          leaves(tab.layout).find((leaf) => leaf.id === app.focusedTerminal) ??
          leaves(tab.layout)[0]
        if (terminal)
          app.splitTerminal(worktree, terminal.id, event.shiftKey ? 'vertical' : 'horizontal')
      }
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  return (
    <div className={`app platform-${window.desktop.platform}`}>
      <header className="titlebar">
        <div className="brand">
          <Layers3 size={21} />
          <strong>Agent Workspace</strong>
          <span className="title-divider" />
          <span className="tagline">Parallel development. One workspace.</span>
        </div>
        <span className="local-badge">
          <span className="dot green" />
          {workspace?.remote ? `SSH · ${workspace.remote.host}` : 'LOCAL'}
        </span>
      </header>
      <div className="toolbar">
        <button
          className="secondary-button open-workspace"
          disabled={loading}
          onClick={() => void openWorkspace()}
        >
          <FolderOpen size={17} />
          Open workspace <span className="shortcut">{modifier}O</span>
        </button>
        <button className="secondary-button" disabled={loading} onClick={() => setSshDialog(true)}>
          <Server size={16} />
          Connect via SSH
        </button>
        {workspace && (
          <>
            <span className="toolbar-divider" />
            <div className="breadcrumb">
              <FolderOpen size={15} />
              <span>{workspace.name}</span>
              <ChevronRight size={14} />
              <GitBranch size={15} className="purple-text" />
              <strong>{active?.branch ?? 'Detached HEAD'}</strong>
            </div>
            <button
              className="icon-button refresh-workspace"
              title="Refresh workspace"
              aria-label="Refresh workspace"
              onClick={() => void refreshWorkspace()}
            >
              <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            </button>
          </>
        )}
      </div>
      {remoteStatus?.state === 'disconnected' && (
        <div className="remote-disconnected" role="status">
          <Unplug size={16} />
          <span>SSH connection to {remoteStatus.host} lost.</span>
          <button
            className="secondary-button"
            disabled={loading}
            title={remoteStatus.message}
            onClick={() => {
              useApp.getState().setLoading(true)
              void window.desktop
                .reconnectWorkspace()
                .then(useApp.getState().acceptWorkspace)
                .catch(useApp.getState().setError)
                .finally(() => useApp.getState().setLoading(false))
            }}
          >
            Reconnect
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => useApp.getState().setError(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {workspace ? (
        <main className="workspace-layout">
          <div className="left-panel" style={{ width: leftWidth }}>
            <WorktreeSidebar key={`${workspaceSession}:${workspace.id}`} />
          </div>
          <ResizeHandle
            label="Worktree sidebar width"
            value={leftWidth}
            min={190}
            max={leftMax}
            onChange={(leftWidth) => useApp.getState().updatePreferences({ leftWidth })}
          />
          <div className="center-panel">
            {visited
              .filter((path) =>
                workspace.worktrees.some((item) => item.path === path && !item.missing),
              )
              .map((path) => (
                <TerminalWorkspace
                  key={`${workspaceSession}:${workspace.id}:${path}`}
                  worktree={path}
                  visible={path === preferences.activeWorktree}
                />
              ))}
          </div>
          <ResizeHandle
            label="Git sidebar width"
            value={rightWidth}
            min={260}
            max={rightMax}
            invert
            onChange={(rightWidth) => useApp.getState().updatePreferences({ rightWidth })}
          />
          <div className="right-panel" style={{ width: rightWidth }}>
            {preferences.activeWorktree && <Inspector key={workspace.id} />}
          </div>
        </main>
      ) : (
        <main className="welcome">
          <div className="welcome-glow" />
          <div className="welcome-content">
            <div className="welcome-icon">
              <Layers3 size={42} strokeWidth={1.4} />
            </div>
            <div className="eyebrow">YOUR PROJECT. MULTIPLE PERSPECTIVES.</div>
            <h1>
              One workspace.
              <br />
              <span>Endless possibilities.</span>
            </h1>
            <p>
              Give every task its own worktree.
              <br />
              Keep your terminals, agents, and changes in view.
            </p>
            <button
              className="primary-button welcome-open"
              disabled={loading}
              onClick={() => void openWorkspace()}
            >
              <FolderOpen size={18} />
              {loading ? 'Loading workspace …' : 'Open Git repository'}
              <ArrowUpRight size={17} />
            </button>
            <button className="welcome-ssh" disabled={loading} onClick={() => setSshDialog(true)}>
              <Server size={14} />
              Connect to SSH host
              <ChevronRight size={13} />
            </button>
            <div className="welcome-shortcut">
              <Command size={12} />
              <span>{modifier}O to open</span>
            </div>
            <div className="welcome-features">
              <div>
                <GitBranch size={19} />
                <strong>Separate worktrees</strong>
                <span>One branch per task</span>
              </div>
              <div>
                <TerminalSquare size={19} />
                <strong>Real terminals</strong>
                <span>Your shell. Your agents.</span>
              </div>
              <div>
                <Layers3 size={19} />
                <strong>Everything in context</strong>
                <span>Review changes in place</span>
              </div>
            </div>
          </div>
        </main>
      )}
      <footer className="statusbar">
        <div>
          {workspace ? (
            <>
              <FolderOpen size={13} />
              <span>{workspace.name}</span>
              <span className="status-divider" />
              <GitBranch size={13} />
              <span>{active?.branch ?? 'Detached HEAD'}</span>
              <span className="status-divider" />
              {active?.changedFiles ? (
                <span className="yellow-text">
                  {active.changedFiles} changed {active.changedFiles === 1 ? 'file' : 'files'}
                </span>
              ) : active?.statusError ? (
                <span>Git status unavailable</span>
              ) : (
                <>
                  <Check size={13} className="green-text" />
                  <span>Working directory clean</span>
                </>
              )}
            </>
          ) : (
            <span>Ready for your workspace</span>
          )}
        </div>
        <div>
          <Updates />
          <span className="status-divider" />
          <TerminalSquare size={13} />
          <span>Shells</span>
          <span className={`dot ${running ? 'green' : ''}`} />
          <span>{running} active</span>
          <span className="status-divider" />
          <span>
            {window.desktop.platform === 'darwin'
              ? 'macOS'
              : window.desktop.platform === 'win32'
                ? 'Windows'
                : 'Linux'}
          </span>
        </div>
      </footer>
      {sshDialog && <SshConnectionDialog onClose={() => setSshDialog(false)} />}
      <SshPrompts />
    </div>
  )
}
