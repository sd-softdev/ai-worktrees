import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SshPrompt } from '../../shared/types'
import { shellQuote } from './config'

export class SshAuthentication {
  private server: Server | null = null
  private ready: Promise<void> | null = null
  private tokens = new Map<string, { connection: string; host: string }>()
  private requests = new Map<string, { connection: string; socket: Socket }>()
  private sockets = new Set<Socket>()

  constructor(
    private directory: string,
    private executable: string,
    private helper: string,
    private prompt: (prompt: SshPrompt) => void,
    private closed: (id: string) => void,
  ) {}

  async environment(connection: string, host: string): Promise<Record<string, string>> {
    this.ready ??= this.listen()
    await this.ready
    const token = randomBytes(32).toString('hex')
    this.tokens.set(token, { connection, host })
    const address = this.server!.address()
    if (!address || typeof address === 'string')
      throw new Error('SSH authentication is unavailable.')
    return {
      SSH_ASKPASS: path.join(
        this.directory,
        process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh',
      ),
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env.DISPLAY || 'agent-workspace',
      AGENT_WORKSPACE_ASKPASS_PORT: String(address.port),
      AGENT_WORKSPACE_ASKPASS_TOKEN: token,
    }
  }

  private async listen(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const windows = process.platform === 'win32'
    const script = windows
      ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${this.executable.replaceAll('%', '%%')}" "${this.helper.replaceAll('%', '%%')}" %*\r\n`
      : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(this.executable)} ${shellQuote(this.helper)} "$@"\n`
    await writeFile(path.join(this.directory, windows ? 'askpass.cmd' : 'askpass.sh'), script, {
      mode: 0o700,
    })
    this.server = createServer((socket) => this.accept(socket))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.removeListener('error', reject)
        resolve()
      })
    })
    this.server.unref()
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket)
    let buffer = ''
    let requestId: string | null = null
    socket.setTimeout(120_000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk) => {
      if (requestId) return
      buffer += chunk.toString('utf8')
      if (buffer.length > 8192) {
        socket.destroy()
        return
      }
      if (!buffer.includes('\n')) return
      try {
        const value = JSON.parse(buffer.split('\n')[0])
        const identity = this.tokens.get(value.token)
        if (!identity || typeof value.prompt !== 'string') {
          socket.destroy()
          return
        }
        requestId = randomUUID()
        this.requests.set(requestId, { connection: identity.connection, socket })
        this.prompt({
          id: requestId,
          host: identity.host,
          prompt: value.prompt,
          confirmation: /yes\/no|fingerprint|continue connecting/i.test(value.prompt),
        })
      } catch {
        socket.destroy()
      }
    })
    socket.on('close', () => {
      this.sockets.delete(socket)
      if (requestId) {
        this.requests.delete(requestId)
        this.closed(requestId)
      }
    })
  }

  answer(id: string, answer: string | null): void {
    const request = this.requests.get(id)
    if (!request) return
    this.requests.delete(id)
    request.socket.end(JSON.stringify({ answer }) + '\n')
    this.closed(id)
  }

  cancel(connection: string): void {
    for (const [token, identity] of this.tokens)
      if (identity.connection === connection) this.tokens.delete(token)
    for (const [id, request] of this.requests)
      if (request.connection === connection) this.answer(id, null)
  }

  dispose(): void {
    for (const socket of this.sockets) socket.destroy()
    this.server?.close()
    this.tokens.clear()
  }
}
