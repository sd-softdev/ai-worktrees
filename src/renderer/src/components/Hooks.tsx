import { useState, type FormEvent } from 'react'
import { LoaderCircle, Plus, RotateCw, Square, Trash2, Zap } from 'lucide-react'
import type { WorktreeHook } from '../../../shared/types'
import { errorMessage, useApp } from '../store'
import { Modal } from './Modal'

export function HookSettings({ onClose }: { onClose: () => void }) {
  const workspace = useApp((state) => state.workspace)!
  const [draft, setDraft] = useState(() => structuredClone(useApp.getState().preferences.hooks))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const change = (id: string, value: Partial<WorktreeHook>) =>
    setDraft((old) => ({
      ...old,
      created: old.created.map((hook) => (hook.id === id ? { ...hook, ...value } : hook)),
    }))
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const state = useApp.getState()
      const hooks = {
        ...draft,
        created: draft.created.map((hook) => ({
          ...hook,
          command: hook.command.trim(),
          name: hook.name.trim(),
          args: hook.args.filter((arg) => arg.length > 0),
        })),
      }
      await window.desktop.savePreferences(workspace.id, { ...state.preferences, hooks })
      if (useApp.getState().workspace?.id === workspace.id)
        useApp.getState().updatePreferences({ hooks })
      onClose()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal title="Workspace hooks" wide onClose={() => !saving && onClose()}>
      <form onSubmit={(event) => void save(event)}>
        <div className="modal-body hook-settings">
          <h3>Worktree created</h3>
          <p className="muted">
            Enabled hooks run in order after creation, before the first terminal opens.
            {workspace.remote
              ? ` They execute on SSH host ${workspace.remote.host}.`
              : ' They execute on this computer.'}
          </p>
          <p className="small muted">
            Working directory: the new worktree. Available environment variables:
            <code> WORKTREE_PATH</code>, <code>WORKTREE_BRANCH</code>, <code>REPOSITORY_PATH</code>{' '}
            and <code>WORKTREE_EVENT</code>.
          </p>
          <label className="form-stack">
            Node.js executable
            <input
              value={draft.nodePath}
              required
              maxLength={4096}
              onChange={(event) => setDraft({ ...draft, nodePath: event.target.value })}
            />
            <span className="small muted">
              JavaScript and TypeScript use Node.js on the execution host. TypeScript requires
              22.18+ and runs directly, without tsx.
            </span>
          </label>
          {draft.created.map((hook, index) => (
            <fieldset className="hook-editor" key={hook.id}>
              <legend>Hook {index + 1}</legend>
              <div className="hook-editor-heading">
                <label>
                  <input
                    type="checkbox"
                    checked={hook.enabled}
                    onChange={(event) => change(hook.id, { enabled: event.target.checked })}
                  />{' '}
                  Enabled
                </label>
                <button
                  type="button"
                  className="icon-button danger-hover"
                  aria-label={`Remove hook ${index + 1}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      created: draft.created.filter((item) => item.id !== hook.id),
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <label>
                Name
                <input
                  value={hook.name}
                  required
                  maxLength={160}
                  onChange={(event) => change(hook.id, { name: event.target.value })}
                />
              </label>
              <label>
                Type
                <select
                  value={hook.kind}
                  onChange={(event) =>
                    change(hook.id, { kind: event.target.value as WorktreeHook['kind'] })
                  }
                >
                  <option value="shell">Shell command</option>
                  <option value="javascript">JavaScript file</option>
                  <option value="typescript">TypeScript file</option>
                </select>
              </label>
              <label>
                {hook.kind === 'shell' ? 'Command' : 'Script path'}
                <textarea
                  rows={hook.kind === 'shell' ? 3 : 2}
                  required
                  value={hook.command}
                  maxLength={16_384}
                  placeholder={hook.kind === 'shell' ? 'npm ci' : 'scripts/setup.ts'}
                  onChange={(event) => change(hook.id, { command: event.target.value })}
                />
              </label>
              {hook.kind !== 'shell' && (
                <label>
                  Arguments (one per line)
                  <textarea
                    rows={2}
                    value={hook.args.join('\n')}
                    onChange={(event) => change(hook.id, { args: event.target.value.split('\n') })}
                  />
                </label>
              )}
              <label>
                Timeout (seconds)
                <input
                  type="number"
                  min={1}
                  max={3600}
                  required
                  value={hook.timeoutSeconds}
                  onChange={(event) =>
                    change(hook.id, { timeoutSeconds: Number(event.target.value) })
                  }
                />
              </label>
              <p className="small muted">
                {hook.kind === 'shell'
                  ? 'Uses your shell (cmd.exe on Windows). Standard input is closed.'
                  : 'Paths are relative to the new worktree, or absolute. Arguments are passed literally.'}
              </p>
            </fieldset>
          ))}
          <button
            type="button"
            className="secondary-button"
            disabled={draft.created.length >= 16}
            onClick={() =>
              setDraft({
                ...draft,
                created: [
                  ...draft.created,
                  {
                    id: crypto.randomUUID(),
                    name: 'Setup',
                    enabled: true,
                    kind: 'shell',
                    command: '',
                    args: [],
                    timeoutSeconds: 300,
                  },
                ],
              })
            }
          >
            <Plus size={15} />
            Add hook
          </button>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? 'Saving …' : 'Save hooks'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function HookStatus({ worktree }: { worktree: string }) {
  const workspace = useApp((state) => state.workspace)!
  const run = workspace.hookRuns?.[worktree]
  const disconnected = useApp((state) => state.remoteStatus?.state === 'disconnected')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!run) return null
  const running = run.status === 'running'
  const act = async (retry: boolean) => {
    setBusy(true)
    setError(null)
    try {
      if (retry) {
        const runs = await window.desktop.retryHooks(workspace.id, worktree)
        useApp.getState().updateHookRuns(workspace.id, runs)
      } else await window.desktop.cancelHooks(workspace.id, worktree)
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={`hook-status ${run.status}`} aria-label="Worktree setup">
      <div className="hook-status-heading">
        {running ? <LoaderCircle size={15} className="spinning" /> : <Zap size={15} />}
        <strong role="status">
          {running
            ? `Setup ${run.step}/${run.total}: ${run.name}`
            : run.status === 'succeeded'
              ? 'Setup complete'
              : run.status === 'cancelled'
                ? 'Setup cancelled'
                : 'Setup failed'}
        </strong>
        {running ? (
          <button
            className="secondary-button"
            disabled={busy || disconnected}
            onClick={() => void act(false)}
          >
            <Square size={12} />
            Cancel setup
          </button>
        ) : (
          run.status !== 'succeeded' && (
            <button
              className="secondary-button"
              disabled={busy || disconnected}
              onClick={() => void act(true)}
            >
              <RotateCw size={13} />
              Retry setup
            </button>
          )
        )}
      </div>
      {(error || run.error) && <p className="hook-error">{error || run.error}</p>}
      <details open={run.status !== 'succeeded'}>
        <summary>Setup output</summary>
        <pre className="hook-output">{run.output || 'Waiting for output …'}</pre>
      </details>
    </section>
  )
}
