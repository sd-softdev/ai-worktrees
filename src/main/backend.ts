import type {
  ChangedFile,
  Commit,
  DiffRequest,
  FileEntry,
  FilePreview,
  ReviewPreferences,
  ReviewResult,
  Workspace,
  Worktree,
  HookPreferences,
  HookRun,
} from '../shared/types'
import {
  addWorktree,
  changes,
  diff,
  fetchRepository,
  history,
  inspectWorkspace,
  pushWorktree,
  removeWorktree,
} from './git'
import { listFiles, readPreview } from './files'
import { ReviewService } from './reviews'
import { HookRunner } from './hooks'

const reviews = new ReviewService()
const hooks = new HookRunner()

export interface TerminalLaunch {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

export interface WorkspaceBackend {
  inspect(directory: string): Promise<Workspace>
  create(workspace: Workspace, branch: string, base: string): Promise<string>
  remove(workspace: Workspace, worktree: Worktree): Promise<void>
  fetch(directory: string): Promise<string>
  push(directory: string): Promise<string>
  changes(directory: string): Promise<ChangedFile[]>
  history(directory: string): Promise<Commit[]>
  review(directory: string, preferences: ReviewPreferences, force?: boolean): Promise<ReviewResult>
  diff(directory: string, request: DiffRequest): Promise<string>
  listFiles(directory: string, relativePath: string): Promise<FileEntry[]>
  readFile(directory: string, relativePath: string): Promise<FilePreview>
  terminal?(directory: string): TerminalLaunch
  startHooks(
    workspace: Workspace,
    worktree: Worktree,
    preferences: HookPreferences,
  ): Promise<HookRun>
  hookRuns(): Promise<HookRun[]>
  cancelHooks(directory: string): Promise<void>
  close(): void
}

export const localBackend: WorkspaceBackend = {
  inspect: inspectWorkspace,
  create: addWorktree,
  remove: removeWorktree,
  fetch: fetchRepository,
  push: pushWorktree,
  changes,
  history,
  review: (directory, preferences, force) => reviews.get(directory, preferences, force),
  diff,
  listFiles,
  readFile: readPreview,
  startHooks: async (workspace, worktree, preferences) =>
    hooks.start(workspace, worktree, preferences),
  hookRuns: async () => hooks.snapshots(),
  cancelHooks: async (directory) => hooks.cancel(directory),
  close: () => hooks.clear(),
}
