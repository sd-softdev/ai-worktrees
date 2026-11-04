import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  ChevronRight,
  Folder,
  Home,
  KeyRound,
  LoaderCircle,
  Server,
  ShieldCheck,
} from 'lucide-react'
import type { RemoteDirectory, SshHost, SshPrompt } from '../../../shared/types'
import { errorMessage, useApp } from '../store'
import { Modal } from './Modal'

export function SshConnectionDialog({ onClose }: { onClose: () => void }) {
  const current = useApp.getState().workspace
  const [hosts, setHosts] = useState<SshHost[]>([])
  const [host, setHost] = useState(current?.remote?.host ?? '')
  const [nodePath, setNodePath] = useState(current?.remote?.nodePath ?? 'node')
  const [directory, setDirectory] = useState<RemoteDirectory | null>(null)
  const [remotePath, setRemotePath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connection = useRef<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    void window.desktop
      .sshHosts()
      .then(setHosts)
      .catch((error) => setError(errorMessage(error)))
    return () => {
      mounted.current = false
      if (connection.current) void window.desktop.cancelSsh(connection.current)
    }
  }, [])

  const connect = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const id = crypto.randomUUID()
    connection.current = id
    try {
      const result = await window.desktop.connectSsh({
        id,
        host: host.trim(),
        nodePath: nodePath.trim() || 'node',
      })
      if (!mounted.current) return
      setDirectory(result)
      setRemotePath(result.path)
    } catch (error) {
      if (mounted.current) setError(errorMessage(error))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const browse = async (destination: string) => {
    if (!connection.current) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.desktop.browseSsh(connection.current, destination)
      if (mounted.current) {
        setDirectory(result)
        setRemotePath(result.path)
      }
    } catch (error) {
      if (mounted.current) setError(errorMessage(error))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const open = async () => {
    if (!connection.current) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.desktop.openSshWorkspace(connection.current, remotePath)
      if (result) {
        useApp.getState().acceptWorkspace(result)
        onClose()
      }
    } catch (error) {
      if (mounted.current) setError(errorMessage(error))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <Modal
      title={directory ? `Remote-Ordner öffnen · ${host}` : 'Mit SSH-Host verbinden'}
      onClose={onClose}
    >
      {!directory ? (
        <form onSubmit={(event) => void connect(event)}>
          <div className="modal-body form-stack">
            <p className="muted">
              Wähle einen Host aus deiner SSH-Konfiguration oder gib eine SSH-Adresse ein.
            </p>
            {hosts.length > 0 && (
              <div className="ssh-host-list">
                {hosts.map(({ alias }) => (
                  <button
                    type="button"
                    key={alias}
                    className={`ssh-host ${host === alias ? 'selected' : ''}`}
                    disabled={busy}
                    onClick={() => setHost(alias)}
                  >
                    <Server size={16} />
                    <span>{alias}</span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            )}
            <label>
              SSH-Host
              <input
                required
                autoFocus
                value={host}
                disabled={busy}
                placeholder="dev-server oder user@hostname"
                onChange={(event) => setHost(event.target.value)}
              />
            </label>
            <details className="ssh-advanced">
              <summary>Remote-Laufzeit</summary>
              <label>
                Node.js auf dem Remote-Host
                <input
                  value={nodePath}
                  disabled={busy}
                  placeholder="node oder /usr/local/bin/node"
                  onChange={(event) => setNodePath(event.target.value)}
                />
              </label>
            </details>
            <div className="hint">
              <KeyRound size={15} />
              <span>
                Verwendet OpenSSH mit deinen Schlüsseln, SSH-Agent und ProxyJump-Einstellungen. Auf
                dem Remote-Host werden Git und Node.js 20+ benötigt (Linux/macOS).
              </span>
            </div>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="secondary-button" onClick={onClose}>
              Abbrechen
            </button>
            <button className="primary-button" disabled={busy || !host.trim()}>
              {busy ? <LoaderCircle size={15} className="spinning" /> : <Server size={15} />}
              {busy ? 'Verbinden …' : 'Verbinden'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="modal-body form-stack">
            <div className="ssh-connected">
              <span className="dot green" />
              Verbunden mit <strong>{host}</strong>
            </div>
            <form
              className="remote-path"
              onSubmit={(event) => {
                event.preventDefault()
                void browse(remotePath)
              }}
            >
              <input
                aria-label="Remote-Pfad"
                value={remotePath}
                disabled={busy}
                onChange={(event) => setRemotePath(event.target.value)}
              />
              <button className="secondary-button" disabled={busy}>
                Öffnen
              </button>
            </form>
            <div className="remote-folder-actions">
              <button
                className="secondary-button"
                disabled={busy || directory.parent === directory.path}
                onClick={() => void browse(directory.parent)}
              >
                <ArrowUp size={14} />
                Übergeordnet
              </button>
              <button
                className="icon-button"
                disabled={busy}
                title="Remote-Home"
                aria-label="Remote-Home"
                onClick={() => void browse(directory.home)}
              >
                <Home size={16} />
              </button>
              {busy && <LoaderCircle size={15} className="spinning" />}
            </div>
            <div className="remote-folder-list">
              {directory.directories.map((name) => (
                <button
                  key={name}
                  disabled={busy}
                  onClick={() =>
                    void browse(`${directory.path === '/' ? '' : directory.path}/${name}`)
                  }
                >
                  <Folder size={16} />
                  <span>{name}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
              {directory.directories.length === 0 && (
                <span className="muted small">Keine Unterordner</span>
              )}
            </div>
            <p className="muted small">
              Wähle ein ausgechecktes Git-Repository. Worktrees, Dateien und Terminals werden auf
              diesem Host ausgeführt.
            </p>
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="secondary-button" onClick={onClose}>
              Abbrechen
            </button>
            <button
              className="primary-button"
              disabled={busy || !remotePath.trim()}
              onClick={() => void open()}
            >
              <Folder size={15} />
              Repository öffnen
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

export function SshPrompts() {
  const [prompts, setPrompts] = useState<SshPrompt[]>([])
  useEffect(() => {
    const unsubscribe = window.desktop.onSshPrompt((prompt) =>
      setPrompts((current) => [...current, prompt]),
    )
    const close = window.desktop.onSshPromptClosed((id) =>
      setPrompts((current) => current.filter((prompt) => prompt.id !== id)),
    )
    return () => {
      unsubscribe()
      close()
    }
  }, [])
  const prompt = prompts[0]
  return prompt ? (
    <AuthenticationPrompt
      key={prompt.id}
      prompt={prompt}
      onAnswer={(answer) => {
        window.desktop.answerSshPrompt(prompt.id, answer)
        setPrompts((current) => current.filter((item) => item.id !== prompt.id))
      }}
    />
  ) : null
}

function AuthenticationPrompt({
  prompt,
  onAnswer,
}: {
  prompt: SshPrompt
  onAnswer: (answer: string | null) => void
}) {
  const [answer, setAnswer] = useState('')
  return (
    <Modal title={`SSH · ${prompt.host}`} onClose={() => onAnswer(null)}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onAnswer(prompt.confirmation ? 'yes' : answer)
        }}
      >
        <div className="modal-body form-stack">
          <div className="ssh-prompt-icon">
            {prompt.confirmation ? <ShieldCheck size={25} /> : <KeyRound size={25} />}
          </div>
          <p className="ssh-prompt-text">{prompt.prompt}</p>
          {!prompt.confirmation && (
            <label>
              Passwort / Passphrase
              <input
                autoFocus
                type="password"
                autoComplete="off"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={() => onAnswer(null)}>
            Abbrechen
          </button>
          <button className="primary-button">
            {prompt.confirmation ? 'Host vertrauen' : 'Bestätigen'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
