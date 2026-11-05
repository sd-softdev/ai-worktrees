import assert from 'node:assert/strict'
import { _electron as electron, expect as baseExpect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeUpdateMetadata } from './update-metadata.mjs'
import { macUpdateFixture } from './fixtures/mac-update.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
const expect = baseExpect.configure({ timeout: 30_000 })
const base = path.join(os.tmpdir(), 'opencode')
await mkdir(base, { recursive: true })
const directory = await realpath(await mkdtemp(path.join(base, 'update-smoke-')))
const profile = path.join(directory, 'profile')
const repository = path.join(directory, 'repository')
const packages = path.join(directory, 'packages')
await mkdir(repository)
await mkdir(packages)
execFileSync('git', ['init', '-b', 'main', repository])
await writeFile(path.join(repository, 'README.md'), '# Update smoke test\n')
execFileSync('git', ['-C', repository, 'add', '.'])
execFileSync('git', [
  '-C',
  repository,
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.invalid',
  'commit',
  '-m',
  'Initial',
])
const nextVersion = '99.0.0'
const mac = process.platform === 'darwin'
let executablePath =
  process.env.AGENT_WORKSPACE_EXECUTABLE ||
  path.join(
    project,
    mac
      ? `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Agent Workspace.app/Contents/MacOS/Agent Workspace`
      : process.platform === 'win32'
        ? 'dist/win-unpacked/Agent Workspace.exe'
        : 'dist/linux-unpacked/agent-workspace',
  )
const fixture = mac ? await macUpdateFixture(directory, executablePath, nextVersion) : null
if (fixture) executablePath = fixture.executable
const data = Buffer.alloc(2 * 1024 ** 2, 'update-fixture')
for (const suffix of [
  'win-x64.exe',
  'mac-arm64.dmg',
  'mac-x64.dmg',
  'linux-x86_64.AppImage',
  'linux-amd64.deb',
])
  await writeFile(path.join(packages, `agent-workspace-${nextVersion}-${suffix}`), data)
if (fixture) await copyFile(fixture.dmg, path.join(packages, path.basename(fixture.dmg)))
await writeUpdateMetadata(packages, nextVersion)
let remoteVersion = version
let offline = true
let downloadMode = 'corrupt'
let requests = 0
const server = createServer(async (request, response) => {
  try {
    const name = path.basename(new URL(request.url, 'http://localhost').pathname)
    if (name.endsWith('.yml')) {
      if (offline) {
        response.writeHead(503)
        response.end('Temporarily unavailable')
        return
      }
      const metadata = JSON.parse(await readFile(path.join(packages, name), 'utf8'))
      metadata.version = remoteVersion
      response.end(JSON.stringify(metadata))
      return
    }
    const payload = await readFile(path.join(packages, name))
    requests++
    response.writeHead(200, {
      'Content-Length': payload.length,
      'Content-Type': 'application/octet-stream',
    })
    if (downloadMode === 'corrupt') response.end(Buffer.alloc(payload.length))
    else if (downloadMode === 'slow') {
      response.write(payload.subarray(0, 1024))
      const timer = setTimeout(() => response.end(payload.subarray(1024)), 30_000)
      response.on('close', () => clearTimeout(timer))
    } else response.end(payload)
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${server.address().port}`
const env = {
  ...process.env,
  AGENT_WORKSPACE_USER_DATA: profile,
  AGENT_WORKSPACE_OPEN: repository,
  AGENT_WORKSPACE_DISABLE_UPDATE_CHECK: '1',
}
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let app
let page
const logs = []
try {
  app = await electron.launch({
    executablePath,
    env,
    args: process.env.AGENT_WORKSPACE_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : [],
    timeout: 60_000,
  })
  app.process().stderr?.on('data', (chunk) => logs.push(chunk.toString()))
  page = await app.firstWindow()
  await expect(page.locator('.terminal-process.running')).toHaveCount(1)
  // Exercise the real updater/provider and IPC against a local release server.
  // macOS updates an isolated real app copy; other platforms intercept OS installation.
  await app.evaluate(
    ({ app, autoUpdater: native, dialog, net, shell }, { endpoint, directory }) => {
      const updater = process.mainModule.require('electron-updater').autoUpdater
      updater.setFeedURL({ provider: 'generic', url: endpoint })
      Object.defineProperty(updater.app, 'baseCachePath', { value: `${directory}/cache` })
      if (process.platform === 'linux') process.env.APPIMAGE = `${directory}/current.AppImage`
      const fetch = net.fetch.bind(net)
      net.fetch = (url, options) =>
        fetch(`${endpoint}/${new URL(String(url)).pathname.split('/').pop()}`, options)
      globalThis.updateProbe = {
        opened: null,
        installs: 0,
        quits: 0,
        confirmation: 0,
        prompts: [],
        originalQuit: app.quit.bind(app),
      }
      app.quit = () => {
        globalThis.updateProbe.quits++
      }
      shell.openPath = async (filename) => {
        globalThis.updateProbe.opened = filename
        return ''
      }
      updater.quitAndInstall = () => {
        globalThis.updateProbe.installs++
        native.emit('before-quit-for-update')
        app.quit()
      }
      dialog.showMessageBox = async (_window, options) => {
        globalThis.updateProbe.prompts.push(options)
        process.mainModule
          .require('node:fs')
          .writeFileSync(
            `${directory}/prompts.json`,
            JSON.stringify(globalThis.updateProbe.prompts),
          )
        return { response: globalThis.updateProbe.confirmation, checkboxChecked: false }
      }
      globalThis.updateProbe.automatic = {
        download: updater.autoDownload,
        install: updater.autoInstallOnAppQuit,
      }
    },
    { endpoint, directory },
  )
  await page.getByRole('button', { name: 'Updates', exact: true }).click()
  if (fixture) await expect(page.locator('.update-installation-path')).toContainText(fixture.bundle)
  await expect(page.locator('dialog [role="alert"]')).toBeVisible()
  await expect(page.locator('.terminal-process.running')).toHaveCount(1)
  offline = false
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await expect(page.getByText('You are using the latest version.')).toBeVisible()
  assert.equal(requests, 0, 'Checking must not download an installer')
  remoteVersion = '0.0.1'
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
  assert.equal((await page.evaluate(() => window.desktop.checkForUpdates())).status, 'up-to-date')
  await expect(page.getByText('You are using the latest version.')).toBeVisible()
  remoteVersion = nextVersion
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click()
  await expect(page.getByText(`Version ${nextVersion} is available.`)).toBeVisible()
  assert.equal(requests, 0)
  await page.getByRole('button', { name: 'Download update', exact: true }).click()
  await expect(page.locator('dialog [role="alert"]')).toContainText(/checksum/i)
  assert.equal(await app.evaluate(() => globalThis.updateProbe.installs), 0)
  downloadMode = 'slow'
  await page.getByRole('button', { name: 'Download update', exact: true }).click()
  await expect.poll(() => requests).toBeGreaterThan(1)
  await page.getByRole('button', { name: 'Cancel download' }).click()
  await expect(page.getByText(`Version ${nextVersion} is available.`)).toBeVisible()
  downloadMode = 'valid'
  await page.getByRole('button', { name: 'Download update', exact: true }).click()
  await expect(page.getByText('The update is verified and ready to install.')).toBeVisible()
  await mkdir(path.join(project, 'artifacts'), { recursive: true })
  await page.screenshot({ path: path.join(project, 'artifacts/updates.png') })
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.locator('.terminal-process.running')).toHaveCount(1)
  await page.getByRole('button', { name: 'Updates', exact: true }).click()
  const install = page.getByRole('button', {
    name: 'Restart & install',
    exact: true,
  })
  await install.click()
  await expect(install).toBeEnabled()
  const cancelled = await app.evaluate(() => ({
    opened: globalThis.updateProbe.opened,
    installs: globalThis.updateProbe.installs,
    quits: globalThis.updateProbe.quits,
    automatic: globalThis.updateProbe.automatic,
  }))
  assert.deepEqual(cancelled, {
    opened: null,
    installs: 0,
    quits: 0,
    automatic: { download: false, install: false },
  })
  await expect(page.locator('.terminal-process.running')).toHaveCount(1)
  await app.evaluate(({ app }) => {
    globalThis.updateProbe.confirmation = 1
    if (process.platform === 'darwin') app.quit = globalThis.updateProbe.originalQuit
  })
  const closed = fixture ? app.waitForEvent('close', { timeout: 180_000 }) : null
  await install.click()
  if (fixture) {
    await closed
    app = null
    await expect
      .poll(() => readFile(fixture.receipt, 'utf8').catch(() => ''), { timeout: 60_000 })
      .not.toBe('')
    const launched = JSON.parse(await readFile(fixture.receipt, 'utf8'))
    assert.equal(launched.version, nextVersion)
    assert.equal(launched.update.currentVersion, nextVersion)
    assert.equal(launched.executable, fixture.executable)
    assert.equal(launched.userData, profile)
    assert.equal(
      await readFile(path.join(fixture.alternate, 'keep.txt'), 'utf8'),
      'Other installation must remain untouched.',
    )
    await expect
      .poll(() => {
        try {
          process.kill(launched.pid, 0)
          return true
        } catch {
          return false
        }
      })
      .toBe(false)
  } else {
    await expect.poll(() => app.evaluate(() => globalThis.updateProbe.quits)).toBe(1)
    assert.equal(await app.evaluate(() => globalThis.updateProbe.installs), 1)
  }
  const prompts = JSON.parse(await readFile(path.join(directory, 'prompts.json'), 'utf8'))
  assert.equal(prompts.length, 2)
  assert.match(prompts[0].detail, /SSH terminals/)
  assert.ok(
    (await readdir(path.join(profile, 'workspaces'))).some((name) => name.startsWith('workspace-')),
  )
  console.log(
    `Update smoke test passed: current/older/new releases, checksum rejection, cancellation, retry, terminal confirmation and ${fixture ? 'in-place macOS replacement with verified relaunch/version' : 'native installer handoff'}.`,
  )
} catch (error) {
  await mkdir(path.join(project, 'artifacts'), { recursive: true })
  if (page && !page.isClosed())
    await page
      .screenshot({ path: path.join(project, 'artifacts/update-failure.png') })
      .catch(() => {})
  await writeFile(path.join(project, 'artifacts/update-main.log'), logs.join(''))
  if (fixture) {
    const diagnostic = await readFile(path.join(profile, 'updates/mac-install.log'), 'utf8').catch(
      () => '',
    )
    await writeFile(path.join(project, 'artifacts/mac-install.log'), diagnostic)
  }
  throw error
} finally {
  if (app) {
    await app
      .evaluate(({ app }) => {
        if (globalThis.updateProbe) app.quit = globalThis.updateProbe.originalQuit
      })
      .catch(() => {})
    await app.close()
  }
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
