import { _electron as electron, expect as baseExpect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startSshServer } from './fixtures/ssh-server.mjs'

const expect = baseExpect.configure({ timeout: 30_000 })
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(os.tmpdir(), 'opencode')
await mkdir(base, { recursive: true })
const directory = await mkdtemp(path.join(base, 'aw-ssh-smoke-'))
const repository = path.join(directory, "remote repo's files")
await mkdir(repository)
await mkdir(path.join(project, 'artifacts'), { recursive: true })
const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' })
git('init', '-b', 'main')
await writeFile(path.join(repository, 'README.md'), '# Remote SSH workspace\n')
git('add', '.')
git(
  '-c',
  'user.name=SSH Test',
  '-c',
  'user.email=test@example.invalid',
  'commit',
  '-m',
  'Initial remote commit',
)
let server
let app
let page
const errors = []
const logs = []

async function authenticate() {
  await page.getByRole('button', { name: 'Host vertrauen' }).click()
  await page.getByLabel('Passwort / Passphrase').fill(server.passphrase)
  await page.getByRole('button', { name: 'Bestätigen', exact: true }).click()
}

async function command(value) {
  await page.locator('.terminal-workspace:visible textarea.xterm-helper-textarea').first().focus()
  await page.keyboard.type(value)
  await page.keyboard.press('Enter')
}

try {
  server = await startSshServer(path.join(directory, 'ssh'))
  const env = {
    ...process.env,
    AGENT_WORKSPACE_USER_DATA: path.join(directory, 'profile'),
    AGENT_WORKSPACE_SSH_CONFIG: server.config,
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.AGENT_WORKSPACE_OPEN
  const executablePath =
    process.env.AGENT_WORKSPACE_EXECUTABLE ||
    (process.argv.includes('--packaged')
      ? process.platform === 'darwin'
        ? path.join(
            project,
            `dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Agent Workspace.app/Contents/MacOS/Agent Workspace`,
          )
        : path.join(project, 'dist/linux-unpacked/agent-workspace')
      : undefined)
  const args = executablePath ? [] : [project]
  if (process.env.AGENT_WORKSPACE_SMOKE_NO_SANDBOX === '1') args.push('--no-sandbox')
  app = await electron.launch({ executablePath, args, env, timeout: 60_000 })
  app.process().stderr?.on('data', (chunk) => logs.push(chunk.toString()))
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.getByRole('button', { name: 'SSH verbinden', exact: true }).click()
  await page.getByRole('button', { name: 'workspace-smoke-host', exact: true }).click()
  await page.getByText('Remote-Laufzeit', { exact: true }).click()
  await page.getByLabel('Node.js auf dem Remote-Host').fill(process.execPath)
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click()
  await authenticate()
  await expect(page.getByLabel('Remote-Pfad')).toBeVisible()
  await page.getByLabel('Remote-Pfad').fill(repository)
  await page.getByRole('button', { name: 'Repository öffnen', exact: true }).click()
  await expect(page.locator('.local-badge')).toContainText('SSH · workspace-smoke-host')
  await expect(page.locator('.terminal-process.running')).toHaveCount(1)
  await command('export SSH_SESSION=remote-alive')
  await command('printf "SSH_%s\\n" READY')
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText('SSH_READY')
  await page.getByRole('button', { name: 'Neuer Worktree', exact: true }).click()
  await page.getByLabel('Branch-Name').fill('feat/remote')
  await page.getByRole('button', { name: 'Worktree erstellen', exact: true }).click()
  await expect(page.locator('.worktree-card.active .worktree-name strong')).toHaveText(
    'feat/remote',
  )
  await expect(page.locator('.terminal-workspace:visible .terminal-process.running')).toHaveCount(1)
  await command('printf "REMOTE_FILE\\n" > remote.txt')
  await page.getByRole('button', { name: 'Workspace aktualisieren', exact: true }).click()
  await expect(page.locator('.changed-file')).toContainText('remote.txt')
  await page.locator('.changed-file').click()
  await expect(page.locator('.code-preview')).toContainText('REMOTE_FILE')
  await page.getByRole('button', { name: 'Dialog schließen' }).click()
  await page.getByRole('tab', { name: 'Verlauf', exact: true }).click()
  await expect(page.locator('.commit')).toContainText('Initial remote commit')
  await page.getByRole('tab', { name: 'Dateien', exact: true }).click()
  await expect(page.getByRole('button', { name: 'remote.txt', exact: true })).toBeVisible()
  await page
    .locator('.worktree-card')
    .filter({ has: page.locator('.worktree-name strong', { hasText: /^main$/ }) })
    .locator('.worktree-select')
    .click()
  await command('printf "SESSION=%s\\n" "$SSH_SESSION"')
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText(
    'SESSION=remote-alive',
  )
  const remoteWorktree = git('worktree', 'list', '--porcelain', '-z')
    .split('\0')
    .find((line) => line.startsWith('worktree ') && line.includes('.worktrees'))
    .slice(9)
  expect(await readFile(path.join(remoteWorktree, 'remote.txt'), 'utf8')).toBe('REMOTE_FILE\n')
  await page.screenshot({ path: path.join(project, 'artifacts', 'ssh-workspace.png') })
  await server.disconnect()
  await expect(page.getByRole('button', { name: 'Wiederverbinden' })).toBeVisible()
  await page.getByRole('button', { name: 'Wiederverbinden' }).click()
  await page.getByLabel('Passwort / Passphrase').fill(server.passphrase)
  await page.getByRole('button', { name: 'Bestätigen', exact: true }).click()
  await expect(page.locator('.remote-disconnected')).toHaveCount(0)
  await expect(page.locator('.worktree-card')).toHaveCount(2)
  await command('printf "RECONNECTED_%s\\n" READY')
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText(
    'RECONNECTED_READY',
  )
  expect(errors).toEqual([])
  console.log(
    'SSH desktop test passed: OpenSSH config, host trust, encrypted key, remote Git, files, worktree creation, PTY, session continuity and reconnect.',
  )
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: path.join(project, 'artifacts', 'ssh-failure.png') })
      .catch(() => {})
  throw error
} finally {
  if (app) {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      })
      .catch(() => {})
    await app.close().catch(() => {})
  }
  if (server) {
    await writeFile(path.join(project, 'artifacts', 'sshd.log'), server.logs())
    await server.close()
  }
  await writeFile(path.join(project, 'artifacts', 'ssh-electron.log'), logs.join(''))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
