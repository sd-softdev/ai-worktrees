import {
  defaultWorktreePreferences,
  type OpenWorkspace,
  type Workspace,
  type WorkspacePreferences,
  type HookRun,
} from '../shared/types'
import { randomUUID } from 'node:crypto'
import { mergeHookRuns } from '../shared/hooks'
import { localBackend, type WorkspaceBackend } from './backend'
import { SettingsStore } from './settings'
import type { TerminalService } from './terminals'

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
    const history = await this.settings.loadHookRuns(workspace.id)
    workspace.hookRuns = Object.fromEntries(
      Object.entries(history)
        .filter(([directory]) => workspace.worktrees.some((tree) => tree.path === directory))
        .map(([directory, run]) => [
          directory,
          run.status === 'running'
            ? {
                ...run,
                revision: run.revision + 1,
                status: 'cancelled',
                finishedAt: Date.now(),
                error: 'Setup was interrupted. Retry setup to continue.',
              }
            : run,
        ]),
    )
    if (JSON.stringify(history) !== JSON.stringify(workspace.hookRuns))
      await this.settings.saveHookRuns(workspace.id, workspace.hookRuns)
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
    if (this.backend !== backend || this.backend === localBackend) this.backend.close()
    this.backend = backend
    this.current = workspace
    return { workspace, preferences }
  }

  async refresh(): Promise<Workspace> {
    const current = this.requireWorkspace()
    const directory = current.worktrees.find((item) => !item.missing)?.path ?? current.rootPath
    const workspace = await this.backend.inspect(directory)
    workspace.hookRuns = this.current?.hookRuns
    this.terminals.reconcileWorktrees(
      new Set(workspace.worktrees.filter((item) => !item.missing).map((item) => item.path)),
    )
    this.current = workspace
    await this.hookRuns(workspace.id)
    return this.current!
  }

  async create(branch: string, base: string, task: string): Promise<OpenWorkspace> {
    const workspace = this.requireWorkspace()
    const destination = await this.backend.create(workspace, branch, base)
    const preferences = await this.settings.load(workspace.id)
    preferences.worktrees[destination] = { ...defaultWorktreePreferences(), task }
    preferences.activeWorktree = destination
    await this.settings.save(workspace.id, preferences)
    await this.refresh()
    if (preferences.hooks.created.some((hook) => hook.enabled))
      await this.startHooks(destination, preferences)
    return { workspace: this.requireWorkspace(), preferences }
  }

  async remove(worktreePath: string): Promise<Workspace> {
    const worktree = this.requireWorktree(worktreePath)
    if (this.current?.hookRuns?.[worktreePath]?.status === 'running')
      throw new Error('Cancel the running setup before removing this worktree.')
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

  async fetch(workspaceId: string, prune = false): Promise<string> {
    const workspace = this.requireWorkspace()
    if (workspace.id !== workspaceId) throw new Error('Workspace has changed. Please retry.')
    const tree = workspace.worktrees.find((item) => !item.missing)
    if (!tree) throw new Error('No available worktree to fetch from.')
    return this.backend.fetch(tree.path, prune)
  }

  async merge(workspaceId: string, worktreePath: string): Promise<string> {
    if (this.requireWorkspace().id !== workspaceId)
      throw new Error('Workspace has changed. Please retry.')
    const tree = this.requireWorktree(worktreePath)
    if (this.current?.hookRuns?.[worktreePath]?.status === 'running')
      throw new Error('Wait for worktree setup to finish before merging.')
    return this.backend.merge(tree.path)
  }

  async push(workspaceId: string, worktreePath: string): Promise<string> {
    if (this.requireWorkspace().id !== workspaceId)
      throw new Error('Workspace has changed. Please retry.')
    return this.backend.push(this.requireWorktree(worktreePath).path)
  }

  async hookRuns(workspaceId: string): Promise<Record<string, HookRun>> {
    const current = this.requireWorkspace()
    if (current.id !== workspaceId) throw new Error('Workspace has changed. Please retry.')
    const backend = this.backend
    const snapshots = await backend.hookRuns()
    if (this.current?.id !== workspaceId || this.backend !== backend) return {}
    const runs = Object.fromEntries(
      Object.values(
        mergeHookRuns(
          this.current.hookRuns,
          Object.fromEntries(snapshots.map((run) => [run.worktreePath, run])),
        ),
      )
        .filter((run) => this.current!.worktrees.some((tree) => tree.path === run.worktreePath))
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(-200)
        .map((run) => [run.worktreePath, run]),
    )
    if (JSON.stringify(runs) !== JSON.stringify(this.current.hookRuns)) {
      this.current = { ...this.current, hookRuns: runs }
      await this.settings.saveHookRuns(workspaceId, runs)
    }
    return runs
  }

  private async startHooks(directory: string, preferences: WorkspacePreferences): Promise<void> {
    const current = this.requireWorkspace()
    const tree = this.requireWorktree(directory)
    let run: HookRun
    try {
      run = await this.backend.startHooks(current, tree, preferences.hooks)
    } catch (error) {
      run = {
        id: randomUUID(),
        revision: 0,
        worktreePath: directory,
        status: 'failed',
        step: 0,
        total: preferences.hooks.created.filter((hook) => hook.enabled).length,
        name: 'Setup',
        output: '',
        error: String(error).slice(0, 16_384),
        startedAt: Date.now(),
        finishedAt: Date.now(),
      }
    }
    this.current = {
      ...this.requireWorkspace(),
      hookRuns: { ...this.current!.hookRuns, [directory]: run },
    }
    await this.settings.saveHookRuns(current.id, this.current.hookRuns!)
  }

  async retryHooks(workspaceId: string, directory: string): Promise<Record<string, HookRun>> {
    if (this.requireWorkspace().id !== workspaceId)
      throw new Error('Workspace has changed. Please retry.')
    const previous = (await this.hookRuns(workspaceId))[directory]
    if (!previous || previous.status === 'running')
      throw new Error('There is no completed setup to retry.')
    if (this.terminals.hasRunning(directory))
      throw new Error('Close this worktree’s terminals before retrying setup.')
    const preferences = await this.settings.load(workspaceId)
    if (!preferences.hooks.created.some((hook) => hook.enabled))
      throw new Error('Configure an enabled Worktree created hook first.')
    await this.startHooks(directory, preferences)
    return this.current!.hookRuns!
  }

  async cancelHooks(workspaceId: string, directory: string): Promise<void> {
    if (this.requireWorkspace().id !== workspaceId)
      throw new Error('Workspace has changed. Please retry.')
    this.requireWorktree(directory)
    await this.backend.cancelHooks(directory)
  }

  close(): void {
    this.terminals.closeAll()
    this.backend.close()
  }
}
