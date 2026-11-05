import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addWorktree,
  changes,
  diff,
  fetchRepository,
  git,
  history,
  inspectWorkspace,
  parseStatus,
  pushWorktree,
  removeWorktree,
} from '../src/main/git'

let directory: string
let repo: string

async function commit(cwd: string, message: string) {
  await git(cwd, ['add', '--all'])
  await git(cwd, [
    '-c',
    'user.name=Workspace Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    message,
  ])
}

async function addRemote(name: string) {
  const remote = path.join(directory, `${name} remote.git`)
  await mkdir(remote)
  await git(remote, ['init', '--bare'])
  await git(repo, ['remote', 'add', name, remote])
  return remote
}

beforeEach(async () => {
  const base = path.join(os.tmpdir(), 'opencode')
  await mkdir(base, { recursive: true })
  directory = await realpath(await mkdtemp(path.join(base, 'agent-workspace-git-')))
  repo = path.join(directory, 'repository with spaces')
  await mkdir(repo)
  await git(repo, ['init', '-b', 'main'])
  await git(repo, ['config', 'core.autocrlf', 'false'])
  await writeFile(path.join(repo, 'README.md'), '# Workspace\n')
  await commit(repo, 'Initial commit')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('Git worktree integration', () => {
  it('fetches every remote without changing local branches or uncommitted files', async () => {
    const origin = await addRemote('origin')
    const upstream = await addRemote('upstream')
    const original = await git(repo, ['rev-parse', 'HEAD'])
    const feature = await addWorktree(await inspectWorkspace(repo), 'feat/remote', 'main')
    await writeFile(path.join(feature, 'remote.txt'), 'remote commit\n')
    await commit(feature, 'Remote change')
    const remoteHead = await git(feature, ['rev-parse', 'HEAD'])
    await git(feature, ['push', 'origin', 'HEAD:refs/heads/incoming'])
    await git(feature, ['push', 'upstream', 'HEAD:refs/heads/another'])
    await git(repo, ['update-ref', '-d', 'refs/remotes/origin/incoming'])
    await git(repo, ['update-ref', '-d', 'refs/remotes/upstream/another'])
    await writeFile(path.join(repo, 'README.md'), 'uncommitted work\n')
    expect(await fetchRepository(repo)).toContain('origin, upstream')
    expect(await git(repo, ['rev-parse', 'origin/incoming'])).toBe(remoteHead)
    expect(await git(repo, ['rev-parse', 'upstream/another'])).toBe(remoteHead)
    expect(await git(repo, ['rev-parse', 'HEAD'])).toBe(original)
    expect(await readFile(path.join(repo, 'README.md'), 'utf8')).toBe('uncommitted work\n')
    expect(await git(origin, ['rev-parse', 'incoming'])).toBe(remoteHead)
    expect(await git(upstream, ['rev-parse', 'another'])).toBe(remoteHead)
  })

  it('publishes only the chosen worktree branch and sets its first upstream', async () => {
    const origin = await addRemote('origin')
    const feature = await addWorktree(await inspectWorkspace(repo), 'feat/publish', 'main')
    await writeFile(path.join(feature, 'feature.txt'), 'published work\n')
    await commit(feature, 'Publish feature')
    await git(repo, ['config', 'push.default', 'matching'])
    await git(repo, ['config', 'remote.origin.push', 'refs/heads/main:refs/heads/unwanted'])
    await git(repo, ['tag', 'feat/publish'])
    await writeFile(path.join(feature, 'uncommitted.txt'), 'stay local')
    expect(await pushWorktree(feature)).toBe('Pushed feat/publish to origin/feat/publish.')
    expect((await git(origin, ['for-each-ref', '--format=%(refname)'])).trim()).toBe(
      'refs/heads/feat/publish',
    )
    expect(await git(origin, ['show', 'feat/publish:feature.txt'])).toBe('published work\n')
    expect((await git(feature, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim()).toBe(
      'origin/feat/publish',
    )
    expect(await readFile(path.join(feature, 'uncommitted.txt'), 'utf8')).toBe('stay local')
    await expect(pushWorktree(feature)).resolves.toContain('Pushed feat/publish')
  })

  it('honors a differently named upstream and rejects non-fast-forward pushes', async () => {
    const origin = await addRemote('origin')
    const feature = await addWorktree(await inspectWorkspace(repo), 'feat/tracked', 'main')
    await git(feature, ['push', '-u', 'origin', 'HEAD:refs/heads/review'])
    await writeFile(path.join(feature, 'feature.txt'), 'first change')
    await commit(feature, 'First feature change')
    await pushWorktree(feature)
    const published = (await git(origin, ['rev-parse', 'review'])).trim()
    expect(published).toBe((await git(feature, ['rev-parse', 'HEAD'])).trim())
    await git(feature, ['reset', '--hard', 'HEAD~1'])
    await writeFile(path.join(feature, 'different.txt'), 'divergent change')
    await commit(feature, 'Divergent feature change')
    await expect(pushWorktree(feature)).rejects.toThrow(/rejected|failed to push/)
    expect((await git(origin, ['rev-parse', 'review'])).trim()).toBe(published)
  })

  it('respects push-remote overrides while preserving upstream tracking in fork workflows', async () => {
    const upstream = await addRemote('upstream')
    const fork = await addRemote('fork')
    const preferred = await addRemote('preferred')
    const feature = await addWorktree(await inspectWorkspace(repo), 'feat/fork', 'main')
    await git(feature, ['push', '-u', 'upstream', 'HEAD:refs/heads/review'])
    const original = await git(upstream, ['rev-parse', 'review'])
    await writeFile(path.join(feature, 'feature.txt'), 'fork change')
    await commit(feature, 'Fork change')
    await git(feature, ['config', 'remote.pushDefault', 'preferred'])
    await git(feature, ['config', 'branch.feat/fork.pushRemote', 'fork'])
    expect(await pushWorktree(feature)).toContain('fork/feat/fork')
    expect(await git(fork, ['rev-parse', 'feat/fork'])).toBe(
      await git(feature, ['rev-parse', 'HEAD']),
    )
    expect((await git(feature, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim()).toBe(
      'upstream/review',
    )
    expect(await git(upstream, ['rev-parse', 'review'])).toBe(original)
    expect(await git(preferred, ['for-each-ref'])).toBe('')
    await git(feature, ['config', '--unset', 'branch.feat/fork.pushRemote'])
    expect(await pushWorktree(feature)).toContain('preferred/feat/fork')
  })

  it('reports missing and ambiguous remotes and rejects detached pushes', async () => {
    await expect(fetchRepository(repo)).rejects.toThrow('No Git remote')
    await expect(pushWorktree(repo)).rejects.toThrow('No Git remote')
    await addRemote('one')
    await addRemote('two')
    await expect(pushWorktree(repo)).rejects.toThrow('Multiple Git remotes')
    await git(repo, ['checkout', '--detach'])
    await expect(pushWorktree(repo)).rejects.toThrow('detached HEAD')
  })

  it('discovers external worktrees when opening a linked worktree', async () => {
    const external = path.join(directory, 'external worktree')
    await git(repo, ['worktree', 'add', '-b', 'feat/external', external])
    await git(repo, ['worktree', 'lock', '--reason', 'Keep this checkout', external])
    const workspace = await inspectWorkspace(external)
    expect(workspace.rootPath).toBe(repo)
    expect(workspace.worktrees).toHaveLength(2)
    expect(workspace.worktrees[0].isMain).toBe(true)
    expect(workspace.worktrees[1]).toMatchObject({
      path: external,
      branch: 'feat/external',
      locked: true,
    })
    expect(workspace.defaultBase).toBe('main')
  })

  it('creates an isolated branch and ignores the conventional directory locally', async () => {
    const workspace = await inspectWorkspace(repo)
    const created = await addWorktree(workspace, 'feat/auth-ui', 'main')
    expect(created.startsWith(path.join(repo, '.worktrees') + path.sep)).toBe(true)
    expect((await git(created, ['branch', '--show-current'])).trim()).toBe('feat/auth-ui')
    expect(await changes(repo)).toEqual([])
    await writeFile(path.join(created, 'feature.txt'), 'isolated change')
    expect(await changes(repo)).toEqual([])
    expect(await changes(created)).toEqual([{ path: 'feature.txt', index: '?', working: '?' }])
    expect(await readFile(path.join(workspace.commonDir, 'info/exclude'), 'utf8')).toContain(
      '/.worktrees/',
    )
  })

  it('preserves unusual paths and staged rename records', async () => {
    const oldName = 'original with spaces.txt'
    const newName = process.platform === 'win32' ? 'new üñicode.txt' : 'new\nüñicode.txt'
    await writeFile(path.join(repo, oldName), 'unchanged file contents\n')
    await commit(repo, 'Add file')
    await rename(path.join(repo, oldName), path.join(repo, newName))
    await git(repo, ['add', '--all'])
    await writeFile(path.join(repo, '-option.txt'), 'untracked')
    const status = await changes(repo)
    expect(status).toContainEqual({
      path: newName,
      originalPath: oldName,
      index: 'R',
      working: ' ',
    })
    expect(status).toContainEqual({ path: '-option.txt', index: '?', working: '?' })
  })

  it('parses newline-containing rename records independently of host filesystem rules', () => {
    expect(parseStatus('R  new\nname.txt\0old name.txt\0?? next.txt\0')).toEqual([
      { path: 'new\nname.txt', originalPath: 'old name.txt', index: 'R', working: ' ' },
      { path: 'next.txt', index: '?', working: '?' },
    ])
  })

  it('compares against merge-base without including later target-branch commits', async () => {
    const created = await addWorktree(await inspectWorkspace(repo), 'feat/diff', 'main')
    await writeFile(path.join(created, 'feature.txt'), 'feature-only\n')
    await commit(created, 'Feature implementation')
    await writeFile(path.join(repo, 'unrelated.txt'), 'main-only\n')
    await commit(repo, 'Independent main commit')
    const output = await diff(created, { kind: 'branch', target: 'main' })
    expect(output).toContain('+feature-only')
    expect(output).not.toContain('main-only')
    const commits = await history(created)
    expect(commits[0].subject).toBe('Feature implementation')
    expect(commits[1].subject).toBe('Initial commit')
    expect(await diff(created, { kind: 'commit', hash: commits[0].hash })).toContain(
      '+feature-only',
    )
  })

  it('refuses dirty removal and keeps the branch after a clean removal', async () => {
    const created = await addWorktree(await inspectWorkspace(repo), 'feat/remove', 'main')
    const workspace = await inspectWorkspace(repo)
    const worktree = workspace.worktrees.find((item) => item.path === created)!
    await writeFile(path.join(created, 'important.txt'), 'keep me')
    await expect(removeWorktree(workspace, worktree)).rejects.toThrow('local changes')
    await commit(created, 'Preserve work')
    await removeWorktree(workspace, worktree)
    expect((await inspectWorkspace(repo)).worktrees).toHaveLength(1)
    expect(await git(repo, ['show', 'feat/remove:important.txt'])).toBe('keep me')
  })

  it('rejects a checked-out branch and malformed branch names', async () => {
    const workspace = await inspectWorkspace(repo)
    await expect(addWorktree(workspace, 'main', 'main')).rejects.toThrow()
    await expect(addWorktree(workspace, '--force', 'main')).rejects.toThrow('Invalid')
    await expect(addWorktree(workspace, '../bad', 'main')).rejects.toThrow()
    expect((await inspectWorkspace(repo)).worktrees).toHaveLength(1)
  })

  it('supports an unborn repository for browsing but reports worktree creation failure', async () => {
    const empty = path.join(directory, 'empty')
    await mkdir(empty)
    await git(empty, ['init', '-b', 'main'])
    const workspace = await inspectWorkspace(empty)
    expect(workspace.worktrees[0].branch).toBe('main')
    expect(await history(empty)).toEqual([])
    await expect(addWorktree(workspace, 'feat/first', 'HEAD')).rejects.toThrow()
  })
})
