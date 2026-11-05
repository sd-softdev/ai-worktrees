import { open, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { FileEntry, FilePreview } from '../shared/types'

const PREVIEW_LIMIT = 512 * 1024

export async function resolveInside(root: string, relativePath: string): Promise<string> {
  const canonicalRoot = await realpath(root)
  const candidate = await realpath(path.resolve(canonicalRoot, relativePath || '.'))
  const relative = path.relative(canonicalRoot, candidate)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('The path is outside this worktree.')
  }
  return candidate
}

export async function listFiles(root: string, relativePath: string): Promise<FileEntry[]> {
  const directory = await resolveInside(root, relativePath)
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter((entry) => entry.name !== '.git' && entry.name !== '.worktrees')
    .map((entry): FileEntry => ({
      name: entry.name,
      path: path.posix.join(relativePath.replaceAll('\\', '/'), entry.name),
      kind: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file',
    }))
    .sort((a, b) => {
      if (a.kind === 'directory' && b.kind !== 'directory') return -1
      if (b.kind === 'directory' && a.kind !== 'directory') return 1
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
}

export async function readPreview(root: string, relativePath: string): Promise<FilePreview> {
  const filename = await resolveInside(root, relativePath)
  const info = await stat(filename)
  if (!info.isFile()) throw new Error('This entry is not a regular file.')
  const file = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(info.size, PREVIEW_LIMIT))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const content = buffer.subarray(0, bytesRead)
    const binary = content.includes(0)
    return {
      text: binary ? '' : content.toString('utf8'),
      binary,
      truncated: info.size > PREVIEW_LIMIT,
    }
  } finally {
    await file.close()
  }
}
