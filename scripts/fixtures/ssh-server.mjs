import { spawn, execFileSync } from 'node:child_process'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

export async function startSshServer(directory) {
  await mkdir(directory, { recursive: true })
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const key = path.join(directory, 'identity')
  const hostKey = path.join(directory, 'host-key')
  const passphrase = 'workspace-smoke-passphrase'
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', passphrase, '-f', key])
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey])
  const authorized = path.join(directory, 'authorized_keys')
  await writeFile(authorized, await readFile(`${key}.pub`), { mode: 0o600 })
  const privileged = process.env.AGENT_WORKSPACE_TEST_SSHD_SUDO === '1'
  const serverConfig = path.join(directory, 'sshd_config')
  await writeFile(
    serverConfig,
    [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey "${hostKey}"`,
      `AuthorizedKeysFile "${authorized}"`,
      `PidFile "${path.join(directory, 'sshd.pid')}"`,
      `AllowUsers ${os.userInfo().username}`,
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'PubkeyAuthentication yes',
      `UsePAM ${privileged ? 'yes' : 'no'}`,
      'StrictModes no',
      'PrintMotd no',
      'UseDNS no',
      'LogLevel VERBOSE',
    ].join('\n') + '\n',
  )
  const clientConfig = path.join(directory, 'config')
  await writeFile(
    clientConfig,
    [
      'Host workspace-smoke-host',
      '  HostName 127.0.0.1',
      `  Port ${port}`,
      `  User ${os.userInfo().username}`,
      `  IdentityFile "${key}"`,
      '  IdentitiesOnly yes',
      '  IdentityAgent none',
      `  UserKnownHostsFile "${path.join(directory, 'known_hosts')}"`,
      '  StrictHostKeyChecking ask',
    ].join('\n') + '\n',
  )
  await chmod(clientConfig, 0o600)
  const child = spawn(
    privileged ? 'sudo' : '/usr/sbin/sshd',
    privileged
      ? ['-n', '/usr/sbin/sshd', '-D', '-e', '-f', serverConfig]
      : ['-D', '-e', '-f', serverConfig],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let logs = ''
  const ready = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.stderr.on('data', (chunk) => {
      logs += chunk
      if (logs.includes('Server listening')) resolve()
    })
    child.on('exit', (code) => reject(new Error(`Test SSH server exited (${code}): ${logs}`)))
  })
  await ready
  return {
    config: clientConfig,
    passphrase,
    logs: () => logs,
    async disconnect() {
      const pid = Number((await readFile(path.join(directory, 'sshd.pid'), 'utf8')).trim())
      const children = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([, parent]) => parent === pid)
        .map(([child]) => child)
      for (const child of children) {
        if (privileged) execFileSync('sudo', ['-n', 'kill', '-TERM', String(child)])
        else process.kill(child, 'SIGTERM')
      }
    },
    async close() {
      const exited = new Promise((resolve) => {
        if (child.exitCode !== null) resolve()
        else child.once('exit', resolve)
      })
      child.kill('SIGTERM')
      await exited
      await rm(path.join(directory, 'sshd.pid'), { force: true }).catch(() => {})
    },
  }
}
