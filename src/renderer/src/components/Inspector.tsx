import { useEffect, useRef, useState } from 'react'
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  GitCompareArrows,
  GitCommitHorizontal,
  History,
  Link,
  RefreshCw,
} from 'lucide-react'
import type {
  ChangedFile,
  Commit,
  FileEntry,
  FilePreview,
  InspectorTab,
} from '../../../shared/types'
import { errorMessage, useApp } from '../store'
import { Modal } from './Modal'

interface Preview {
  title: string
  subtitle: string
  text: string
  diff: boolean
  loading: boolean
  error?: string
  note?: string
}

export function Inspector() {
  const workspace = useApp((state) => state.workspace)!
  const preferences = useApp((state) => state.preferences)
  const revision = useApp((state) => state.revision)
  const worktree = preferences.activeWorktree!
  const tab = preferences.inspectorTab
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const request = useRef(0)

  useEffect(() => {
    request.current++
    setPreview(null)
    setFiles([])
    setCommits([])
  }, [worktree])

  useEffect(() => {
    let cancelled = false
    setError(null)
    if (tab === 'files') {
      setLoading(false)
      return
    }
    setLoading(true)
    const load = async () => {
      try {
        if (tab === 'changes') {
          const result = await window.desktop.getChanges(worktree)
          if (!cancelled) setFiles(result)
        } else {
          const result = await window.desktop.getHistory(worktree)
          if (!cancelled) setCommits(result)
        }
      } catch (error) {
        if (!cancelled) setError(errorMessage(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [worktree, tab, revision])

  const showPreview = async (
    title: string,
    subtitle: string,
    isDiff: boolean,
    load: () => Promise<string | FilePreview>,
  ) => {
    const current = ++request.current
    setPreview({ title, subtitle, text: '', diff: isDiff, loading: true })
    try {
      const value = await load()
      if (request.current !== current) return
      const text = typeof value === 'string' ? value : value.text
      const lines = text.split('\n')
      const truncated =
        lines.length > 6000 ||
        text.length > 1024 * 1024 ||
        (typeof value !== 'string' && value.truncated)
      setPreview({
        title,
        subtitle,
        diff: isDiff,
        loading: false,
        text: lines
          .slice(0, 6000)
          .join('\n')
          .slice(0, 1024 * 1024),
        note:
          typeof value !== 'string' && value.binary
            ? 'Binärdatei – keine Textvorschau verfügbar.'
            : truncated
              ? 'Die Vorschau wurde für diese große Datei gekürzt.'
              : undefined,
      })
    } catch (error) {
      if (request.current === current)
        setPreview({
          title,
          subtitle,
          text: '',
          diff: isDiff,
          loading: false,
          error: errorMessage(error),
        })
    }
  }

  const showFile = (file: FileEntry | ChangedFile) =>
    void showPreview(file.path.split('/').at(-1)!, file.path, false, () =>
      window.desktop.readFile(worktree, file.path),
    )
  const showDiff = (file: ChangedFile, kind: 'staged' | 'working') =>
    void showPreview(
      file.path.split('/').at(-1)!,
      `${kind === 'staged' ? 'Staged' : 'Unstaged'} · ${file.path}`,
      true,
      () => window.desktop.getDiff(worktree, { kind, path: file.path }),
    )
  const staged = files.filter((file) => file.index !== ' ' && file.index !== '?')
  const unstaged = files.filter((file) => file.working !== ' ' && file.working !== '?')
  const untracked = files.filter((file) => file.index === '?')
  const tabs: { id: InspectorTab; label: string; icon: typeof History }[] = [
    { id: 'changes', label: 'Änderungen', icon: GitCompareArrows },
    { id: 'history', label: 'Verlauf', icon: History },
    { id: 'files', label: 'Dateien', icon: Folder },
  ]

  return (
    <aside className="inspector" aria-label="Git und Dateien">
      <div className="inspector-tabs" role="tablist" aria-label="Git-Ansicht">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'selected' : ''}
            onClick={() => useApp.getState().updatePreferences({ inspectorTab: id })}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="inspector-content">
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        {tab === 'changes' && (
          <>
            <div className="section-heading">
              <h2>Arbeitsverzeichnis</h2>
              <span className="count">{files.length}</span>
            </div>
            {!files.length && !loading && !error && (
              <div className="clean-state">
                <CheckCheck size={28} />
                <strong>Alles aufgeräumt</strong>
                <span>Keine lokalen Änderungen.</span>
              </div>
            )}
            <ChangeGroup
              title="Staged"
              files={staged}
              status="index"
              onSelect={(file) => showDiff(file, 'staged')}
            />
            <ChangeGroup
              title="Unstaged"
              files={unstaged}
              status="working"
              onSelect={(file) => showDiff(file, 'working')}
            />
            <ChangeGroup title="Untracked" files={untracked} status="index" onSelect={showFile} />
            <div className="branch-compare">
              <div className="section-heading">
                <h2>Branch vergleichen</h2>
                <GitCompareArrows size={15} />
              </div>
              <label className="small muted" htmlFor="target-branch">
                Zielbranch
              </label>
              <select
                id="target-branch"
                value={preferences.targetBranch}
                onChange={(event) =>
                  useApp.getState().updatePreferences({ targetBranch: event.target.value })
                }
              >
                {[...new Set([preferences.targetBranch, ...workspace.branches])]
                  .filter(Boolean)
                  .map((branch) => (
                    <option key={branch}>{branch}</option>
                  ))}
              </select>
              <button
                className="secondary-button full-width"
                onClick={() =>
                  void showPreview(
                    'Branch-Änderungen',
                    `Seit gemeinsamem Ausgangspunkt mit ${preferences.targetBranch}`,
                    true,
                    () =>
                      window.desktop.getDiff(worktree, {
                        kind: 'branch',
                        target: preferences.targetBranch,
                      }),
                  )
                }
              >
                <GitCompareArrows size={15} />
                Branch-Diff öffnen
              </button>
              <p className="small muted">
                Zeigt die committeten Änderungen dieses Branches seit dem gemeinsamen Ausgangspunkt.
              </p>
            </div>
          </>
        )}
        {tab === 'history' && (
          <>
            <div className="section-heading">
              <h2>Git-Verlauf</h2>
              <span className="small muted">
                {commits.length === 80 ? 'Letzte 80' : commits.length} Commits
              </span>
            </div>
            <div className="commit-list">
              {commits.map((commit, index) => (
                <button
                  key={commit.hash}
                  className={`commit ${index === 0 ? 'latest' : ''}`}
                  onClick={() =>
                    void showPreview(
                      commit.subject,
                      `${commit.shortHash} · ${commit.author}`,
                      true,
                      () => window.desktop.getDiff(worktree, { kind: 'commit', hash: commit.hash }),
                    )
                  }
                >
                  <span className="commit-line">
                    <span className="commit-dot" />
                  </span>
                  <span className="commit-content">
                    <strong>{commit.subject}</strong>
                    <span className="commit-meta">
                      {relativeDate(commit.date)} · {commit.author}
                    </span>
                    {commit.refs && <span className="commit-refs">{commit.refs}</span>}
                  </span>
                  <code>{commit.shortHash}</code>
                </button>
              ))}
            </div>
            {!commits.length && !loading && !error && (
              <div className="empty-inspector">
                <GitCommitHorizontal size={28} />
                <p>Noch keine Commits.</p>
              </div>
            )}
          </>
        )}
        {tab === 'files' && (
          <>
            <div className="section-heading">
              <h2>Dateibaum</h2>
              <FileCode2 size={15} />
            </div>
            <FileTree
              key={worktree}
              worktree={worktree}
              directory=""
              depth={0}
              revision={revision}
              onSelect={showFile}
            />
          </>
        )}
        {loading && (
          <div className="loading-indicator">
            <RefreshCw size={13} className="spinning" />
            Aktualisieren …
          </div>
        )}
      </div>
      {preview && (
        <Modal
          title={preview.title}
          wide
          onClose={() => {
            request.current++
            setPreview(null)
          }}
        >
          <div className="preview-subtitle">{preview.subtitle}</div>
          {preview.loading ? (
            <div className="preview-placeholder">Vorschau laden …</div>
          ) : preview.error ? (
            <div className="modal-body">
              <div className="inline-error">{preview.error}</div>
            </div>
          ) : (
            <>
              {preview.note && <div className="preview-note">{preview.note}</div>}
              {preview.text ? (
                <div className="code-preview">
                  {preview.text.split('\n').map((line, index) => (
                    <div key={index} className={`code-line ${preview.diff ? diffClass(line) : ''}`}>
                      <span className="line-number">{index + 1}</span>
                      <code>{line || ' '}</code>
                    </div>
                  ))}
                </div>
              ) : (
                !preview.note && (
                  <div className="preview-placeholder">
                    {preview.diff ? 'Keine Unterschiede.' : 'Leere Datei.'}
                  </div>
                )
              )}
            </>
          )}
        </Modal>
      )}
    </aside>
  )
}

function ChangeGroup({
  title,
  files,
  status,
  onSelect,
}: {
  title: string
  files: ChangedFile[]
  status: 'index' | 'working'
  onSelect: (file: ChangedFile) => void
}) {
  if (!files.length) return null
  return (
    <div className="change-group">
      <div className="change-group-title">
        <ChevronDown size={13} />
        <span>{title}</span>
        <span className="count">{files.length}</span>
      </div>
      {files.map((file) => (
        <button
          className="changed-file"
          key={file.path}
          title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
          onClick={() => onSelect(file)}
        >
          <FileCode2 size={14} />
          <span>{file.path}</span>
          <b className={`file-status status-${file[status] === '?' ? 'U' : file[status]}`}>
            {file[status] === '?' ? 'U' : file[status]}
          </b>
        </button>
      ))}
    </div>
  )
}

function FileTree({
  worktree,
  directory,
  depth,
  revision,
  onSelect,
}: {
  worktree: string
  directory: string
  depth: number
  revision: number
  onSelect: (file: FileEntry) => void
}) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void window.desktop
      .listFiles(worktree, directory)
      .then((value) => {
        if (!cancelled) {
          setEntries(value)
          setError(null)
        }
      })
      .catch((error) => {
        if (!cancelled) setError(errorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [worktree, directory, revision])
  return (
    <div className="file-tree" role={depth === 0 ? 'tree' : 'group'}>
      {loading && <div className="tree-notice">Laden …</div>}
      {error && <div className="inline-error">{error}</div>}
      {!loading && !entries.length && !error && <div className="tree-notice">Leerer Ordner</div>}
      {entries.slice(0, 1000).map((entry) => {
        const open = expanded.has(entry.path)
        const isDirectory = entry.kind === 'directory'
        const Icon = isDirectory
          ? open
            ? FolderOpen
            : Folder
          : entry.kind === 'symlink'
            ? Link
            : File
        return (
          <div key={entry.path} role="treeitem" aria-expanded={isDirectory ? open : undefined}>
            <button
              className={`tree-entry ${isDirectory ? 'directory' : ''}`}
              style={{ paddingLeft: 10 + depth * 14 }}
              title={entry.path}
              onClick={() => {
                if (isDirectory)
                  setExpanded((old) => {
                    const next = new Set(old)
                    if (next.has(entry.path)) next.delete(entry.path)
                    else next.add(entry.path)
                    return next
                  })
                else onSelect(entry)
              }}
            >
              {isDirectory ? (
                open ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )
              ) : (
                <span className="tree-indent" />
              )}
              <Icon size={15} />
              <span>{entry.name}</span>
            </button>
            {isDirectory && open && (
              <FileTree
                worktree={worktree}
                directory={entry.path}
                depth={depth + 1}
                revision={revision}
                onSelect={onSelect}
              />
            )}
          </div>
        )
      })}
      {entries.length > 1000 && (
        <div className="tree-notice">Weitere {entries.length - 1000} Einträge ausgeblendet.</div>
      )}
    </div>
  )
}

function diffClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff '))
    return 'diff-heading'
  if (line.startsWith('+')) return 'diff-added'
  if (line.startsWith('-')) return 'diff-removed'
  if (line.startsWith('@@')) return 'diff-hunk'
  return ''
}

function relativeDate(date: string): string {
  const seconds = (new Date(date).getTime() - Date.now()) / 1000
  const format = new Intl.RelativeTimeFormat('de', { numeric: 'auto' })
  if (Math.abs(seconds) < 3600) return format.format(Math.round(seconds / 60), 'minute')
  if (Math.abs(seconds) < 86400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86400), 'day')
}
