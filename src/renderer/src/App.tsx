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
  TerminalSquare,
  X,
} from 'lucide-react'
import { leaves } from '../../shared/layout'
import { openWorkspace, refreshWorkspace, useApp } from './store'
import { WorktreeSidebar } from './components/WorktreeSidebar'
import { TerminalWorkspace } from './components/Terminals'
import { Inspector } from './components/Inspector'
import { ResizeHandle } from './components/ResizeHandle'

export function App() {
  const workspace = useApp((state) => state.workspace)
  const preferences = useApp((state) => state.preferences)
  const visited = useApp((state) => state.visited)
  const workspaceSession = useApp((state) => state.workspaceSession)
  const terminals = useApp((state) => state.terminals)
  const loading = useApp((state) => state.loading)
  const error = useApp((state) => state.error)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)
  const leftMax = Math.min(400, Math.floor(windowWidth * 0.3))
  const rightMax = Math.min(600, Math.floor(windowWidth * 0.36))
  const leftWidth = Math.min(preferences.leftWidth, leftMax)
  const rightWidth = Math.min(preferences.rightWidth, rightMax)
  const active = workspace?.worktrees.find(
    (worktree) => worktree.path === preferences.activeWorktree,
  )
  const running = Object.values(terminals).filter((terminal) => terminal.state === 'running').length
  const modifier = window.desktop.platform === 'darwin' ? '⌘' : 'Strg+'

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
    const timer = setInterval(() => {
      if (!document.hidden) void refreshWorkspace()
    }, 5000)
    return () => {
      unsubscribe()
      changed()
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
          <span className="tagline">Parallele Entwicklung. Ein Workspace.</span>
        </div>
        <span className="local-badge">
          <span className="dot green" />
          LOCAL
        </span>
      </header>
      <div className="toolbar">
        <button
          className="secondary-button open-workspace"
          disabled={loading}
          onClick={() => void openWorkspace()}
        >
          <FolderOpen size={17} />
          Workspace öffnen <span className="shortcut">{modifier}O</span>
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
              title="Workspace aktualisieren"
              aria-label="Workspace aktualisieren"
              onClick={() => void refreshWorkspace()}
            >
              <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            </button>
          </>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Fehlermeldung schließen"
            onClick={() => useApp.getState().setError(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {workspace ? (
        <main className="workspace-layout">
          <div className="left-panel" style={{ width: leftWidth }}>
            <WorktreeSidebar />
          </div>
          <ResizeHandle
            label="Breite der Worktree-Leiste"
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
                  key={`${workspaceSession}:${workspace.commonDir}:${path}`}
                  worktree={path}
                  visible={path === preferences.activeWorktree}
                />
              ))}
          </div>
          <ResizeHandle
            label="Breite der Git-Leiste"
            value={rightWidth}
            min={260}
            max={rightMax}
            invert
            onChange={(rightWidth) => useApp.getState().updatePreferences({ rightWidth })}
          />
          <div className="right-panel" style={{ width: rightWidth }}>
            {preferences.activeWorktree && <Inspector />}
          </div>
        </main>
      ) : (
        <main className="welcome">
          <div className="welcome-glow" />
          <div className="welcome-content">
            <div className="welcome-icon">
              <Layers3 size={42} strokeWidth={1.4} />
            </div>
            <div className="eyebrow">DEIN PROJEKT. MEHRERE PERSPEKTIVEN.</div>
            <h1>
              Ein Workspace.
              <br />
              <span>Viele Möglichkeiten.</span>
            </h1>
            <p>
              Gib jeder Aufgabe ihren eigenen Worktree.
              <br />
              Behalte deine Terminals, Agenten und Änderungen im Blick.
            </p>
            <button
              className="primary-button welcome-open"
              disabled={loading}
              onClick={() => void openWorkspace()}
            >
              <FolderOpen size={18} />
              {loading ? 'Workspace laden …' : 'Git-Repository öffnen'}
              <ArrowUpRight size={17} />
            </button>
            <div className="welcome-shortcut">
              <Command size={12} />
              <span>{modifier}O zum Öffnen</span>
            </div>
            <div className="welcome-features">
              <div>
                <GitBranch size={19} />
                <strong>Getrennte Worktrees</strong>
                <span>Ein Branch pro Aufgabe</span>
              </div>
              <div>
                <TerminalSquare size={19} />
                <strong>Echte Terminals</strong>
                <span>Deine Shell. Deine Agenten.</span>
              </div>
              <div>
                <Layers3 size={19} />
                <strong>Alles im Kontext</strong>
                <span>Änderungen direkt prüfen</span>
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
                <span className="yellow-text">{active.changedFiles} lokale Änderungen</span>
              ) : active?.statusError ? (
                <span>Git-Status nicht verfügbar</span>
              ) : (
                <>
                  <Check size={13} className="green-text" />
                  <span>Arbeitsverzeichnis sauber</span>
                </>
              )}
            </>
          ) : (
            <span>Bereit für deinen Workspace</span>
          )}
        </div>
        <div>
          <TerminalSquare size={13} />
          <span>Shells</span>
          <span className={`dot ${running ? 'green' : ''}`} />
          <span>{running} aktiv</span>
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
    </div>
  )
}
