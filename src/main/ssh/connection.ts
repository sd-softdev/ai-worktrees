import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SshConnectInput } from '../../shared/types'
import type { TerminalLaunch } from '../backend'
import { SshAuthentication } from './auth'
import { shellQuote, sshBaseArgs } from './config'
import { sshExecutable } from './executable'
import { remoteCommand, startupError } from './bootstrap'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SshConnection {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, Pending>()
  private env: Record<string, string> = {}
  private socketDirectory: string | null = null
  private buffer = ''
  private diagnostic = ''
  private stopped = false
  private online = false
  private executable = ''
  private readyResolve?: () => void
  private readyReject?: (error: Error) => void

  constructor(
    readonly target: SshConnectInput,
    private authentication: SshAuthentication,
    private agentFile: string,
    private disconnected: (message: string) => void,
  ) {}

  get id(): string {
    return this.target.id
  }
  get connected(): boolean {
    return this.online && !this.stopped
  }

  async start(): Promise<void> {
    this.executable = await sshExecutable()
    this.env = await this.authentication.environment(this.id, this.target.host)
    if (this.stopped) throw new Error('SSH connection cancelled.')
    if (process.platform !== 'win32')
      this.socketDirectory = await mkdtemp(path.join(os.tmpdir(), 'aw-ssh-'))
    const source = await readFile(this.agentFile, 'utf8')
    if (this.stopped) {
      this.cleanup()
      throw new Error('SSH connection cancelled.')
    }
    // Send the agent via stdin rather than a long shell argument (Windows has a
    // 32K command-line limit). RPC starts only after the agent's ready message.
    const command = remoteCommand(this.target.nodePath)
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.child = spawn(
      this.executable,
      [...sshBaseArgs(), ...this.controlArgs(true), '-T', '--', this.target.host, command],
      {
        env: { ...process.env, ...this.env },
        windowsHide: true,
      },
    )
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.receive(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.diagnostic = (this.diagnostic + chunk.toString('utf8')).slice(-16_384)
    })
    this.child.on('error', (error) =>
      this.fail(
        new Error(
          `Could not start SSH. Install the OpenSSH client and restart Agent Workspace. ${error.message}`,
        ),
      ),
    )
    this.child.on('close', () => this.fail(startupError(this.diagnostic, this.target)))
    // A failed preflight may close stdin before stderr is drained. Preserve its
    // diagnostic instead of replacing it with a generic EPIPE error.
    this.child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') this.fail(error)
    })
    this.child.stdin.write(Buffer.from(source).toString('base64') + '\n')
    const timer = setTimeout(
      () => this.fail(new Error('Timed out while connecting over SSH.')),
      120_000,
    )
    try {
      await ready
    } finally {
      clearTimeout(timer)
    }
  }

  private controlArgs(master: boolean): string[] {
    return this.socketDirectory
      ? [
          '-o',
          `ControlMaster=${master ? 'auto' : 'no'}`,
          '-o',
          'ControlPersist=no',
          '-o',
          `ControlPath=${path.join(this.socketDirectory, 'c')}`,
        ]
      : []
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > 40 * 1024 * 1024) {
      this.fail(new Error('Remote response is too large.'))
      return
    }
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      let message: {
        event?: string
        protocol?: number
        id?: string
        result?: unknown
        error?: string
      }
      try {
        message = JSON.parse(line)
      } catch {
        this.diagnostic = (this.diagnostic + line + '\n').slice(-16_384)
        continue
      }
      if (message.event === 'ready' && message.protocol === 1) {
        this.online = true
        this.readyResolve?.()
        this.readyResolve = undefined
        this.readyReject = undefined
      } else if (message.id) {
        const request = this.pending.get(message.id)
        if (!request) continue
        clearTimeout(request.timer)
        this.pending.delete(message.id)
        if (message.error) request.reject(new Error(message.error))
        else request.resolve(message.result)
      }
    }
  }

  call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (!this.connected) return Promise.reject(new Error('SSH connection lost. Please reconnect.'))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id)
          reject(new Error(`Remote operation timed out: ${method}`))
        },
        method === 'fetch' || method === 'push' ? 150_000 : 60_000,
      )
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.child!.stdin.write(JSON.stringify({ id, method, args }) + '\n')
    })
  }

  terminal(directory: string): TerminalLaunch {
    if (!this.connected) throw new Error('SSH connection lost. Please reconnect.')
    const script = `cd -- ${shellQuote(directory)} && export TERM=xterm-256color COLORTERM=truecolor && exec "\${SHELL:-/bin/sh}" -l`
    return {
      file: this.executable,
      args: [
        ...sshBaseArgs(),
        ...this.controlArgs(false),
        '-tt',
        '--',
        this.target.host,
        `exec sh -c ${shellQuote(script)}`,
      ],
      cwd: os.homedir(),
      env: this.env,
    }
  }

  private fail(error: Error): void {
    if (this.stopped) return
    const wasOnline = this.online
    this.readyReject?.(error)
    this.dispose()
    if (wasOnline) this.disconnected(error.message)
  }

  dispose(): void {
    if (this.stopped) return
    this.stopped = true
    this.online = false
    this.readyReject?.(new Error('SSH connection cancelled.'))
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('SSH connection closed.'))
    }
    this.pending.clear()
    this.authentication.cancel(this.id)
    this.child?.kill()
    this.cleanup()
  }

  private cleanup(): void {
    if (this.socketDirectory)
      void rm(this.socketDirectory, { recursive: true, force: true }).catch(() => {})
  }
}
