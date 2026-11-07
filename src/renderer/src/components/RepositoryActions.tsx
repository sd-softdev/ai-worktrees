import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, LoaderCircle } from 'lucide-react'
import { errorMessage, refreshWorkspace, useApp } from '../store'

export function RepositoryActions() {
  const workspace = useApp((state) => state.workspace)!
  const disconnected = useApp((state) => state.remoteStatus?.state === 'disconnected')
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ error: boolean; message: string } | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const disabled = pending || disconnected || !workspace.worktrees.some((tree) => !tree.missing)
  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setExpanded(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false)
        toggle.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [expanded])
  const fetch = async (prune = false) => {
    if (disabled) return
    setExpanded(false)
    setPending(true)
    setResult(null)
    try {
      const message = await window.desktop.fetchRepository(workspace.id, prune)
      setResult({ error: false, message })
    } catch (error) {
      setResult({ error: true, message: errorMessage(error) })
    } finally {
      await refreshWorkspace()
      setPending(false)
    }
  }
  return (
    <div className="repository-actions" ref={container}>
      <div className="fetch-buttons">
        <button
          className="secondary-button"
          disabled={disabled}
          onClick={() => void fetch()}
          title="Fetch all remotes"
        >
          {pending ? <LoaderCircle size={14} className="spinning" /> : <Download size={14} />}
          {pending ? 'Fetching …' : 'Fetch'}
        </button>
        <button
          className="secondary-button fetch-options-toggle"
          ref={toggle}
          disabled={disabled}
          aria-label="Fetch options"
          aria-expanded={expanded}
          aria-controls="fetch-options"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {expanded && (
        <div className="fetch-options" id="fetch-options">
          <button onClick={() => void fetch(true)}>
            <strong>Fetch --prune</strong>
            <span>Also remove stale remote-tracking branches.</span>
          </button>
        </div>
      )}
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
