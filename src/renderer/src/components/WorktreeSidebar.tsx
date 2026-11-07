import { useState, type FormEvent, type ReactNode } from 'react'
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
  Download,
  Upload,
  GripVertical,
  LoaderCircle,
} from 'lucide-react'
import { leaves } from '../../../shared/layout'
import { orderedWorktrees } from '../../../shared/worktree-order'
import { defaultWorktreePreferences, type TaskStatus, type Worktree } from '../../../shared/types'
import { ReviewBadge } from './Reviews'
import { errorMessage, refreshWorkspace, useApp } from '../store'
import { Modal } from './Modal'
import { APP_VERSION } from '../../../shared/version'

export const taskLabels: Record<TaskStatus, string> = {
  todo: 'To do',
  working: 'In progress',
  review: 'Review',
  done: 'Done',
}

export function WorktreeSidebar() {
  const workspace = useApp((state) => state.workspace)!
  const preferences = useApp((state) => state.preferences)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Worktree | null>(null)
  const [removing, setRemoving] = useState<Worktree | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ path: string; placement: 'before' | 'after' } | null>(null)
  const base = workspace.worktrees.find((item) => item.isMain)
  const worktrees = orderedWorktrees(workspace.worktrees, preferences.worktreeOrder)
  const stopDragging = () => {
    setDragging(null)
    setDrop(null)
  }
  const requestRemoval = (worktree: Worktree) => {
    setRemoveError(null)
    setRemoving(worktree)
  }

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
          {workspace.remote ? `SSH · ${workspace.remote.host}` : 'Git repository'}
        </span>
        <span className="repository-path" title={workspace.rootPath}>
          {workspace.rootPath}
        </span>
        <div className="convention">
          <Layers3 size={13} />
          <span>
            New worktrees in <code>.worktrees/</code>
          </span>
        </div>
      </div>
      {base && (
        <section className="base-repository" aria-label="Base repository">
          <div className="sidebar-heading">
            <h2>Base repository</h2>
          </div>
          <WorktreeCard worktree={base} onEdit={setEditing} onRemove={requestRemoval} />
        </section>
      )}
      <div className="sidebar-heading">
        <h2>
          Worktrees <span className="count">{worktrees.length}</span>
        </h2>
      </div>
      <button className="primary-button new-worktree" onClick={() => setCreating(true)}>
        <Plus size={17} />
        New worktree
      </button>
      <div className="worktree-list">
        {worktrees.map((worktree, index) => (
          <div
            key={worktree.path}
            className={`worktree-drop-target ${dragging === worktree.path ? 'dragging' : ''} ${drop?.path === worktree.path ? `drop-${drop.placement}` : ''}`}
            onDragOver={(event) => {
              if (!dragging || dragging === worktree.path) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              const rect = event.currentTarget.getBoundingClientRect()
              setDrop({
                path: worktree.path,
                placement: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
              })
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null)
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (
                dragging &&
                drop?.path === worktree.path &&
                event.dataTransfer.getData('text/plain') === dragging
              )
                useApp.getState().moveWorktree(dragging, worktree.path, drop.placement)
              stopDragging()
            }}
          >
            <WorktreeCard
              worktree={worktree}
              onEdit={setEditing}
              onRemove={requestRemoval}
              dragHandle={
                <button
                  className="worktree-drag-handle"
                  draggable={worktrees.length > 1}
                  disabled={worktrees.length < 2}
                  aria-label={`Reorder worktree ${worktree.branch || worktree.path}`}
                  title={
                    worktrees.length > 1
                      ? 'Drag to reorder, or use Arrow Up / Arrow Down'
                      : 'Create a second worktree to reorder'
                  }
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', worktree.path)
                    const card = event.currentTarget.closest('.worktree-card')
                    if (card) event.dataTransfer.setDragImage(card, 20, 20)
                    setDragging(worktree.path)
                  }}
                  onDragEnd={stopDragging}
                  onKeyDown={(event) => {
                    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
                    event.preventDefault()
                    const previous = event.key === 'ArrowUp'
                    const target = worktrees[index + (previous ? -1 : 1)]
                    if (target)
                      useApp
                        .getState()
                        .moveWorktree(worktree.path, target.path, previous ? 'before' : 'after')
                  }}
                >
                  <GripVertical size={14} />
                  Reorder
                </button>
              }
            />
          </div>
        ))}
        {worktrees.length === 0 && (
          <p className="worktree-empty">Create a worktree for your next task.</p>
        )}
      </div>
      <div className="sidebar-footer">
        <span className="dot green" />
        {workspace.remote ? `SSH · ${workspace.remote.host}` : 'Local workspace'}
        <span className="version">v{APP_VERSION}</span>
      </div>
      {creating && <CreateWorktreeDialog onClose={() => setCreating(false)} />}
      {editing && <TaskDialog worktree={editing} onClose={() => setEditing(null)} />}
      {removing && (
        <Modal title="Remove worktree" onClose={() => !busy && setRemoving(null)}>
          <div className="modal-body">
            <p>
              The directory for <strong>{removing.branch || removing.path}</strong> will be removed.
              Its branch and commits will be preserved.
            </p>
            <p className="muted">Commit or save local changes and close running terminals first.</p>
            {removeError && (
              <div className="inline-error" role="alert">
                {removeError}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="secondary-button" disabled={busy} onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button className="danger-button" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Removing …' : 'Remove worktree'}
            </button>
          </div>
        </Modal>
      )}
    </aside>
  )
}

function WorktreeCard({
  worktree,
  onEdit,
  onRemove,
  dragHandle,
}: {
  worktree: Worktree
  onEdit: (worktree: Worktree) => void
  onRemove: (worktree: Worktree) => void
  dragHandle?: ReactNode
}) {
  const workspaceId = useApp((state) => state.workspace!.id)
  const settings =
    useApp((state) => state.preferences.worktrees[worktree.path]) ?? defaultWorktreePreferences()
  const active = useApp((state) => state.preferences.activeWorktree === worktree.path)
  const terminals = useApp((state) => state.terminals)
  const disconnected = useApp((state) => state.remoteStatus?.state === 'disconnected')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ error: boolean; message: string } | null>(null)
  const running = settings.tabs
    .flatMap((tab) => leaves(tab.layout))
    .filter((leaf) => terminals[leaf.id]?.state === 'running').length
  const sync = async () => {
    if (pending) return
    setPending(true)
    setResult(null)
    try {
      const message = worktree.isMain
        ? await window.desktop.fetchRepository(workspaceId)
        : await window.desktop.pushWorktree(workspaceId, worktree.path)
      setResult({ error: false, message })
      await refreshWorkspace()
    } catch (error) {
      setResult({ error: true, message: errorMessage(error) })
    } finally {
      setPending(false)
    }
  }
  return (
    <div
      className={`worktree-card ${worktree.isMain ? 'base-worktree' : ''} ${active ? 'active' : ''} ${worktree.missing ? 'missing' : ''}`}
    >
      <button
        className="worktree-select"
        disabled={worktree.missing}
        onClick={() => useApp.getState().selectWorktree(worktree.path)}
        title={worktree.path}
        aria-current={active ? 'true' : undefined}
      >
        <div className="worktree-name">
          {worktree.isMain ? <FolderGit2 size={17} /> : <GitBranch size={17} />}
          <strong>{worktree.branch || 'Detached HEAD'}</strong>
          {active && <span className="active-badge">Active</span>}
        </div>
        <div className="worktree-detail">
          <span>{worktree.isMain ? 'Main checkout' : worktree.head.slice(0, 7)}</span>
          {worktree.locked && <LockKeyhole size={12} />}
        </div>
        {settings.task && <div className="worktree-task">{settings.task}</div>}
        <div className="worktree-meta">
          {!worktree.isMain && (
            <span className={`task-status ${settings.status}`}>
              <span className="dot" />
              {taskLabels[settings.status]}
            </span>
          )}
          <span className="process-count">
            {running > 0 ? `${running} shell${running > 1 ? 's' : ''}` : 'No shells'}
          </span>
        </div>
        <div className="worktree-git">
          {worktree.missing ? (
            <>
              <CircleAlert size={12} />
              Directory missing
            </>
          ) : worktree.statusError ? (
            <span title={worktree.statusError}>Git status unavailable</span>
          ) : worktree.changedFiles > 0 ? (
            <>
              <span className="changed-dot" />
              {worktree.changedFiles} changed
            </>
          ) : (
            <>
              <Check size={12} />
              Clean
            </>
          )}
        </div>
        <ReviewBadge worktree={worktree} />
      </button>
      <div className="worktree-actions">
        {dragHandle}
        <button
          className="worktree-sync"
          disabled={
            pending || worktree.missing || disconnected || (!worktree.isMain && !worktree.branch)
          }
          aria-label={
            worktree.isMain
              ? 'Fetch base repository'
              : `Push worktree ${worktree.branch || worktree.path}`
          }
          title={
            worktree.isMain
              ? 'Fetch all remotes'
              : worktree.branch
                ? 'Push this branch'
                : 'Check out a branch to push'
          }
          onClick={() => void sync()}
        >
          {pending ? (
            <LoaderCircle size={13} className="spinning" />
          ) : worktree.isMain ? (
            <Download size={13} />
          ) : (
            <Upload size={13} />
          )}
          {pending
            ? worktree.isMain
              ? 'Fetching …'
              : 'Pushing …'
            : worktree.isMain
              ? 'Fetch'
              : 'Push'}
        </button>
        <button
          className="icon-button worktree-edit"
          title="Edit task"
          aria-label={`Edit task for ${worktree.branch}`}
          onClick={() => onEdit(worktree)}
        >
          <Pencil size={13} />
        </button>
        {!worktree.isMain && (
          <button
            className="icon-button danger-hover"
            disabled={pending}
            title="Remove worktree"
            aria-label={`Remove worktree ${worktree.branch}`}
            onClick={() => onRemove(worktree)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {result && (
        <div
          className={`git-operation-result ${result.error ? 'error' : ''}`}
          role={result.error ? 'alert' : 'status'}
        >
          {result.message}
        </div>
      )}
    </div>
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
    <Modal title="New worktree" onClose={() => !busy && onClose()}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="modal-body form-stack">
          <p className="muted">A separate branch and working directory for your next task.</p>
          <label>
            Branch name
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
            Base branch
            <select value={base} onChange={(event) => setBase(event.target.value)}>
              {[...new Set([workspace.defaultBase, ...workspace.branches])].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Task <span className="muted">optional</span>
            <input
              value={task}
              maxLength={500}
              placeholder="Implement the login screen"
              onChange={(event) => setTask(event.target.value)}
            />
          </label>
          <div className="hint">
            <FolderGit2 size={15} />
            <span>
              Created in <code>{workspace.rootPath}/.worktrees/</code>.
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
            Cancel
          </button>
          <button className="primary-button" disabled={busy || !branch.trim()}>
            <Plus size={15} />
            {busy ? 'Creating …' : 'Create worktree'}
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
    <Modal title="Edit task" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          useApp.getState().updateWorktree(worktree.path, { task, status })
          onClose()
        }}
      >
        <div className="modal-body form-stack">
          <label>
            Task
            <input
              autoFocus
              value={task}
              maxLength={500}
              placeholder="What are you working on here?"
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
            Task status is set manually and is independent of terminal processes.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button">Save</button>
        </div>
      </form>
    </Modal>
  )
}
