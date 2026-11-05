import {
  defaultWorktreePreferences,
  type OpenWorkspace,
  type Workspace,
  type WorkspacePreferences,
} from '../shared/types'
import { localBackend, type WorkspaceBackend } from './backend'
import { SettingsStore } from './settings'
import { TerminalService } from './terminals'

export class WorkspaceService {
  current: Workspace | null = null
  backend: WorkspaceBackend = localBackend
  private mutations: Promise<unknown> = Promise.resolve()

  constructor(
    readonly settings: SettingsStore,
    readonly terminals: TerminalService,
  ) {}

  serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutations.catch(() => {}).then(operation)
    this.mutations = next
    return next
  }

  requireWorkspace(): Workspace {
    if (!this.current) throw new Error('Please open a workspace first.')
    return this.current
  }

  requireWorktree(worktreePath: string) {
    const worktree = this.requireWorkspace().worktrees.find((item) => item.path === worktreePath)
    if (!worktree) throw new Error('This worktree does not belong to the open workspace.')
    if (worktree.missing) throw new Error('The worktree directory does not exist.')
    return worktree
  }

  async open(directory: string, backend: WorkspaceBackend = localBackend): Promise<OpenWorkspace> {
    const workspace = await backend.inspect(directory)
    const preferences = await this.settings.load(workspace.id)
    if (
      !workspace.worktrees.some((item) => item.path === preferences.activeWorktree && !item.missing)
    ) {
      preferences.activeWorktree = workspace.worktrees.find((item) => !item.missing)?.path ?? null
    }
    if (!preferences.targetBranch) preferences.targetBranch = workspace.defaultBase
    await this.settings.remember(
      workspace.remote
        ? { kind: 'ssh', ...workspace.remote, path: workspace.rootPath }
        : workspace.rootPath,
    )
    this.terminals.closeAll()
    if (this.backend !== backend) this.backend.close()
    this.backend = backend
    this.current = workspace
    return { workspace, preferences }
  }

  async refresh(): Promise<Workspace> {
    const current = this.requireWorkspace()
    const directory = current.worktrees.find((item) => !item.missing)?.path ?? current.rootPath
    const workspace = await this.backend.inspect(directory)
    this.terminals.reconcileWorktrees(
      new Set(workspace.worktrees.filter((item) => !item.missing).map((item) => item.path)),
    )
    this.current = workspace
    return workspace
  }

  async create(branch: string, base: string, task: string): Promise<OpenWorkspace> {
    const workspace = this.requireWorkspace()
    const destination = await this.backend.create(workspace, branch, base)
    const preferences = await this.settings.load(workspace.id)
    preferences.worktrees[destination] = { ...defaultWorktreePreferences(), task }
    preferences.activeWorktree = destination
    await this.settings.save(workspace.id, preferences)
    return { workspace: await this.refresh(), preferences }
  }

  async remove(worktreePath: string): Promise<Workspace> {
    const worktree = this.requireWorktree(worktreePath)
    if (this.terminals.hasRunning(worktreePath)) {
      throw new Error('Please close the running terminals in this worktree first.')
    }
    await this.backend.remove(this.requireWorkspace(), worktree)
    return this.refresh()
  }

  async save(workspaceId: string, preferences: WorkspacePreferences): Promise<void> {
    if (this.requireWorkspace().id !== workspaceId) return
    await this.settings.save(workspaceId, preferences)
  }

  async fetch(workspaceId: string): Promise<string> {
    const workspace = this.requireWorkspace()
    if (workspace.id !== workspaceId) throw new Error('Workspace has changed. Please retry.')
    return this.backend.fetch(this.requireWorktree(workspace.rootPath).path)
  }

  async push(workspaceId: string, worktreePath: string): Promise<string> {
    if (this.requireWorkspace().id !== workspaceId)
      throw new Error('Workspace has changed. Please retry.')
    return this.backend.push(this.requireWorktree(worktreePath).path)
  }

  close(): void {
    this.terminals.closeAll()
    this.backend.close()
  }
}
