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
} from '../shared/types'
import { addWorktree, changes, diff, history, inspectWorkspace, removeWorktree } from './git'
import { listFiles, readPreview } from './files'
import { ReviewService } from './reviews'

const reviews = new ReviewService()

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
  changes(directory: string): Promise<ChangedFile[]>
  history(directory: string): Promise<Commit[]>
  review(directory: string, preferences: ReviewPreferences, force?: boolean): Promise<ReviewResult>
  diff(directory: string, request: DiffRequest): Promise<string>
  listFiles(directory: string, relativePath: string): Promise<FileEntry[]>
  readFile(directory: string, relativePath: string): Promise<FilePreview>
  terminal?(directory: string): TerminalLaunch
  close(): void
}

export const localBackend: WorkspaceBackend = {
  inspect: inspectWorkspace,
  create: addWorktree,
  remove: removeWorktree,
  changes,
  history,
  review: (directory, preferences, force) => reviews.get(directory, preferences, force),
  diff,
  listFiles,
  readFile: readPreview,
  close() {},
}
