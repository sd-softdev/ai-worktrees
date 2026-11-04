import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SshConnectInput } from '../../shared/types'
import type { TerminalLaunch } from '../backend'
import { SshAuthentication } from './auth'
import { shellQuote, sshBaseArgs } from './config'

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
    this.env = await this.authentication.environment(this.id, this.target.host)
    if (this.stopped) throw new Error('SSH-Verbindung abgebrochen.')
    if (process.platform !== 'win32')
      this.socketDirectory = await mkdtemp(path.join(os.tmpdir(), 'aw-ssh-'))
    const source = await readFile(this.agentFile, 'utf8')
    if (this.stopped) {
      this.cleanup()
      throw new Error('SSH-Verbindung abgebrochen.')
    }
    // Send the agent via stdin rather than a long shell argument (Windows has a
    // 32K command-line limit). RPC starts only after the agent's ready message.
    const loader =
      'let b="";const f=c=>{b+=c;const n=b.indexOf("\\n");if(n<0)return;process.stdin.removeListener("data",f);new Function("require","module","exports",Buffer.from(b.slice(0,n),"base64").toString())(require,module,exports)};process.stdin.on("data",f)'
    const command = `exec "\${SHELL:-/bin/sh}" -lc ${shellQuote(`exec ${shellQuote(this.target.nodePath)} -e ${shellQuote(loader)}`)}`
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    this.child = spawn(
      'ssh',
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
      this.fail(new Error(`SSH konnte nicht gestartet werden: ${error.message}`)),
    )
    this.child.on('close', () =>
      this.fail(new Error(this.diagnostic.trim() || 'SSH-Verbindung wurde getrennt.')),
    )
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.stdin.write(Buffer.from(source).toString('base64') + '\n')
    const timer = setTimeout(
      () => this.fail(new Error('Zeitüberschreitung beim Aufbau der SSH-Verbindung.')),
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
      this.fail(new Error('Remote-Antwort ist zu groß.'))
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
    if (!this.connected)
      return Promise.reject(new Error('SSH-Verbindung unterbrochen. Bitte erneut verbinden.'))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Zeitüberschreitung bei Remote-Operation: ${method}`))
      }, 60_000)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.child!.stdin.write(JSON.stringify({ id, method, args }) + '\n')
    })
  }

  terminal(directory: string): TerminalLaunch {
    if (!this.connected) throw new Error('SSH-Verbindung unterbrochen. Bitte erneut verbinden.')
    const script = `cd -- ${shellQuote(directory)} && export TERM=xterm-256color COLORTERM=truecolor && exec "\${SHELL:-/bin/sh}" -l`
    return {
      file: 'ssh',
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
    this.readyReject?.(new Error('SSH-Verbindung abgebrochen.'))
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('SSH-Verbindung beendet.'))
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
