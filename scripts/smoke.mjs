import { _electron as electron, expect as baseExpect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expect = baseExpect.configure({ timeout: 15_000 })
const windows = process.platform === 'win32'
const probePath = path.join(project, 'scripts/fixtures/terminal-probe.mjs')

function quote(value) {
  return windows ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`
}

function probe(action, ...args) {
  return [process.execPath, probePath, action, ...args].map(quote).join(' ')
}

function setVariable(name, value) {
  return windows ? `set ${name}=${value}` : `export ${name}=${quote(value)}`
}

function packagedExecutable() {
  if (process.platform === 'darwin') {
    return path.join(
      project,
      'dist',
      process.arch === 'arm64' ? 'mac-arm64' : 'mac',
      'Agent Workspace.app/Contents/MacOS/Agent Workspace',
    )
  }
  if (windows) return path.join(project, 'dist/win-unpacked/Agent Workspace.exe')
  return path.join(project, 'dist/linux-unpacked/agent-workspace')
}

const executablePath =
  process.env.AGENT_WORKSPACE_EXECUTABLE ||
  (process.argv.includes('--packaged') ? packagedExecutable() : undefined)
const base = path.join(os.tmpdir(), 'opencode')
await mkdir(base, { recursive: true })
const directory = await mkdtemp(path.join(base, 'agent-workspace-smoke-'))
const repository = path.join(directory, 'demo project')
const profile = path.join(directory, 'profile')
await mkdir(repository)
await mkdir(path.join(project, 'artifacts'), { recursive: true })

const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' })
git('init', '-b', 'main')
git('config', 'core.autocrlf', 'false')
await writeFile(path.join(repository, 'README.md'), '# Aurora App\n\nDesktop smoke-test fixture.\n')
await mkdir(path.join(repository, 'src'))
await writeFile(path.join(repository, 'src', 'app.ts'), 'export const name = "Aurora"\n')
git('add', '.')
git(
  '-c',
  'user.name=Smoke Test',
  '-c',
  'user.email=smoke@example.invalid',
  'commit',
  '-m',
  'Initialize Aurora application',
)

let app
let page
const errors = []
const logs = []

async function launch() {
  const env = { ...process.env, AGENT_WORKSPACE_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.AGENT_WORKSPACE_OPEN
  env.ZDOTDIR = directory
  env.HISTFILE = path.join(directory, 'shell-history')
  if (!windows) env.SHELL = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  const args = executablePath ? [] : [project]
  if (process.env.AGENT_WORKSPACE_SMOKE_NO_SANDBOX === '1') args.push('--no-sandbox')
  app = await electron.launch({
    executablePath,
    args,
    cwd: project,
    env,
    timeout: 60_000,
  })
  app.process().stderr?.on('data', (data) => logs.push(data.toString()))
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.waitForLoadState('domcontentloaded')
}

async function terminalCommand(command, index = 0) {
  const terminal = page.locator('.terminal-workspace:visible .terminal-pane').nth(index)
  await terminal.locator('textarea.xterm-helper-textarea').focus()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

try {
  await launch()
  await expect(page.getByRole('heading', { name: /Ein Workspace/ })).toBeVisible()
  await page.screenshot({ path: path.join(project, 'artifacts', 'welcome.png') })
  await app.evaluate(({ dialog }, repository) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repository] })
  }, repository)
  await page.getByRole('button', { name: 'Git-Repository öffnen' }).click()
  await expect(page.locator('.worktree-name strong')).toHaveText(['main'])
  await expect(page.locator('.terminal-process.running')).toHaveCount(1)
  await terminalCommand(probe('ready', 'MAIN'))
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText('MAIN_READY')
  await terminalCommand(setVariable('WORKTREE_SESSION', 'main-alive'))
  await terminalCommand(probe('tui'))
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText(
    'Desktop smoke-test fixture.',
  )
  await page.keyboard.type('q')
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).not.toContainText(
    'Press q to exit.',
  )
  await terminalCommand(probe('unicode'))
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText(
    'UNICODE_Grüße_日本',
  )
  // More than one flow-control window of output must drain without losing the tail.
  await terminalCommand(probe('flood'))
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText(
    'FLOW_CONTROL_COMPLETE',
  )

  await page.getByRole('button', { name: 'Neuer Worktree', exact: true }).click()
  await page.getByLabel('Branch-Name').fill('feat/auth-ui')
  await page
    .getByRole('textbox', { name: 'Aufgabe optional' })
    .fill('Login-Oberfläche implementieren')
  await page.getByRole('button', { name: 'Worktree erstellen' }).click()
  await expect(page.locator('.worktree-card')).toHaveCount(2)
  await expect(page.locator('.worktree-card.active .worktree-name strong')).toHaveText(
    'feat/auth-ui',
  )
  await expect(page.locator('.terminal-workspace:visible .terminal-process.running')).toHaveCount(1)
  await terminalCommand(probe('feature'))
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText(
    'FEATURE_READY',
  )

  await page.getByRole('button', { name: 'Terminal nebeneinander teilen' }).click()
  await expect(page.locator('.terminal-workspace:visible .terminal-pane')).toHaveCount(2)
  await expect(page.locator('.terminal-workspace:visible .terminal-process.running')).toHaveCount(2)
  await terminalCommand(probe('ready', 'SPLIT'), 1)
  await expect(
    page.locator('.terminal-workspace:visible .terminal-pane').nth(1).locator('.xterm-rows'),
  ).toContainText('SPLIT_READY')
  await terminalCommand(setVariable('SPLIT_SESSION', 'alive'), 1)
  await page.getByRole('button', { name: 'Terminal untereinander teilen' }).nth(1).click()
  await expect(page.locator('.terminal-workspace:visible .terminal-process.running')).toHaveCount(3)
  await page.getByRole('button', { name: 'Terminal schließen', exact: true }).last().click()
  await expect(page.locator('.terminal-workspace:visible .terminal-pane')).toHaveCount(2)
  await terminalCommand(probe('session', 'SPLIT_SESSION', 'SPLIT_STATE'), 1)
  await expect(
    page.locator('.terminal-workspace:visible .terminal-pane').nth(1).locator('.xterm-rows'),
  ).toContainText('SPLIT_STATE=alive')
  await terminalCommand('exit', 1)
  await expect(page.locator('.terminal-workspace:visible .terminal-process.exited')).toHaveCount(1)
  await page.getByRole('button', { name: 'Shell neu starten' }).click()
  await expect(page.locator('.terminal-workspace:visible .terminal-process.running')).toHaveCount(2)
  await terminalCommand(probe('ready', 'SHELL_RESTART'), 1)
  await expect(
    page.locator('.terminal-workspace:visible .terminal-pane').nth(1).locator('.xterm-rows'),
  ).toContainText('SHELL_RESTART_READY')

  await page
    .locator('.worktree-card')
    .filter({ has: page.locator('.worktree-name strong', { hasText: /^main$/ }) })
    .locator('.worktree-select')
    .click()
  await terminalCommand(probe('session', 'WORKTREE_SESSION', 'SESSION'))
  await expect(page.locator('.terminal-workspace:visible .xterm-rows')).toContainText(
    'SESSION=main-alive',
  )
  await page
    .locator('.worktree-card')
    .filter({ hasText: 'feat/auth-ui' })
    .locator('.worktree-select')
    .click()
  await expect(page.locator('.terminal-workspace:visible .terminal-pane')).toHaveCount(2)

  await page.getByRole('button', { name: 'Workspace aktualisieren', exact: true }).click()
  await expect(page.locator('.changed-file')).toContainText('src/auth.ts')
  await page.locator('.changed-file').click()
  await expect(page.locator('.code-preview')).toContainText('export const login = true')
  await page.getByRole('button', { name: 'Dialog schließen' }).click()

  await page.getByRole('tab', { name: 'Verlauf', exact: true }).click()
  await expect(page.locator('.commit')).toHaveCount(1)
  await page.locator('.commit').click()
  await expect(page.locator('.code-preview')).toContainText('Desktop smoke-test fixture')
  await page.getByRole('button', { name: 'Dialog schließen' }).click()
  await page.getByRole('tab', { name: 'Dateien', exact: true }).click()
  await page.getByRole('button', { name: 'src', exact: true }).click()
  await expect(page.getByRole('button', { name: 'auth.ts', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Änderungen', exact: true }).click()
  await page.screenshot({ path: path.join(project, 'artifacts', 'workspace.png') })

  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1400, 900),
  )
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1400)
  const width = await page
    .locator('.terminal-workspace:visible .terminal-host')
    .first()
    .evaluate((element) => element.clientWidth)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 800),
  )
  await expect
    .poll(() =>
      page
        .locator('.terminal-workspace:visible .terminal-host')
        .first()
        .evaluate((element) => element.clientWidth),
    )
    .toBeLessThan(width)

  // Quit deliberately, then verify saved layout and fresh shells after restart.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  await app.close()
  app = null
  await launch()
  await expect(page.locator('.worktree-card.active .worktree-name strong')).toHaveText(
    'feat/auth-ui',
  )
  await expect(page.locator('.terminal-workspace:visible .terminal-pane')).toHaveCount(2)
  await expect(page.locator('.terminal-workspace:visible .terminal-process.running')).toHaveCount(2)
  await terminalCommand(probe('ready', 'RESTART'))
  await expect(
    page.locator('.terminal-workspace:visible .terminal-pane').first().locator('.xterm-rows'),
  ).toContainText('RESTART_READY')
  expect(errors).toEqual([])

  // Closing both panes permits removal, but the uncommitted file still protects it.
  await page.getByRole('button', { name: 'Terminal schließen', exact: true }).first().click()
  await page.getByRole('button', { name: 'Terminal schließen', exact: true }).first().click()
  await page.getByRole('button', { name: 'Worktree feat/auth-ui entfernen' }).click()
  await page.getByRole('button', { name: 'Worktree entfernen', exact: true }).click()
  await expect(page.locator('dialog .inline-error')).toContainText('lokale Änderungen')
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click()

  const tracked = git('worktree', 'list', '--porcelain', '-z')
    .split('\0')
    .find((line) => line.startsWith('worktree ') && line.includes('.worktrees'))
  expect(
    await readFile(path.join(tracked.slice('worktree '.length), 'src/auth.ts'), 'utf8'),
  ).toContain('login = true')
  const featurePath = tracked.slice('worktree '.length)
  execFileSync('git', ['-C', featurePath, 'add', '--all'])
  execFileSync('git', [
    '-C',
    featurePath,
    '-c',
    'user.name=Smoke Test',
    '-c',
    'user.email=smoke@example.invalid',
    'commit',
    '-m',
    'Implement login',
  ])
  await page.getByRole('button', { name: 'Worktree feat/auth-ui entfernen' }).click()
  await page.getByRole('button', { name: 'Worktree entfernen', exact: true }).click()
  await expect(page.locator('.worktree-card')).toHaveCount(1)
  await expect(page.locator('.worktree-card.active .worktree-name strong')).toHaveText('main')
  expect(git('show', 'feat/auth-ui:src/auth.ts')).toContain('login = true')
  expect(errors).toEqual([])
  console.log(
    'Desktop smoke test passed: PTY, full-screen TUI, flow control, nested splits, shell restart, worktree isolation, session continuity, Git views, persistence and safe removal.',
  )
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: path.join(project, 'artifacts', 'failure.png') }).catch(() => {})
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
  await writeFile(path.join(project, 'artifacts', 'electron.log'), logs.join(''))
  await writeFile(
    path.join(project, 'artifacts', 'renderer-errors.json'),
    JSON.stringify(errors, null, 2),
  )
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
