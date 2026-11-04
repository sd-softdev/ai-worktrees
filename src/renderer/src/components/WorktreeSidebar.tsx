import { useState, type FormEvent } from 'react'
import {
  Check,
  FolderGit2,
  GitBranch,
  Layers3,
  Plus,
  Trash2,
  Pencil,
  LockKeyhole,
  CircleAlert,
} from 'lucide-react'
import { leaves } from '../../../shared/layout'
import { defaultWorktreePreferences, type TaskStatus, type Worktree } from '../../../shared/types'
import { errorMessage, useApp } from '../store'
import { Modal } from './Modal'
import { APP_VERSION } from '../../../shared/version'

export const taskLabels: Record<TaskStatus, string> = {
  todo: 'Offen',
  working: 'In Arbeit',
  review: 'Review',
  done: 'Erledigt',
}

export function WorktreeSidebar() {
  const workspace = useApp((state) => state.workspace)!
  const preferences = useApp((state) => state.preferences)
  const terminals = useApp((state) => state.terminals)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Worktree | null>(null)
  const [removing, setRemoving] = useState<Worktree | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    setRemoveError(null)
    try {
      const updated = await window.desktop.removeWorktree(removing.path)
      useApp.getState().updateWorkspace(updated)
      setRemoving(null)
    } catch (error) {
      setRemoveError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="worktree-sidebar" aria-label="Worktrees">
      <div className="repository-card">
        <div className="repository-heading">
          <FolderGit2 size={22} />
          <strong>{workspace.name}</strong>
        </div>
        <span className="muted small">
          {workspace.remote ? `SSH · ${workspace.remote.host}` : 'Git-Repository'}
        </span>
        <span className="repository-path" title={workspace.rootPath}>
          {workspace.rootPath}
        </span>
        <div className="convention">
          <Layers3 size={13} />
          <span>
            Neue Worktrees unter <code>.worktrees/</code>
          </span>
        </div>
      </div>
      <div className="sidebar-heading">
        <h2>
          Worktrees <span className="count">{workspace.worktrees.length}</span>
        </h2>
      </div>
      <button className="primary-button new-worktree" onClick={() => setCreating(true)}>
        <Plus size={17} />
        Neuer Worktree
      </button>
      <div className="worktree-list">
        {workspace.worktrees.map((worktree) => {
          const settings = preferences.worktrees[worktree.path] ?? defaultWorktreePreferences()
          const running = settings.tabs
            .flatMap((tab) => leaves(tab.layout))
            .filter((leaf) => terminals[leaf.id]?.state === 'running').length
          const active = preferences.activeWorktree === worktree.path
          return (
            <div
              key={worktree.path}
              className={`worktree-card ${active ? 'active' : ''} ${worktree.missing ? 'missing' : ''}`}
            >
              <button
                className="worktree-select"
                disabled={worktree.missing}
                onClick={() => useApp.getState().selectWorktree(worktree.path)}
                title={worktree.path}
                aria-current={active ? 'true' : undefined}
              >
                <div className="worktree-name">
                  <FolderGit2 size={17} />
                  <strong>{worktree.branch || 'Detached HEAD'}</strong>
                  {active && <span className="active-badge">Aktiv</span>}
                </div>
                <div className="worktree-detail">
                  <GitBranch size={13} />
                  <span>{worktree.isMain ? 'Haupt-Worktree' : worktree.head.slice(0, 7)}</span>
                  {worktree.locked && <LockKeyhole size={12} />}
                </div>
                {settings.task && <div className="worktree-task">{settings.task}</div>}
                <div className="worktree-meta">
                  <span className={`task-status ${settings.status}`}>
                    <span className="dot" />
                    {taskLabels[settings.status]}
                  </span>
                  <span className="process-count">
                    {running > 0 ? `${running} Shell${running > 1 ? 's' : ''}` : 'Keine Shell'}
                  </span>
                </div>
                <div className="worktree-git">
                  {worktree.missing ? (
                    <>
                      <CircleAlert size={12} />
                      Verzeichnis fehlt
                    </>
                  ) : worktree.statusError ? (
                    <span title={worktree.statusError}>Git-Status nicht verfügbar</span>
                  ) : worktree.changedFiles > 0 ? (
                    <>
                      <span className="changed-dot" />
                      {worktree.changedFiles} geändert
                    </>
                  ) : (
                    <>
                      <Check size={12} />
                      Sauber
                    </>
                  )}
                </div>
              </button>
              <div className="worktree-actions">
                <button
                  className="icon-button"
                  title="Aufgabe bearbeiten"
                  aria-label={`Aufgabe für ${worktree.branch} bearbeiten`}
                  onClick={() => setEditing(worktree)}
                >
                  <Pencil size={13} />
                </button>
                {!worktree.isMain && (
                  <button
                    className="icon-button danger-hover"
                    title="Worktree entfernen"
                    aria-label={`Worktree ${worktree.branch} entfernen`}
                    onClick={() => {
                      setRemoveError(null)
                      setRemoving(worktree)
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="sidebar-footer">
        <span className="dot green" />
        {workspace.remote ? `SSH · ${workspace.remote.host}` : 'Lokaler Workspace'}
        <span className="version">v{APP_VERSION}</span>
      </div>
      {creating && <CreateWorktreeDialog onClose={() => setCreating(false)} />}
      {editing && <TaskDialog worktree={editing} onClose={() => setEditing(null)} />}
      {removing && (
        <Modal title="Worktree entfernen" onClose={() => !busy && setRemoving(null)}>
          <div className="modal-body">
            <p>
              Das Verzeichnis von <strong>{removing.branch || removing.path}</strong> wird entfernt.
              Der Branch und seine Commits bleiben erhalten.
            </p>
            <p className="muted">
              Lokale Änderungen oder laufende Terminals müssen vorher abgeschlossen werden.
            </p>
            {removeError && (
              <div className="inline-error" role="alert">
                {removeError}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="secondary-button" disabled={busy} onClick={() => setRemoving(null)}>
              Abbrechen
            </button>
            <button className="danger-button" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Entfernen …' : 'Worktree entfernen'}
            </button>
          </div>
        </Modal>
      )}
    </aside>
  )
}

function CreateWorktreeDialog({ onClose }: { onClose: () => void }) {
  const workspace = useApp((state) => state.workspace)!
  const [branch, setBranch] = useState('')
  const [base, setBase] = useState(workspace.defaultBase)
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const app = useApp.getState()
      await window.desktop.savePreferences(workspace.id, app.preferences)
      const result = await window.desktop.createWorktree({ branch: branch.trim(), base, task })
      // Keep the running sessions of existing worktrees mounted.
      app.updateWorkspace(result.workspace)
      app.updateWorktree(result.preferences.activeWorktree!, { task })
      app.selectWorktree(result.preferences.activeWorktree!)
      app.addTerminal(result.preferences.activeWorktree!)
      onClose()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Neuer Worktree" onClose={() => !busy && onClose()}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="modal-body form-stack">
          <p className="muted">Ein eigener Branch und Arbeitsbereich für deine nächste Aufgabe.</p>
          <label>
            Branch-Name
            <input
              autoFocus
              required
              value={branch}
              maxLength={200}
              placeholder="feat/auth-ui"
              onChange={(event) => setBranch(event.target.value)}
            />
          </label>
          <label>
            Ausgangsbranch
            <select value={base} onChange={(event) => setBase(event.target.value)}>
              {[...new Set([workspace.defaultBase, ...workspace.branches])].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Aufgabe <span className="muted">optional</span>
            <input
              value={task}
              maxLength={500}
              placeholder="Login-Oberfläche implementieren"
              onChange={(event) => setTask(event.target.value)}
            />
          </label>
          <div className="hint">
            <FolderGit2 size={15} />
            <span>
              Wird unter <code>{workspace.rootPath}/.worktrees/</code> angelegt.
            </span>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Abbrechen
          </button>
          <button className="primary-button" disabled={busy || !branch.trim()}>
            <Plus size={15} />
            {busy ? 'Erstellen …' : 'Worktree erstellen'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function TaskDialog({ worktree, onClose }: { worktree: Worktree; onClose: () => void }) {
  const settings =
    useApp.getState().preferences.worktrees[worktree.path] ?? defaultWorktreePreferences()
  const [task, setTask] = useState(settings.task)
  const [status, setStatus] = useState(settings.status)
  return (
    <Modal title="Aufgabe bearbeiten" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          useApp.getState().updateWorktree(worktree.path, { task, status })
          onClose()
        }}
      >
        <div className="modal-body form-stack">
          <label>
            Aufgabe
            <input
              autoFocus
              value={task}
              maxLength={500}
              placeholder="Woran arbeitest du hier?"
              onChange={(event) => setTask(event.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus)}
            >
              {Object.entries(taskLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Der Aufgabenstatus wird manuell gesetzt und ist unabhängig von den Terminalprozessen.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Abbrechen
          </button>
          <button className="primary-button">Speichern</button>
        </div>
      </form>
    </Modal>
  )
}
