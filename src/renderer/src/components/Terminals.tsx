import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Columns2, Rows2, Plus, TerminalSquare, X, RotateCw } from 'lucide-react'
import { leaves } from '../../../shared/layout'
import type { SequencedTerminalEvent, TerminalLayout, TerminalLeaf } from '../../../shared/types'
import { useApp } from '../store'
import { ResizeHandle } from './ResizeHandle'
import '@xterm/xterm/css/xterm.css'

export function TerminalWorkspace({ worktree, visible }: { worktree: string; visible: boolean }) {
  const settings = useApp((state) => state.preferences.worktrees[worktree])
  const activeTab = settings?.tabs.find((tab) => tab.id === settings.activeTab) ?? settings?.tabs[0]
  const tabs = settings?.tabs ?? []
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const rename = () => {
    if (name.trim())
      useApp.getState().updateWorktree(worktree, {
        tabs: tabs.map((tab) =>
          tab.id === renaming ? { ...tab, title: name.trim().slice(0, 160) } : tab,
        ),
      })
    setRenaming(null)
  }
  return (
    <section className="terminal-workspace" hidden={!visible} aria-label={`Terminals ${worktree}`}>
      <div className="terminal-tabs" role="tablist" aria-label="Terminal-Tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`terminal-tab ${activeTab?.id === tab.id ? 'selected' : ''}`}
          >
            {renaming === tab.id ? (
              <input
                className="tab-name-input"
                aria-label="Terminal-Name"
                autoFocus
                value={name}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                onBlur={rename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') rename()
                  if (event.key === 'Escape') setRenaming(null)
                }}
              />
            ) : (
              <button
                role="tab"
                aria-selected={activeTab?.id === tab.id}
                onClick={() => useApp.getState().updateWorktree(worktree, { activeTab: tab.id })}
                onDoubleClick={() => {
                  setRenaming(tab.id)
                  setName(tab.title)
                }}
              >
                <TerminalSquare size={14} />
                <span>{tab.title}</span>
                {leaves(tab.layout).length > 1 && (
                  <span className="split-count">{leaves(tab.layout).length}</span>
                )}
              </button>
            )}
            <button
              className="tab-close"
              aria-label={`${tab.title} schließen`}
              onClick={() =>
                void useApp.getState().closeTab(worktree, tab.id).catch(useApp.getState().setError)
              }
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          className="icon-button add-tab"
          title="Neues Terminal (⌘T / Strg+T)"
          aria-label="Neues Terminal"
          onClick={() => useApp.getState().addTerminal(worktree)}
        >
          <Plus size={17} />
        </button>
      </div>
      <div className="terminal-views">
        {tabs.length === 0 && (
          <div className="empty-terminal">
            <TerminalSquare size={36} />
            <h2>Platz für deine nächste Aufgabe</h2>
            <p>Starte eine Shell und öffne deinen Agenten oder Entwicklungsserver.</p>
            <button
              className="primary-button"
              onClick={() => useApp.getState().addTerminal(worktree)}
            >
              <Plus size={16} />
              Terminal öffnen
            </button>
          </div>
        )}
        {tabs.map((tab) => (
          <div key={tab.id} className="terminal-tab-content" hidden={activeTab?.id !== tab.id}>
            <LayoutNode
              worktree={worktree}
              layout={tab.layout}
              visible={visible && activeTab?.id === tab.id}
              onChange={(layout) => useApp.getState().updateLayout(worktree, tab.id, layout)}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function LayoutNode({
  worktree,
  layout,
  visible,
  onChange,
}: {
  worktree: string
  layout: TerminalLayout
  visible: boolean
  onChange: (layout: TerminalLayout) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(600)
  useEffect(() => {
    const element = container.current
    if (!element || layout.type !== 'split') return
    const observer = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect()
      const next = layout.direction === 'horizontal' ? bounds.width : bounds.height
      if (next > 0) setSize(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [layout.type, layout.type === 'split' ? layout.direction : null])

  if (layout.type === 'terminal')
    return <TerminalPane worktree={worktree} leaf={layout} visible={visible} />
  return (
    <div ref={container} className={`terminal-split ${layout.direction}`}>
      <div className="split-child" style={{ flex: `${layout.ratio} 1 0` }}>
        <LayoutNode
          worktree={worktree}
          layout={layout.first}
          visible={visible}
          onChange={(first) => onChange({ ...layout, first })}
        />
      </div>
      <ResizeHandle
        label="Terminal-Aufteilung"
        direction={layout.direction}
        value={size * layout.ratio}
        min={size * 0.1}
        max={size * 0.9}
        onChange={(value) => onChange({ ...layout, ratio: value / size })}
      />
      <div className="split-child" style={{ flex: `${1 - layout.ratio} 1 0` }}>
        <LayoutNode
          worktree={worktree}
          layout={layout.second}
          visible={visible}
          onChange={(second) => onChange({ ...layout, second })}
        />
      </div>
    </div>
  )
}

function TerminalPane({
  worktree,
  leaf,
  visible,
}: {
  worktree: string
  leaf: TerminalLeaf
  visible: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null)
  const status = useApp((state) => state.terminals[leaf.id])
  const focused = useApp((state) => state.focusedTerminal === leaf.id)
  const setError = useApp((state) => state.setError)
  const [generation, setGeneration] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let ready = false
    let sequence = -1
    const pending: SequencedTerminalEvent[] = []
    setFailure(null)
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      lineHeight: 1.35,
      fontFamily: '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
      scrollback: 8000,
      allowProposedApi: false,
      theme: {
        background: '#0c0f17',
        foreground: '#d8deea',
        cursor: '#be99ff',
        selectionBackground: '#6c439b80',
        black: '#202637',
        red: '#f27c8f',
        green: '#83d6ad',
        yellow: '#e8c77b',
        blue: '#83b5f9',
        magenta: '#bd96f5',
        cyan: '#7ac8d5',
        white: '#d9dfeb',
        brightBlack: '#697389',
        brightRed: '#ff9eaa',
        brightGreen: '#adf2ce',
        brightYellow: '#ffe2a3',
        brightBlue: '#b0d2ff',
        brightMagenta: '#d8bdff',
        brightCyan: '#a4ecf3',
        brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(
      new WebLinksAddon((_event, url) => {
        void window.desktop.openExternal(url).catch(setError)
      }),
    )
    terminal.open(host.current!)
    instance.current = { terminal, fit }
    const resize = () => {
      if (!host.current?.clientWidth || !host.current?.clientHeight) return
      fit.fit()
      if (ready)
        window.desktop.resizeTerminal(
          leaf.id,
          Math.max(2, terminal.cols),
          Math.max(1, terminal.rows),
        )
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host.current!)
    const applyEvent = (event: SequencedTerminalEvent) => {
      if (event.sequence <= sequence) return
      sequence = event.sequence
      if (event.type === 'data')
        terminal.write(event.data ?? '', () => {
          if (!disposed) window.desktop.acknowledgeTerminal(leaf.id, event.sequence)
        })
      else {
        useApp.getState().setTerminalState(leaf.id, { state: 'exited', exitCode: event.exitCode })
        terminal.write(`\r\n\x1b[90m[Prozess beendet · Exit ${event.exitCode ?? '?'}]\x1b[0m\r\n`)
      }
    }
    const unsubscribe = window.desktop.onTerminalEvent((event) => {
      if (event.id !== leaf.id || disposed) return
      if (!ready) pending.push(event)
      else applyEvent(event)
    })
    const input = terminal.onData((data) => window.desktop.writeTerminal(leaf.id, data))
    terminal.attachCustomKeyEventHandler((event) => {
      const modifier = window.desktop.platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (modifier && ['t', 'd', 'o'].includes(event.key.toLowerCase())) return false
      if (window.desktop.platform === 'darwin' && event.metaKey) return false
      return true
    })
    useApp.getState().setTerminalState(leaf.id, { state: 'starting' })
    void window.desktop
      .openTerminal(leaf.id, worktree, Math.max(2, terminal.cols), Math.max(1, terminal.rows))
      .then((snapshot) => {
        if (disposed) return
        sequence = snapshot.sequence
        if (snapshot.output)
          terminal.write(snapshot.output, () => {
            if (!disposed) window.desktop.acknowledgeTerminal(leaf.id, snapshot.sequence)
          })
        else window.desktop.acknowledgeTerminal(leaf.id, snapshot.sequence)
        useApp.getState().setTerminalState(leaf.id, {
          state: snapshot.exited ? 'exited' : 'running',
          exitCode: snapshot.exitCode,
        })
        ready = true
        for (const event of pending) applyEvent(event)
        pending.length = 0
        resize()
        if (visible) terminal.focus()
      })
      .catch((error) => {
        if (disposed) return
        setFailure(String(error))
        useApp.getState().setTerminalState(leaf.id, { state: 'error' })
      })
    return () => {
      disposed = true
      observer.disconnect()
      unsubscribe()
      input.dispose()
      terminal.dispose()
      instance.current = null
      // Session lifetime belongs to TerminalService, not React component lifetime.
    }
  }, [leaf.id, worktree, generation, setError])

  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => {
      instance.current?.fit.fit()
      if (focused) instance.current?.terminal.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, focused])

  const restart = async () => {
    await window.desktop.closeTerminal(leaf.id)
    setGeneration((value) => value + 1)
  }

  return (
    <div
      className={`terminal-pane ${focused ? 'focused' : ''}`}
      onFocusCapture={() => useApp.getState().focusTerminal(leaf.id)}
    >
      <div className="terminal-pane-heading">
        <div>
          <TerminalSquare size={13} className="green-text" />
          <span>{leaf.title}</span>
          <span className={`terminal-process ${status?.state ?? 'starting'}`}>
            {status?.state === 'exited'
              ? `Exit ${status.exitCode ?? '?'}`
              : status?.state === 'error'
                ? 'Fehler'
                : status?.state === 'running'
                  ? 'Läuft'
                  : 'Startet …'}
          </span>
        </div>
        <div className="pane-actions">
          {['exited', 'error'].includes(status?.state ?? '') && (
            <button
              className="icon-button"
              aria-label="Shell neu starten"
              title="Shell neu starten"
              onClick={() => void restart().catch(setError)}
            >
              <RotateCw size={14} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Terminal nebeneinander teilen"
            title="Nebeneinander teilen (⌘D / Strg+D)"
            onClick={() => useApp.getState().splitTerminal(worktree, leaf.id, 'horizontal')}
          >
            <Columns2 size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Terminal untereinander teilen"
            title="Untereinander teilen (⌘⇧D / Strg+Umschalt+D)"
            onClick={() => useApp.getState().splitTerminal(worktree, leaf.id, 'vertical')}
          >
            <Rows2 size={14} />
          </button>
          <button
            className="icon-button"
            aria-label="Terminal schließen"
            title="Terminalprozess beenden"
            onClick={() => void useApp.getState().closeTerminal(worktree, leaf.id).catch(setError)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {failure && <div className="inline-error">{failure}</div>}
      <div className="terminal-host" ref={host} />
    </div>
  )
}
