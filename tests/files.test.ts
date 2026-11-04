import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { listFiles, readPreview } from '../src/main/files'

let directory: string
let root: string
beforeEach(async () => {
  const base = path.join(os.tmpdir(), 'opencode')
  await mkdir(base, { recursive: true })
  directory = await mkdtemp(path.join(base, 'agent-workspace-files-'))
  root = path.join(directory, 'worktree')
  await mkdir(root)
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it('does not escape a worktree through traversal or symbolic links', async () => {
  const outside = path.join(directory, 'outside')
  await mkdir(outside)
  await writeFile(path.join(outside, 'secret.txt'), 'outside')
  // Directory junctions exercise the same boundary on Windows without requiring
  // Developer Mode or the privilege for creating file symlinks.
  await symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(readPreview(root, '../outside/secret.txt')).rejects.toThrow('außerhalb')
  await expect(readPreview(root, 'link/secret.txt')).rejects.toThrow('außerhalb')
})

it('bounds large previews and detects binary contents', async () => {
  await writeFile(path.join(root, 'large.txt'), 'x'.repeat(600_000))
  await writeFile(path.join(root, 'binary'), Buffer.from([1, 0, 2]))
  const large = await readPreview(root, 'large.txt')
  expect(large.truncated).toBe(true)
  expect(large.text.length).toBe(512 * 1024)
  expect(await readPreview(root, 'binary')).toMatchObject({ binary: true, text: '' })
})

it('lists directories first and omits internal worktree storage', async () => {
  await mkdir(path.join(root, 'src'))
  await mkdir(path.join(root, '.git'))
  await mkdir(path.join(root, '.worktrees'))
  await writeFile(path.join(root, 'README.md'), 'hello')
  expect(await listFiles(root, '')).toEqual([
    { name: 'src', path: 'src', kind: 'directory' },
    { name: 'README.md', path: 'README.md', kind: 'file' },
  ])
})
