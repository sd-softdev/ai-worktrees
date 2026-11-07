import { _electron as electron, expect as baseExpect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
// Give only the remote helper an isolated PATH with Git and no optional CLIs.
// Terminals and the SSH transport continue to use their normal environment.
const helperBin = path.join(directory, 'helper-bin')
const helperNode = path.join(directory, 'node with git-only PATH')
const helperShell = path.join(directory, 'shell with git-only PATH')
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
await mkdir(helperBin)
await symlink(
  execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
  path.join(helperBin, 'git'),
)
// Keep the macOS login-shell PATH fallback inside the same isolated environment.
await writeFile(
  helperShell,
  '#!/bin/sh\nif [ "$1" = "-ilc" ]; then shift; exec /bin/sh -c "$1"; fi\nexec /bin/sh "$@"\n',
  { mode: 0o700 },
)
await writeFile(
  helperNode,
  `#!/bin/sh\nexport PATH=${quote(helperBin)}\nexport SHELL=${quote(helperShell)}\nexec ${quote(process.execPath)} "$@"\n`,
  { mode: 0o700 },
)
const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' })
git('init', '-b', 'main')
await writeFile(path.join(repository, 'README.md'), '# Remote SSH workspace\n')
await writeFile(path.join(repository, '.gitignore'), '.hook-runs\n')
await writeFile(
  path.join(repository, 'setup.mts'),
  await readFile(path.join(project, 'scripts/fixtures/hook-setup.mts')),
)
const hookControl = path.join(directory, 'hook-control')
await writeFile(hookControl, 'wait')
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
  await page.getByRole('button', { name: 'Trust host' }).click()
  await page.getByLabel('Password / passphrase').fill(server.passphrase)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
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
    AGENT_WORKSPACE_DISABLE_UPDATE_CHECK: '1',
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
  await page.getByRole('button', { name: 'Connect via SSH', exact: true }).click()
  await page.getByRole('button', { name: 'workspace-smoke-host', exact: true }).click()
  await page.getByText('Remote runtime', { exact: true }).click()
  await page.getByLabel('Node.js on the remote host').fill(path.join(directory, 'missing node'))
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await authenticate()
  await expect(page.getByRole('alert')).toContainText('Node.js was not found')
  await expect(page.getByRole('alert')).toContainText('Install Node.js 20+')
  await expect(page.getByRole('alert')).toContainText('absolute executable path')
  await page.getByLabel('Node.js on the remote host').fill(helperNode)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await page.getByLabel('Password / passphrase').fill(server.passphrase)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByLabel('Remote path')).toBeVisible()
  await page.getByLabel('Remote path').fill(repository)
  await page.getByRole('button', { name: 'Open repository', exact: true }).click()
  await expect(page.locator('.local-badge')).toContainText('SSH · workspace-smoke-host')
  await expect(page.locator('.terminal-process.running')).toHaveCount(1)
  await page.getByRole('tab', { name: 'PR / MR' }).click()
  await expect(page.locator('.review-notice')).toContainText('Add a GitHub or GitLab remote')
  await expect(page.locator('.review-settings')).toContainText(
    'CLIs run on SSH host workspace-smoke-host',
  )
  git('remote', 'add', 'origin', 'https://github.com/team/project.git')
  await page.getByRole('button', { name: 'Refresh PR/MR status' }).click()
  await expect(page.locator('.review-notice')).toContainText('gh is not available on PATH')
  await expect(page.locator('.error-banner')).toHaveCount(0)
  git('remote', 'set-url', 'origin', 'https://gitlab.com/team/project.git')
  await page.getByLabel('PR/MR provider').selectOption('gitlab')
  await expect(page.locator('.review-notice')).toContainText('glab is not available on PATH')
  await expect(page.locator('.error-banner')).toHaveCount(0)
  await expect(page.locator('.terminal-process.running')).toHaveCount(1)
  git('remote', 'remove', 'origin')
  await page.getByLabel('PR/MR provider').selectOption('auto')
  await expect(page.locator('.review-notice')).toContainText('Add a GitHub or GitLab remote')
  await page.getByRole('tab', { name: 'Changes', exact: true }).click()
  const gitRemote = path.join(directory, 'git remote.git')
  git('init', '--bare', gitRemote)
  git('remote', 'add', 'origin', gitRemote)
  git('push', 'origin', 'HEAD:refs/heads/fetched')
  git('update-ref', '-d', 'refs/remotes/origin/fetched')
  await page.getByRole('button', { name: 'Fetch base repository' }).click()
  await expect(page.locator('.base-repository .git-operation-result')).toHaveText('Fetched origin.')
  expect(git('rev-parse', 'origin/fetched')).toBe(git('rev-parse', 'HEAD'))
  await command('export SSH_SESSION=remote-alive')
  await command('printf "SSH_%s\\n" READY')
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText('SSH_READY')
  await page.getByRole('button', { name: /^Hooks/ }).click()
  await expect(page.locator('.hook-settings')).toContainText('SSH host workspace-smoke-host')
  await page.getByLabel('Node.js executable').fill(helperNode)
  await page.getByRole('button', { name: 'Add hook' }).click()
  await page.locator('.hook-editor select').selectOption('typescript')
  await page.getByLabel('Script path').fill('setup.mts')
  await page.getByLabel('Arguments (one per line)').fill(hookControl)
  await page.getByRole('button', { name: 'Save hooks' }).click()
  await page.getByRole('button', { name: 'New worktree', exact: true }).click()
  await page.getByLabel('Branch name').fill('feat/remote')
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click()
  await expect(page.locator('.worktree-card.active .worktree-name strong')).toHaveText(
    'feat/remote',
  )
  await expect(page.locator('.terminal-workspace:visible .hook-output')).toContainText(
    'HOOK_READY:feat/remote',
  )
  await expect(page.getByRole('button', { name: 'Open terminal', exact: true })).toBeDisabled()
  await writeFile(hookControl, 'success')
  await expect(page.locator('.terminal-workspace:visible .hook-status')).toContainText(
    'Setup complete',
  )
  await expect(page.locator('.terminal-workspace:visible .terminal-process.running')).toHaveCount(1)
  await page.getByRole('button', { name: 'Push worktree feat/remote' }).click()
  await expect(page.locator('.worktree-list .git-operation-result')).toHaveText(
    'Pushed feat/remote to origin/feat/remote.',
  )
  expect(
    execFileSync('git', ['-C', gitRemote, 'rev-parse', 'refs/heads/feat/remote'], {
      encoding: 'utf8',
    }),
  ).toBe(git('rev-parse', 'HEAD'))
  await command('printf "REMOTE_FILE\\n" > remote.txt')
  await page.getByRole('button', { name: 'Refresh workspace', exact: true }).click()
  await expect(page.locator('.changed-file')).toContainText('remote.txt')
  await page.locator('.changed-file').click()
  await expect(page.locator('.code-preview')).toContainText('REMOTE_FILE')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.locator('.commit')).toContainText('Initial remote commit')
  await page.getByRole('tab', { name: 'Files', exact: true }).click()
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
  const receipt = await readFile(path.join(remoteWorktree, '.hook-runs'), 'utf8')
  expect(JSON.parse(receipt)).toMatchObject({
    branch: 'feat/remote',
    event: 'worktree.created',
    worktree: remoteWorktree,
    cwd: remoteWorktree,
  })
  await page.screenshot({ path: path.join(project, 'artifacts', 'ssh-workspace.png') })
  await server.disconnect()
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible()
  await page.getByRole('button', { name: 'Reconnect' }).click()
  await page.getByLabel('Password / passphrase').fill(server.passphrase)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('.remote-disconnected')).toHaveCount(0)
  await expect(page.locator('.worktree-card')).toHaveCount(2)
  await command('printf "RECONNECTED_%s\\n" READY')
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText(
    'RECONNECTED_READY',
  )
  expect(errors).toEqual([])
  expect(await readFile(path.join(remoteWorktree, '.hook-runs'), 'utf8')).toBe(receipt)
  await writeFile(hookControl, 'wait')
  await page.getByRole('button', { name: 'New worktree', exact: true }).click()
  await page.getByLabel('Branch name').fill('feat/interrupted')
  await page.getByRole('button', { name: 'Create worktree', exact: true }).click()
  const setup = page.locator('.terminal-workspace:visible .hook-status')
  await expect(setup.locator('.hook-output')).toContainText('HOOK_READY:feat/interrupted')
  const interruptedPath = await page.evaluate(async () => {
    const opened = await window.desktop.bootstrap()
    return opened.workspace.worktrees.find((tree) => tree.branch === 'feat/interrupted').path
  })
  const interruptedReceipt = path.join(interruptedPath, '.hook-runs')
  await server.disconnect()
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible()
  await page.getByRole('button', { name: 'Reconnect' }).click()
  await page.getByLabel('Password / passphrase').fill(server.passphrase)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(setup.getByRole('status')).toHaveText('Setup cancelled')
  await expect(page.locator('.terminal-workspace:visible .terminal-pane')).toHaveCount(0)
  expect((await readFile(interruptedReceipt, 'utf8')).trim().split('\n')).toHaveLength(1)
  await setup.getByRole('button', { name: 'Retry setup' }).click()
  await expect
    .poll(async () => (await readFile(interruptedReceipt, 'utf8')).trim().split('\n').length)
    .toBe(2)
  await writeFile(hookControl, 'success')
  await expect(setup.getByRole('status')).toHaveText('Setup complete')
  await expect(page.locator('.terminal-workspace:visible .terminal-process.running')).toHaveCount(1)
  expect(errors).toEqual([])
  console.log(
    'SSH desktop test passed: OpenSSH config, host trust, encrypted key, remote Git fetch/push, files, native TypeScript hooks, setup interruption/retry, worktree creation, PTY, session continuity and reconnect.',
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
