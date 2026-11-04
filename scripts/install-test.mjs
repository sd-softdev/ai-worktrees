import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
const windows = process.platform === 'win32'
const mac = process.platform === 'darwin'
if (!mac && !process.env.CI)
  throw new Error('Windows/Linux installer integration tests require an isolated CI runner.')
const platform = mac ? 'mac' : windows ? 'win' : 'linux'
const extension = mac ? 'dmg' : windows ? 'exe' : 'deb'
const name = `agent-workspace-${version}-${platform}-${process.arch}.${extension}`
const asset = path.join(project, 'dist', name)
const hash = createHash('sha256')
  .update(await readFile(asset))
  .digest('hex')
const base = path.join(os.tmpdir(), 'opencode')
await mkdir(base, { recursive: true })
const directory = await mkdtemp(path.join(base, 'aw-install-test-'))
const destination = path.join(directory, 'Applications With Spaces')
const checksums = path.join(directory, 'SHA256SUMS')
const corrupt = path.join(directory, 'INVALID_SUMS')
await writeFile(checksums, `${hash}  ${name}\n`)
await writeFile(corrupt, `${'0'.repeat(64)}  ${name}\n`)

function install(checksumFile, dryRun = false) {
  const args = windows
    ? [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(project, 'install.ps1'),
        '-Version',
        `v${version}`,
        '-InstallerPath',
        asset,
        '-ChecksumPath',
        checksumFile,
        '-InstallDirectory',
        destination,
        ...(dryRun ? ['-DryRun'] : []),
      ]
    : [
        path.join(project, 'install.sh'),
        '--version',
        `v${version}`,
        '--asset',
        asset,
        '--checksums',
        checksumFile,
        ...(mac ? ['--install-dir', destination] : []),
        ...(dryRun ? ['--dry-run'] : []),
      ]
  return spawnSync(windows ? 'powershell.exe' : 'bash', args, {
    encoding: 'utf8',
    cwd: project,
    timeout: 180_000,
  })
}

try {
  const dry = install(checksums, true)
  assert.equal(dry.status, 0, dry.stderr)
  assert.ok(dry.stdout.includes(name))
  const rejected = install(corrupt)
  assert.notEqual(rejected.status, 0, 'Corrupt installer must be rejected')
  assert.match(rejected.stdout + rejected.stderr, /SHA-256/)
  const result = install(checksums)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  console.log(result.stdout)
  const executable = mac
    ? path.join(destination, 'Agent Workspace.app/Contents/MacOS/Agent Workspace')
    : windows
      ? path.join(destination, 'Agent Workspace.exe')
      : '/opt/Agent Workspace/agent-workspace'
  await access(executable)
  const smoke = spawnSync(process.execPath, ['scripts/smoke.mjs'], {
    cwd: project,
    stdio: 'inherit',
    env: { ...process.env, AGENT_WORKSPACE_EXECUTABLE: executable },
    timeout: 180_000,
  })
  assert.equal(smoke.status, 0, 'Installed desktop application smoke test failed')
  if (process.platform === 'linux') {
    const portableName = `agent-workspace-${version}-linux-x64.AppImage`
    const portableAsset = path.join(project, 'dist', portableName)
    const portableHash = createHash('sha256')
      .update(await readFile(portableAsset))
      .digest('hex')
    await writeFile(checksums, `${portableHash}  ${portableName}\n`)
    const home = path.join(directory, 'portable-home')
    await mkdir(home)
    const portable = spawnSync(
      'bash',
      [
        path.join(project, 'install.sh'),
        '--portable',
        '--version',
        `v${version}`,
        '--asset',
        portableAsset,
        '--checksums',
        checksums,
        '--install-dir',
        destination,
      ],
      { encoding: 'utf8', cwd: project, env: { ...process.env, HOME: home }, timeout: 180_000 },
    )
    assert.equal(portable.status, 0, portable.stdout + portable.stderr)
    const executable = path.join(destination, 'agent-workspace.AppImage')
    assert.equal(await readlink(path.join(home, '.local/bin/agent-workspace')), executable)
    const desktop = await readFile(
      path.join(home, '.local/share/applications/agent-workspace.desktop'),
      'utf8',
    )
    assert.ok(desktop.includes(`Exec="${executable}" %U`))
    const smoke = spawnSync(process.execPath, ['scripts/smoke.mjs'], {
      cwd: project,
      stdio: 'inherit',
      timeout: 180_000,
      env: {
        ...process.env,
        AGENT_WORKSPACE_EXECUTABLE: executable,
        APPIMAGE_EXTRACT_AND_RUN: '1',
      },
    })
    assert.equal(smoke.status, 0, 'Installed AppImage smoke test failed')
    console.log(
      'Portable installer test passed: AppImage installation, launcher, desktop entry and installed-app smoke test.',
    )
  }
  console.log(
    'Installer test passed: platform selection, checksum rejection, installation and real installed-app smoke test.',
  )
} finally {
  if (windows) {
    const uninstall = path.join(destination, 'Uninstall Agent Workspace.exe')
    try {
      await access(uninstall)
      spawnSync(uninstall, ['/S'], { timeout: 60_000 })
    } catch {}
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
