import { stat } from 'node:fs/promises'
import path from 'node:path'

export async function sshExecutable(): Promise<string> {
  if (process.platform !== 'win32') return 'ssh'
  // ConPTY does not apply PATHEXT and node-pty's PATH lookup drops its last
  // entry. Resolve an absolute .exe path for both RPC and terminal connections.
  const env = Object.fromEntries(
    Object.entries(process.env).map(([key, value]) => [key.toLowerCase(), value]),
  )
  const directories = (env.path ?? '').split(';').filter(Boolean)
  if (env.systemroot) directories.push(path.join(env.systemroot, 'System32', 'OpenSSH'))
  for (const directory of directories) {
    const candidate = path.resolve(directory.replace(/^"|"$/g, ''), 'ssh.exe')
    if (
      await stat(candidate)
        .then((info) => info.isFile())
        .catch(() => false)
    )
      return candidate
  }
  throw new Error(
    'OpenSSH Client was not found. Enable OpenSSH Client in Windows Settings → Optional features, then restart Agent Workspace.',
  )
}
