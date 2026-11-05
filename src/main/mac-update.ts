import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const bundleId = 'dev.agentworkspace.desktop'
const executableName = 'Agent Workspace'
const errorFile = 'mac-install-error.txt'

export function macBundlePath(executable: string): string {
  const bundle = path.resolve(path.dirname(executable), '../..')
  if (
    !bundle.endsWith('.app') ||
    path.relative(bundle, executable) !== `Contents/MacOS/${executableName}`
  )
    throw new Error('Please run Agent Workspace from its installed application bundle.')
  return bundle
}

async function bundleInfo(bundle: string, key: string): Promise<string> {
  const { stdout } = await exec(
    '/usr/libexec/PlistBuddy',
    ['-c', `Print ${key}`, path.join(bundle, 'Contents/Info.plist')],
    { timeout: 10_000 },
  )
  return stdout.trim()
}

async function validateBundle(bundle: string, version?: string): Promise<void> {
  if (
    (await bundleInfo(bundle, 'CFBundleIdentifier')) !== bundleId ||
    (await bundleInfo(bundle, 'CFBundleExecutable')) !== executableName
  )
    throw new Error('The update does not contain the expected Agent Workspace application.')
  if (version && (await bundleInfo(bundle, 'CFBundleShortVersionString')) !== version)
    throw new Error('The application inside the update has an unexpected version.')
  await access(path.join(bundle, 'Contents/MacOS', executableName), constants.X_OK)
}

// This independent system process survives replacement of the Electron bundle.
// Paths and relaunch arguments are passed as argv, never interpolated into shell code.
const installer = `
set -euo pipefail
parent_pid="$1"
target="$2"
stage="$3"
error_file="$4"
log_file="$5"
shift 5
previous="$stage/previous.app"
next="$stage/next.app"

relaunch() {
  "$target/Contents/MacOS/Agent Workspace" "$@" </dev/null >>"$log_file" 2>&1 &
}
fail() {
  message="$1"
  shift
  if [ -d "$previous" ] && [ ! -e "$target" ]; then
    if ! /bin/mv "$previous" "$target"; then
      message="$message The previous app is preserved at $previous."
    fi
  fi
  printf '%s\\n' "$message" >"$error_file"
  if [ -d "$target" ] && ! /bin/kill -0 "$parent_pid" 2>/dev/null; then
    relaunch "$@"
  fi
  if [ ! -d "$previous" ]; then /bin/rm -rf "$stage"; fi
  exit 1
}

exec 3>&1
exec >>"$log_file" 2>&1
printf 'ready\\n' >&3
exec 3>&-
attempts=0
while /bin/kill -0 "$parent_pid" 2>/dev/null; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 300 ]; then
    fail 'Agent Workspace did not exit. The installed app was kept. Please retry the update.' "$@"
  fi
  /bin/sleep 0.2
done
if ! /bin/mv "$target" "$previous"; then
  fail 'Could not move the installed app. Please check permissions and retry the update.' "$@"
fi
if ! /bin/mv "$next" "$target"; then
  fail 'Could not replace the installed app. The previous version was restored.' "$@"
fi
/bin/rm -f "$error_file"
relaunch "$@"
/bin/rm -rf "$stage"
`

interface MacUpdateOptions {
  executable: string
  directory: string
  pid: number
  args: string[]
}

function startInstaller(target: string, stage: string, options: MacUpdateOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      '/bin/bash',
      [
        '-c',
        installer,
        'agent-workspace-update',
        String(options.pid),
        target,
        stage,
        path.join(options.directory, errorFile),
        path.join(options.directory, 'mac-install.log'),
        ...options.args,
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let diagnostic = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('The macOS update helper did not start. Please try again.'))
    }, 10_000)
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(diagnostic || `The macOS update helper exited (${code}).`))
    })
    child.stdout.once('data', (chunk: Buffer) => {
      if (chunk.toString().trim() !== 'ready') return
      clearTimeout(timer)
      child.stdout.destroy()
      child.stderr.destroy()
      child.unref()
      resolve()
    })
  })
}

export async function installMacUpdate(
  filename: string,
  version: string,
  options: MacUpdateOptions,
): Promise<void> {
  const target = macBundlePath(await realpath(options.executable))
  if (target.startsWith('/Volumes/') || target.includes('/AppTranslocation/'))
    throw new Error('Install Agent Workspace in a writable Applications folder before updating it.')
  await validateBundle(target)
  const parent = path.dirname(target)
  let stage: string
  try {
    stage = await mkdtemp(path.join(parent, '.agent-workspace-update-'))
  } catch {
    throw new Error(
      `Cannot update ${target}. You need write permission for its installation folder.`,
    )
  }
  let temporary: string | undefined
  let mounted = false
  let handedOff = false
  try {
    await mkdir(options.directory, { recursive: true })
    temporary = await mkdtemp(path.join(options.directory, 'mac-mount-'))
    const mount = path.join(temporary, 'volume')
    await mkdir(mount)
    await exec(
      '/usr/bin/hdiutil',
      ['attach', filename, '-readonly', '-nobrowse', '-mountpoint', mount, '-quiet'],
      { timeout: 60_000 },
    )
    mounted = true
    const source = path.join(mount, 'Agent Workspace.app')
    await validateBundle(source, version)
    const next = path.join(stage, 'next.app')
    await exec('/usr/bin/ditto', [source, next], { timeout: 120_000 })
    await validateBundle(next, version)
    await exec('/usr/bin/hdiutil', ['detach', mount, '-quiet'], { timeout: 30_000 })
    mounted = false
    await startInstaller(target, stage, options)
    handedOff = true
  } finally {
    if (mounted && temporary)
      await exec('/usr/bin/hdiutil', ['detach', path.join(temporary, 'volume'), '-quiet'], {
        timeout: 30_000,
      })
        .then(() => {
          mounted = false
        })
        .catch(() => {})
    if (temporary && !mounted) await rm(temporary, { recursive: true, force: true }).catch(() => {})
    if (!handedOff) await rm(stage, { recursive: true, force: true })
  }
}

export async function consumeMacUpdateError(directory: string): Promise<string | undefined> {
  const filename = path.join(directory, errorFile)
  try {
    const message = await readFile(filename, 'utf8')
    await rm(filename)
    return message.trim()
  } catch {
    return undefined
  }
}
