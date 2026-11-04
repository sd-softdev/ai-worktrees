// Bundled into one dependency-free CommonJS file and streamed to Node over SSH.
import { createInterface } from 'node:readline'
import { readdir, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { addWorktree, changes, diff, history, inspectWorkspace, removeWorktree } from '../main/git'
import { listFiles, readPreview } from '../main/files'
import type { DiffRequest, Workspace } from '../shared/types'

let workspace: Workspace | null = null
const resolveDirectory = (directory: string) =>
  directory === '~' || !directory
    ? os.homedir()
    : directory.startsWith('~/')
      ? path.join(os.homedir(), directory.slice(2))
      : path.resolve(directory)

function requireWorktree(directory: string) {
  const worktree = workspace?.worktrees.find((item) => item.path === directory && !item.missing)
  if (!worktree) throw new Error('Unbekannter Remote-Worktree.')
  return worktree
}

async function dispatch(method: string, args: unknown[]): Promise<unknown> {
  const directory = args[0] as string
  switch (method) {
    case 'browse': {
      const current = await realpath(resolveDirectory(directory))
      const entries = await readdir(current, { withFileTypes: true })
      return {
        path: current,
        parent: path.dirname(current),
        home: os.homedir(),
        directories: entries
          .filter((entry) => entry.isDirectory() && entry.name !== '.git')
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b)),
      }
    }
    case 'inspect':
      workspace = await inspectWorkspace(resolveDirectory(directory))
      return workspace
    case 'create':
      if (!workspace) throw new Error('Kein Remote-Workspace geöffnet.')
      return addWorktree(workspace, args[0] as string, args[1] as string)
    case 'remove': {
      const worktree = requireWorktree(directory)
      return removeWorktree(workspace!, worktree)
    }
    case 'changes':
      return changes(requireWorktree(directory).path)
    case 'history':
      return history(requireWorktree(directory).path)
    case 'diff':
      return diff(requireWorktree(directory).path, args[1] as DiffRequest)
    case 'listFiles':
      return listFiles(requireWorktree(directory).path, args[1] as string)
    case 'readFile':
      return readPreview(requireWorktree(directory).path, args[1] as string)
    default:
      throw new Error('Unbekannte Remote-Operation.')
  }
}

if (
  !['linux', 'darwin'].includes(process.platform) ||
  Number(process.versions.node.split('.')[0]) < 20
) {
  process.stderr.write(
    'Agent Workspace benötigt auf dem SSH-Host Linux/macOS und Node.js 20 oder neuer.\n',
  )
  process.exit(1)
}

const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  let message: { id: string; method: string; args: unknown[] }
  try {
    message = JSON.parse(line)
    if (
      typeof message.id !== 'string' ||
      typeof message.method !== 'string' ||
      !Array.isArray(message.args)
    )
      throw new Error('Ungültige Anfrage.')
  } catch {
    return
  }
  void dispatch(message.method, message.args).then(
    (result) => send({ id: message.id, result: result ?? null }),
    (error) => send({ id: message.id, error: (error as Error).message }),
  )
})
input.on('close', () => process.exit(0))
send({ event: 'ready', protocol: 1, platform: process.platform, home: os.homedir() })
