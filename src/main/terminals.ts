import os from 'node:os'
import * as pty from 'node-pty'
import type { SequencedTerminalEvent, TerminalSnapshot } from '../shared/types'
import type { TerminalLaunch } from './backend'
import { APP_VERSION } from '../shared/version'

interface Session {
  process: pty.IPty
  worktree: string
  output: string
  sequence: number
  exited: boolean
  exitCode?: number
  pending: string
  timer?: ReturnType<typeof setTimeout>
  outstanding: Map<number, number>
  outstandingBytes: number
  paused: boolean
}

const BUFFER_LIMIT = 2 * 1024 * 1024

export class TerminalService {
  private sessions = new Map<string, Session>()

  constructor(private emit: (event: SequencedTerminalEvent) => void) {}

  open(
    id: string,
    worktree: string,
    cols: number,
    rows: number,
    launch?: TerminalLaunch,
  ): TerminalSnapshot {
    const existing = this.sessions.get(id)
    if (existing) {
      if (existing.worktree !== worktree)
        throw new Error('This terminal belongs to a different worktree.')
      this.flush(id, existing)
      return this.snapshot(existing)
    }
    const shell =
      process.platform === 'win32'
        ? process.env.COMSPEC || 'cmd.exe'
        : process.env.SHELL ||
          os.userInfo().shell ||
          (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !key.startsWith('ELECTRON_') && key !== 'NODE_OPTIONS')
        env[key] = value
    }
    env.TERM = 'xterm-256color'
    env.COLORTERM = 'truecolor'
    env.TERM_PROGRAM = 'AgentWorkspace'
    env.TERM_PROGRAM_VERSION = APP_VERSION
    Object.assign(env, launch?.env)
    // A login shell also loads the user's CLI PATH when launched from Finder.
    const terminal = pty.spawn(
      launch?.file ?? shell,
      launch?.args ?? (process.platform === 'win32' ? [] : ['-l']),
      {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: launch?.cwd ?? worktree,
        env,
      },
    )
    const session: Session = {
      process: terminal,
      worktree,
      output: '',
      sequence: 0,
      exited: false,
      pending: '',
      outstanding: new Map(),
      outstandingBytes: 0,
      paused: false,
    }
    this.sessions.set(id, session)
    terminal.onData((data) => {
      if (this.sessions.get(id) !== session) return
      session.pending += data
      if (session.pending.length >= 64 * 1024) this.flush(id, session)
      else session.timer ??= setTimeout(() => this.flush(id, session), 12)
    })
    terminal.onExit(({ exitCode }) => {
      if (this.sessions.get(id) !== session) return
      this.flush(id, session)
      session.exited = true
      session.exitCode = exitCode
      this.emit({ id, type: 'exit', exitCode, sequence: ++session.sequence })
    })
    return this.snapshot(session)
  }

  private snapshot(session: Session): TerminalSnapshot {
    return {
      output: session.output,
      sequence: session.sequence,
      exited: session.exited,
      exitCode: session.exitCode,
    }
  }

  private flush(id: string, session: Session): void {
    if (session.timer) clearTimeout(session.timer)
    session.timer = undefined
    if (!session.pending) return
    const data = session.pending
    session.pending = ''
    session.output = (session.output + data).slice(-BUFFER_LIMIT)
    const sequence = ++session.sequence
    session.outstanding.set(sequence, data.length)
    session.outstandingBytes += data.length
    if (session.outstandingBytes > 512 * 1024 && !session.paused) {
      session.process.pause()
      session.paused = true
    }
    this.emit({ id, type: 'data', data, sequence })
  }

  acknowledge(id: string, sequence: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    for (const [key, bytes] of session.outstanding) {
      if (key <= sequence) {
        session.outstanding.delete(key)
        session.outstandingBytes -= bytes
      }
    }
    if (session.paused && !session.exited && session.outstandingBytes < 128 * 1024) {
      session.paused = false
      session.process.resume()
    }
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (session && !session.exited) session.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (session && !session.exited) session.process.resize(cols, rows)
  }

  close(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    if (session.timer) clearTimeout(session.timer)
    if (!session.exited) session.process.kill()
  }

  hasRunning(worktree?: string): boolean {
    return [...this.sessions.values()].some(
      (session) => !session.exited && (!worktree || session.worktree === worktree),
    )
  }

  reconcileWorktrees(paths: Set<string>): void {
    for (const [id, session] of this.sessions) {
      if (!paths.has(session.worktree)) this.close(id)
    }
  }

  closeAll(): void {
    for (const id of this.sessions.keys()) this.close(id)
  }
}
