import type {
  ChangedFile,
  Commit,
  DiffRequest,
  FileEntry,
  FilePreview,
  RemoteDirectory,
  ReviewPreferences,
  ReviewResult,
  Workspace,
  Worktree,
  HookPreferences,
  HookRun,
} from '../../shared/types'
import type { WorkspaceBackend } from '../backend'
import { SshConnection } from './connection'

export class SshBackend implements WorkspaceBackend {
  constructor(readonly connection: SshConnection) {}

  async inspect(directory: string): Promise<Workspace> {
    const workspace = await this.connection.call<Workspace>('inspect', directory)
    const { host, nodePath } = this.connection.target
    return {
      ...workspace,
      id: JSON.stringify(['ssh', host, workspace.commonDir]),
      remote: { host, nodePath },
    }
  }

  browse(directory: string): Promise<RemoteDirectory> {
    return this.connection.call('browse', directory)
  }
  create(_workspace: Workspace, branch: string, base: string): Promise<string> {
    return this.connection.call('create', branch, base)
  }
  remove(_workspace: Workspace, worktree: Worktree): Promise<void> {
    return this.connection.call('remove', worktree.path)
  }
  fetch(directory: string): Promise<string> {
    return this.connection.call('fetch', directory)
  }
  push(directory: string): Promise<string> {
    return this.connection.call('push', directory)
  }
  changes(directory: string): Promise<ChangedFile[]> {
    return this.connection.call('changes', directory)
  }
  history(directory: string): Promise<Commit[]> {
    return this.connection.call('history', directory)
  }
  review(directory: string, preferences: ReviewPreferences, force = false): Promise<ReviewResult> {
    return this.connection.call('review', directory, preferences, force)
  }
  diff(directory: string, request: DiffRequest): Promise<string> {
    return this.connection.call('diff', directory, request)
  }
  listFiles(directory: string, relative: string): Promise<FileEntry[]> {
    return this.connection.call('listFiles', directory, relative)
  }
  readFile(directory: string, relative: string): Promise<FilePreview> {
    return this.connection.call('readFile', directory, relative)
  }
  terminal(directory: string) {
    return this.connection.terminal(directory)
  }
  startHooks(
    _workspace: Workspace,
    worktree: Worktree,
    preferences: HookPreferences,
  ): Promise<HookRun> {
    return this.connection.call('hooks:start', worktree.path, preferences)
  }
  hookRuns(): Promise<HookRun[]> {
    return this.connection.call('hooks:state')
  }
  cancelHooks(directory: string): Promise<void> {
    return this.connection.call('hooks:cancel', directory)
  }
  close() {
    this.connection.dispose()
  }
}
