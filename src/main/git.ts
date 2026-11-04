import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, appendFile, mkdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { ChangedFile, Commit, DiffRequest, Workspace, Worktree } from '../shared/types'

const execFileAsync = promisify(execFile)

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['--no-optional-locks', '-c', 'core.quotepath=false', '-C', cwd, ...args],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
    )
    return stdout
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string }
    if (failure.code === 'ENOENT')
      throw new Error('Git wurde nicht gefunden. Bitte Git installieren.')
    throw new Error(failure.stderr?.trim() || failure.message)
  }
}

export function parseWorktrees(output: string): Worktree[] {
  return output
    .split('\0\0')
    .filter(Boolean)
    .map((record, index) => {
      const fields = record.split('\0')
      const value = (key: string) =>
        fields.find((line) => line.startsWith(`${key} `))?.slice(key.length + 1)
      return {
        path: value('worktree') ?? '',
        head: value('HEAD') ?? '',
        branch: value('branch')?.replace(/^refs\/heads\//, '') ?? null,
        isMain: index === 0,
        locked: fields.some((line) => line === 'locked' || line.startsWith('locked ')),
        prunable: fields.some((line) => line === 'prunable' || line.startsWith('prunable ')),
        missing: false,
        changedFiles: 0,
      }
    })
    .filter((worktree) => worktree.path)
}

export function parseStatus(output: string): ChangedFile[] {
  const entries = output.split('\0')
  const result: ChangedFile[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    const file: ChangedFile = { index: entry[0], working: entry[1], path: entry.slice(3) }
    if (/[RC]/.test(file.index + file.working)) file.originalPath = entries[++i]
    result.push(file)
  }
  return result
}

export async function changes(cwd: string): Promise<ChangedFile[]> {
  return parseStatus(await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))
}

export async function inspectWorkspace(directory: string): Promise<Workspace> {
  const selectedPath = await realpath(directory)
  if ((await git(selectedPath, ['rev-parse', '--is-bare-repository'])).trim() === 'true') {
    throw new Error('Bitte ein ausgechecktes Repository öffnen, kein Bare-Repository.')
  }
  const commonDir = await realpath(
    (await git(selectedPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim(),
  )
  const worktrees = parseWorktrees(
    await git(selectedPath, ['worktree', 'list', '--porcelain', '-z']),
  )
  if (!worktrees.length) throw new Error('Das Repository enthält keine Worktrees.')

  // Bound parallel Git processes when a repository has many worktrees.
  for (let i = 0; i < worktrees.length; i += 4) {
    await Promise.all(
      worktrees.slice(i, i + 4).map(async (worktree) => {
        try {
          await access(worktree.path)
        } catch {
          worktree.missing = true
          return
        }
        try {
          worktree.changedFiles = (await changes(worktree.path)).length
        } catch (error) {
          worktree.statusError = (error as Error).message
        }
      }),
    )
  }

  const branches = (
    await git(selectedPath, [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
      'refs/remotes',
    ])
  )
    .trim()
    .split('\n')
    .filter((branch) => branch && !branch.endsWith('/HEAD'))
  const rootPath = worktrees[0].path
  return {
    name: path.basename(rootPath),
    rootPath,
    commonDir,
    worktrees,
    branches,
    defaultBase:
      ['main', 'master'].find((branch) => branches.includes(branch)) ?? branches[0] ?? 'HEAD',
  }
}

export async function addWorktree(
  workspace: Workspace,
  branch: string,
  base: string,
): Promise<string> {
  if (branch.startsWith('-') || branch !== branch.trim()) throw new Error('Ungültiger Branch-Name.')
  await git(workspace.rootPath, ['check-ref-format', '--branch', branch])
  const commit = (
    await git(workspace.rootPath, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`])
  ).trim()
  const slug = branch.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80)
  const suffix = createHash('sha256').update(branch).digest('hex').slice(0, 6)
  const worktreesDir = path.join(workspace.rootPath, '.worktrees')
  await mkdir(worktreesDir, { recursive: true })
  const exclude = path.join(workspace.commonDir, 'info', 'exclude')
  await mkdir(path.dirname(exclude), { recursive: true })
  const ignored = await readFile(exclude, 'utf8').catch(() => '')
  if (!ignored.split(/\r?\n/).includes('/.worktrees/')) {
    await appendFile(exclude, '\n# Agent Workspace\n/.worktrees/\n')
  }
  const destination = path.join(worktreesDir, `${slug}-${suffix}`)
  await git(workspace.rootPath, ['worktree', 'add', '-b', branch, '--', destination, commit])
  return destination
}

export async function removeWorktree(workspace: Workspace, worktree: Worktree): Promise<void> {
  if (worktree.isMain) throw new Error('Der Haupt-Worktree kann nicht entfernt werden.')
  if (worktree.locked) throw new Error('Dieser Worktree ist in Git gesperrt.')
  if (worktree.missing) throw new Error('Der Worktree fehlt. Bitte den Eintrag mit Git bereinigen.')
  if ((await changes(worktree.path)).length) {
    throw new Error('Der Worktree hat lokale Änderungen. Bitte zuerst committen oder sichern.')
  }
  if (!worktree.branch) {
    const refs = await git(worktree.path, [
      'for-each-ref',
      '--contains=HEAD',
      '--format=%(refname)',
    ])
    if (!refs.trim())
      throw new Error('Der Detached-HEAD-Commit ist durch keinen Branch oder Tag gesichert.')
  }
  // Git performs its own dirty check too. Keep the branch and all its commits.
  await git(workspace.rootPath, ['worktree', 'remove', '--', worktree.path])
}

export async function history(cwd: string): Promise<Commit[]> {
  try {
    await git(cwd, ['rev-parse', '--verify', 'HEAD'])
  } catch {
    return []
  }
  const output = await git(cwd, [
    'log',
    '-80',
    '--date=iso-strict',
    '--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D%x00',
  ])
  const fields = output.split('\0')
  const commits: Commit[] = []
  for (let i = 0; i + 5 < fields.length; i += 6) {
    commits.push({
      hash: fields[i].trim(),
      shortHash: fields[i + 1],
      author: fields[i + 2],
      date: fields[i + 3],
      subject: fields[i + 4],
      refs: fields[i + 5],
    })
  }
  return commits
}

export async function diff(cwd: string, request: DiffRequest): Promise<string> {
  const options = ['--no-ext-diff', '--no-textconv', '--no-color', '--find-renames']
  if (request.kind === 'commit') {
    if (!/^[0-9a-f]{40,64}$/i.test(request.hash)) throw new Error('Ungültiger Commit.')
    return git(cwd, ['show', '--format=fuller', ...options, request.hash, '--'])
  }
  if (request.kind === 'branch') {
    const target = (
      await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${request.target}^{commit}`])
    ).trim()
    const base = (await git(cwd, ['merge-base', target, 'HEAD'])).trim()
    return git(cwd, ['diff', ...options, base, 'HEAD', '--'])
  }
  return git(cwd, [
    'diff',
    ...options,
    ...(request.kind === 'staged' ? ['--cached'] : []),
    '--',
    request.path,
  ])
}
