import type {
  ChangedFile,
  Commit,
  DiffRequest,
  FileEntry,
  FilePreview,
  Workspace,
  Worktree,
} from '../shared/types'
import { addWorktree, changes, diff, history, inspectWorkspace, removeWorktree } from './git'
import { listFiles, readPreview } from './files'

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
  diff,
  listFiles,
  readFile: readPreview,
  close() {},
}
