import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TerminalService } from '../src/main/terminals'
import { sshExecutable } from '../src/main/ssh/executable'

async function main() {
  const base = path.join(os.tmpdir(), 'opencode')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'ssh-client-'))
  const originalPath = process.env.PATH
  try {
    let executable = await sshExecutable()
    if (process.platform === 'win32') {
      // Reproduce the last-PATH-entry / spaces case with the real Windows
      // OpenSSH installation, keeping its companion DLLs in the same folder.
      const linked = path.join(directory, 'SSH client with spaces')
      await symlink(path.dirname(executable), linked, 'junction')
      process.env.PATH = `${path.join(directory, 'missing')};"${linked}"`
      executable = await sshExecutable()
      assert.equal(executable, path.join(linked, 'ssh.exe'))
    }
    await new Promise<void>((resolve, reject) => {
      let output = ''
      const id = randomUUID()
      const terminals = new TerminalService((event) => {
        if (event.type === 'data') output += event.data
        if (event.type !== 'exit') return
        clearTimeout(timer)
        terminals.closeAll()
        try {
          assert.equal(event.exitCode, 0, output)
          assert.match(output, /OpenSSH_/)
          resolve()
        } catch (error) {
          reject(error)
        }
      })
      const timer = setTimeout(() => {
        terminals.closeAll()
        reject(new Error('SSH client PTY launch timed out'))
      }, 20_000)
      try {
        terminals.open(id, directory, 120, 30, {
          file: executable,
          args: ['-V'],
          cwd: directory,
          env: {},
        })
      } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    })
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}
// ConPTY's worker can keep this standalone Electron-as-Node runner alive after
// the shell exits. Finish only after assertions, cleanup, and output flushing.
void main().then(
  () => {
    process.stdout.write(
      'SSH client PTY test passed: executable lookup and real OpenSSH launch.\n',
      () => process.exit(0),
    )
  },
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`, () =>
      process.exit(1),
    )
  },
)
