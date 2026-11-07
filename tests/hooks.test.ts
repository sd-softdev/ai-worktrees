import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HookRunner } from '../src/main/hooks'
import { SettingsStore } from '../src/main/settings'
import { WorkspaceService } from '../src/main/workspace'
import type { TerminalService } from '../src/main/terminals'
import { git } from '../src/main/git'
import { mergeHookRuns } from '../src/shared/hooks'
import {
  defaultPreferences,
  type HookPreferences,
  type HookRun,
  type Workspace,
  type WorktreeHook,
} from '../src/shared/types'

let directory: string
let root: string
let tree: string
let runner: HookRunner
let service: WorkspaceService | undefined
const hook = (command: string, extra: Partial<WorktreeHook> = {}): WorktreeHook => ({
  id: randomUUID(),
  name: command,
  enabled: true,
  kind: 'javascript',
  command,
  args: [],
  timeoutSeconds: 5,
  ...extra,
})
const preferences = (...created: WorktreeHook[]): HookPreferences => ({
  nodePath: process.execPath,
  created,
})
const workspace = (): Workspace => ({
  id: root,
  name: 'Test',
  rootPath: root,
  commonDir: root,
  worktrees: [
    {
      path: tree,
      branch: 'feat/context',
      head: '',
      isMain: false,
      locked: false,
      missing: false,
      prunable: false,
      changedFiles: 0,
    },
  ],
  branches: ['feat/context'],
  defaultBase: 'main',
})
const result = () => runner.snapshots()[0]
async function finished() {
  await expect.poll(() => result()?.status, { timeout: 10_000 }).not.toBe('running')
  return result()
}

beforeEach(async () => {
  const base = path.join(os.tmpdir(), 'opencode')
  await mkdir(base, { recursive: true })
  directory = await realpath(await mkdtemp(path.join(base, 'workspace-hooks-')))
  root = path.join(directory, 'base repo')
  tree = path.join(directory, "new worktree's files")
  await mkdir(root)
  await mkdir(tree)
  if (process.platform !== 'win32') {
    vi.stubEnv('SHELL', '/bin/sh')
    vi.stubEnv('HOME', directory)
  }
  runner = new HookRunner()
})

afterEach(async () => {
  service?.close()
  service = undefined
  for (const run of runner.snapshots()) runner.cancel(run.worktreePath)
  await expect.poll(() => runner.snapshots().some((run) => run.status === 'running')).toBe(false)
  runner.clear()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('worktree hook execution', () => {
  it('runs shell, native TypeScript and JavaScript in order with literal arguments and worktree context', async () => {
    await writeFile(
      path.join(tree, 'setup.mts'),
      `import { writeFileSync } from 'node:fs';
const branch: string = process.env.WORKTREE_BRANCH!;
writeFileSync('receipt.json', JSON.stringify({ branch, root: process.env.REPOSITORY_PATH, worktree: process.env.WORKTREE_PATH, event: process.env.WORKTREE_EVENT, cwd: process.cwd(), args: process.argv.slice(2) }));
console.log('TYPESCRIPT_DONE');`,
    )
    await writeFile(
      path.join(tree, 'finish.mjs'),
      "import { readFileSync } from 'node:fs'; console.log(JSON.parse(readFileSync('receipt.json')).branch)",
    )
    const args = ['argument with spaces', '$HOME; echo not-a-command']
    const context = workspace()
    runner.start(
      context,
      context.worktrees[0],
      preferences(
        hook('echo SHELL_DONE', { kind: 'shell' }),
        hook('setup.mts', { kind: 'typescript', args }),
        hook('finish.mjs'),
        hook('missing.mjs', { enabled: false }),
      ),
    )
    const run = await finished()
    expect(run.status).toBe('succeeded')
    expect(run.output).toMatch(/SHELL_DONE[\s\S]*TYPESCRIPT_DONE[\s\S]*feat\/context/)
    expect(JSON.parse(await readFile(path.join(tree, 'receipt.json'), 'utf8'))).toEqual({
      branch: 'feat/context',
      root,
      worktree: tree,
      event: 'worktree.created',
      cwd: tree,
      args,
    })
  })

  it('stops on failure, retains output and permits an explicit retry', async () => {
    await writeFile(path.join(tree, 'fail.mjs'), "console.error('SETUP_DETAIL'); process.exit(7)")
    const context = workspace()
    runner.start(context, context.worktrees[0], preferences(hook('fail.mjs'), hook('never.mjs')))
    expect(await finished()).toMatchObject({
      status: 'failed',
      step: 1,
      error: 'Hook exited with code 7.',
    })
    expect(result().output).toContain('SETUP_DETAIL')
    const id = result().id
    await writeFile(path.join(tree, 'fail.mjs'), "console.log('RECOVERED')")
    runner.start(context, context.worktrees[0], preferences(hook('fail.mjs')))
    expect((await finished()).status).toBe('succeeded')
    expect(result().id).not.toBe(id)
  })

  it('cancels child process trees and rejects overlapping runs', async () => {
    await writeFile(
      path.join(tree, 'wait.mjs'),
      `import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
console.log('CHILD_PID=' + child.pid); setInterval(() => {}, 1000);`,
    )
    const context = workspace()
    const config = preferences(hook('wait.mjs', { timeoutSeconds: 30 }))
    runner.start(context, context.worktrees[0], config)
    await expect.poll(() => result().output).toContain('CHILD_PID=')
    const pid = Number(/CHILD_PID=(\d+)/.exec(result().output)![1])
    expect(() => runner.start(context, context.worktrees[0], config)).toThrow('already running')
    runner.cancel(tree)
    expect((await finished()).status).toBe('cancelled')
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0)
            return true
          } catch {
            return false
          }
        },
        { timeout: 10_000 },
      )
      .toBe(false)
  })

  it('enforces deadlines and bounds noisy output', async () => {
    await writeFile(
      path.join(tree, 'noisy.mjs'),
      "console.log('x'.repeat(100000)); console.log('OUTPUT_TAIL'); setInterval(() => {}, 1000)",
    )
    const context = workspace()
    runner.start(
      context,
      context.worktrees[0],
      preferences(hook('noisy.mjs', { timeoutSeconds: 1 })),
    )
    const run = await finished()
    expect(run).toMatchObject({ status: 'failed', error: 'Hook timed out after 1 seconds.' })
    expect(run.output.length).toBeLessThanOrEqual(65_536)
    expect(run.output).toContain('OUTPUT_TAIL')
  })

  it.runIf(process.platform !== 'win32')(
    'rejects TypeScript before execution on an older Node runtime',
    async () => {
      const oldNode = path.join(directory, 'old-node')
      await writeFile(oldNode, '#!/bin/sh\necho v22.17.0\n', { mode: 0o755 })
      const context = workspace()
      runner.start(context, context.worktrees[0], {
        nodePath: oldNode,
        created: [hook('setup.ts', { kind: 'typescript' })],
      })
      expect((await finished()).error).toContain('22.18')
    },
  )
})

it('keeps completed and retried setup state when polling replies arrive out of order', () => {
  const running: HookRun = {
    id: randomUUID(),
    revision: 1,
    worktreePath: tree,
    status: 'running',
    step: 1,
    total: 1,
    name: 'Setup',
    output: '',
    startedAt: 1,
  }
  const complete: HookRun = { ...running, revision: 2, status: 'succeeded', finishedAt: 2 }
  const retried: HookRun = { ...running, id: randomUUID(), startedAt: 3 }
  expect(mergeHookRuns({ [tree]: complete }, { [tree]: running })[tree]).toEqual(complete)
  expect(mergeHookRuns({ [tree]: retried }, { [tree]: complete })[tree]).toEqual(retried)
})

it('fires only after successful Git creation, persists results, and never reruns on refresh or reopen', async () => {
  await git(root, ['init', '-b', 'main'])
  await writeFile(
    path.join(root, 'setup.mjs'),
    "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], process.env.WORKTREE_BRANCH + '\\n')",
  )
  await git(root, ['add', '.'])
  await git(root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'Initial',
  ])
  const settings = new SettingsStore(path.join(directory, 'settings'))
  service = new WorkspaceService(settings, {
    closeAll() {},
    reconcileWorktrees() {},
    hasRunning: () => false,
  } as unknown as TerminalService)
  const opened = await service.open(root)
  const receipt = path.join(directory, 'lifecycle.txt')
  await service.save(opened.workspace.id, {
    ...opened.preferences,
    hooks: preferences(hook('setup.mjs', { args: [receipt] })),
  })
  const created = await service.create('feat/setup', 'main', 'Task')
  const destination = created.preferences.activeWorktree!
  await expect
    .poll(async () => (await service!.hookRuns(opened.workspace.id))[destination].status)
    .toBe('succeeded')
  await service.refresh()
  await service.refresh()
  service.close()
  const reopened = await service.open(destination)
  expect(reopened.workspace.hookRuns?.[destination].status).toBe('succeeded')
  expect(await readFile(receipt, 'utf8')).toBe('feat/setup\n')
  await expect(service.create('feat/setup', 'main', '')).rejects.toThrow()
  expect(await readFile(receipt, 'utf8')).toBe('feat/setup\n')
  await access(destination)
  const previous = reopened.workspace.hookRuns![destination]
  service.close()
  await settings.saveHookRuns(opened.workspace.id, {
    [destination]: { ...previous, status: 'running' },
  })
  expect((await service.open(root)).workspace.hookRuns?.[destination].status).toBe('cancelled')
  expect(await readFile(receipt, 'utf8')).toBe('feat/setup\n')
  await service.retryHooks(opened.workspace.id, destination)
  await expect
    .poll(async () => (await service!.hookRuns(opened.workspace.id))[destination].status)
    .toBe('succeeded')
  expect(await readFile(receipt, 'utf8')).toBe('feat/setup\nfeat/setup\n')
  expect(defaultPreferences().hooks.created).toEqual([])
})
