// Bundled into one dependency-free CommonJS file and streamed to Node over SSH.
import { createInterface } from 'node:readline'
import { readdir, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  addWorktree,
  changes,
  diff,
  fetchRepository,
  history,
  inspectWorkspace,
  mergeOriginMain,
  pushWorktree,
  removeWorktree,
} from '../main/git'
import { listFiles, readPreview } from '../main/files'
import { ReviewService } from '../main/reviews'
import { hookPreferencesSchema, reviewPreferencesSchema } from '../main/schema'
import { HookRunner } from '../main/hooks'
import type { DiffRequest, Workspace } from '../shared/types'

let workspace: Workspace | null = null
const reviews = new ReviewService()
const hooks = new HookRunner()
const resolveDirectory = (directory: string) =>
  directory === '~' || !directory
    ? os.homedir()
    : directory.startsWith('~/')
      ? path.join(os.homedir(), directory.slice(2))
      : path.resolve(directory)

function requireWorktree(directory: string) {
  const worktree = workspace?.worktrees.find((item) => item.path === directory && !item.missing)
  if (!worktree) throw new Error('Unknown remote worktree.')
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
      if (!workspace) throw new Error('No remote workspace is open.')
      return addWorktree(workspace, args[0] as string, args[1] as string)
    case 'remove': {
      const worktree = requireWorktree(directory)
      return removeWorktree(workspace!, worktree)
    }
    case 'changes':
      return changes(requireWorktree(directory).path)
    case 'hooks:start':
      return hooks.start(
        workspace!,
        requireWorktree(directory),
        hookPreferencesSchema.parse(args[1]),
      )
    case 'hooks:state':
      return hooks.snapshots()
    case 'hooks:cancel':
      return hooks.cancel(requireWorktree(directory).path)
    case 'fetch':
      return fetchRepository(requireWorktree(directory).path, args[1] === true)
    case 'merge':
      return mergeOriginMain(requireWorktree(directory).path)
    case 'push':
      return pushWorktree(requireWorktree(directory).path)
    case 'history':
      return history(requireWorktree(directory).path)
    case 'review':
      return reviews.get(
        requireWorktree(directory).path,
        reviewPreferencesSchema.parse(args[1]),
        args[2] === true,
      )
    case 'diff':
      return diff(requireWorktree(directory).path, args[1] as DiffRequest)
    case 'listFiles':
      return listFiles(requireWorktree(directory).path, args[1] as string)
    case 'readFile':
      return readPreview(requireWorktree(directory).path, args[1] as string)
    default:
      throw new Error('Unknown remote operation.')
  }
}

if (
  !['linux', 'darwin'].includes(process.platform) ||
  Number(process.versions.node.split('.')[0]) < 20
) {
  process.stderr.write(
    'Agent Workspace requires Linux/macOS and Node.js 20 or later on the SSH host.\n',
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
      throw new Error('Invalid request.')
  } catch {
    return
  }
  void dispatch(message.method, message.args).then(
    (result) => send({ id: message.id, result: result ?? null }),
    (error) => send({ id: message.id, error: (error as Error).message }),
  )
})
const shutdown = () => {
  hooks.clear()
  process.exit(0)
}
input.on('close', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGHUP', shutdown)
send({ event: 'ready', protocol: 1, platform: process.platform, home: os.homedir() })
