import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'

const exec = promisify(execFile)
let pending: Promise<string | undefined> | undefined

async function readLoginShellPath(): Promise<string | undefined> {
  const shell = process.env.SHELL || os.userInfo().shell || '/bin/zsh'
  const child = exec(
    shell,
    // NUL delimiters isolate PATH from startup banners. printenv also handles
    // shells such as fish, where $PATH is a list rather than a plain string.
    ['-ilc', "printf '\\0'; /usr/bin/printenv PATH; printf '\\0'"],
    {
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'dumb' },
      encoding: 'utf8',
      signal: AbortSignal.timeout(3_000),
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    },
  )
  child.child.stdin?.end()
  const { stdout } = await child
  return stdout.split('\0')[1]?.replace(/\n$/, '') || undefined
}

export function loginShellPath(): Promise<string | undefined> {
  // Coalesce parallel MR queries, but read again on the next request so Refresh
  // can pick up newly installed tools and changes to the user's shell config.
  return (pending ??= readLoginShellPath()
    .catch(() => undefined)
    .finally(() => {
      pending = undefined
    }))
}
