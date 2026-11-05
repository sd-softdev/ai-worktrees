import { useEffect, useState } from 'react'
import {
  ArrowUpCircle,
  CheckCheck,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import type { UpdateState } from '../../../shared/types'
import { APP_VERSION } from '../../../shared/version'
import { errorMessage } from '../store'
import { Modal } from './Modal'

const releases = 'https://github.com/sd-softdev/ai-worktrees/releases'

export function Updates() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const act = (action: () => Promise<UpdateState>) => {
    setError(null)
    void action()
      .then(setState)
      .catch((error) => setError(errorMessage(error)))
  }

  useEffect(() => {
    let active = true
    let received = false
    const unsubscribe = window.desktop.onUpdateState((value) => {
      received = true
      if (active) setState(value)
    })
    void window.desktop
      .updateState()
      .then((value) => {
        if (active && !received) setState(value)
      })
      .catch((error) => {
        if (active) setError(errorMessage(error))
      })
    const requested = window.desktop.onUpdateRequested(() => {
      setOpen(true)
      act(() => window.desktop.checkForUpdates())
    })
    return () => {
      active = false
      unsubscribe()
      requested()
    }
  }, [])

  const status = state?.status ?? 'idle'
  const busy = ['checking', 'downloading', 'installing'].includes(status) || installing
  const available = ['available', 'downloaded'].includes(status)
  const message = {
    idle: 'Check for a newer version of Agent Workspace.',
    checking: 'Checking for updates …',
    available: `Version ${state?.version} is available.`,
    'up-to-date': 'You are using the latest version.',
    downloading: 'Downloading and verifying the update …',
    downloaded: 'The update is verified and ready to install.',
    installing: 'Preparing the update and restarting Agent Workspace …',
    error: 'The update could not be completed. You can try again.',
    unsupported:
      'Updates are available in installed release builds. On Linux, use the AppImage or DEB package.',
  }[status]
  const install = async () => {
    setInstalling(true)
    setError(null)
    try {
      setState(await window.desktop.installUpdate())
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <>
      <button
        className={`update-button ${available ? 'update-available' : ''}`}
        aria-label="Updates"
        title={available ? `Update to ${state?.version}` : 'Check for updates'}
        onClick={() => {
          setOpen(true)
          if (status === 'idle') act(() => window.desktop.checkForUpdates())
        }}
      >
        {busy ? <LoaderCircle size={13} className="spinning" /> : <ArrowUpCircle size={13} />}
        {available ? 'Update available' : `v${state?.currentVersion ?? APP_VERSION}`}
      </button>
      {open && (
        <Modal title="Updates" onClose={() => setOpen(false)}>
          <div className="modal-body update-content">
            <p className="muted">
              Installed version: <strong>{state?.currentVersion ?? APP_VERSION}</strong>
            </p>
            <div className="update-status" role="status">
              {busy ? (
                <LoaderCircle size={20} className="spinning" />
              ) : status === 'up-to-date' ? (
                <CheckCheck size={20} />
              ) : (
                <ArrowUpCircle size={20} />
              )}
              <strong>{message}</strong>
            </div>
            {status === 'downloading' && (
              <div className="update-progress">
                <progress
                  max={100}
                  value={state?.progress ?? 0}
                  aria-label="Update download progress"
                />
                <span>
                  {Math.floor(state?.progress ?? 0)}%
                  {state?.total
                    ? ` · ${Math.floor((state.transferred ?? 0) / 1024 ** 2)} / ${Math.ceil(state.total / 1024 ** 2)} MB`
                    : ''}
                </span>
              </div>
            )}
            {state?.installation === 'mac' ? (
              <>
                <p className="muted">
                  Restart &amp; install replaces this app in its current installation folder and
                  launches the updated version. Your workspace data stays in place.
                </p>
                <p className="update-installation-path">
                  Installation: <code>{state.installationPath}</code>
                </p>
              </>
            ) : (
              <p className="muted">
                Updates are downloaded and installed only when you choose. Installation restarts the
                app and may request administrator permission.
              </p>
            )}
            <p className="muted">
              Your workspace layout is preserved. Running local and SSH terminals require
              confirmation before closing and restart as new shells.
            </p>
            {(error || state?.error) && (
              <div className="inline-error" role="alert">
                {error || state?.error}
              </div>
            )}
            {state?.checkedAt && (
              <p className="muted small">
                Last checked: {new Date(state.checkedAt).toLocaleString('en')}
              </p>
            )}
          </div>
          <div className="modal-footer update-actions">
            <button
              className="secondary-button"
              onClick={() =>
                void window.desktop
                  .openExternal(
                    state?.version
                      ? `${releases}/tag/v${encodeURIComponent(state.version)}`
                      : `${releases}/latest`,
                  )
                  .catch((error) => setError(errorMessage(error)))
              }
            >
              <ExternalLink size={14} /> Release notes
            </button>
            {status === 'downloading' ? (
              <button
                className="secondary-button"
                onClick={() =>
                  void window.desktop.cancelUpdate().catch((error) => setError(errorMessage(error)))
                }
              >
                Cancel download
              </button>
            ) : status === 'downloaded' ? (
              <button
                className="primary-button"
                disabled={installing}
                onClick={() => void install()}
              >
                <RefreshCw size={15} />
                Restart &amp; install
              </button>
            ) : (
              <>
                <button
                  className="secondary-button"
                  disabled={busy || status === 'unsupported'}
                  onClick={() => act(() => window.desktop.checkForUpdates())}
                >
                  <RefreshCw size={14} /> Check for updates
                </button>
                {(status === 'available' || (status === 'error' && state?.version)) && (
                  <button
                    className="primary-button"
                    onClick={() => act(() => window.desktop.downloadUpdate())}
                  >
                    <Download size={15} /> Download update
                  </button>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
