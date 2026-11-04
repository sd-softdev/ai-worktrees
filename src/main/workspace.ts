import path from 'node:path'
import {
  defaultWorktreePreferences,
  type OpenWorkspace,
  type Workspace,
  type WorkspacePreferences,
} from '../shared/types'
import { addWorktree, inspectWorkspace, removeWorktree } from './git'
import { SettingsStore } from './settings'
import { TerminalService } from './terminals'

export class WorkspaceService {
  current: Workspace | null = null
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
    if (!this.current) throw new Error('Bitte zuerst einen Workspace öffnen.')
    return this.current
  }

  requireWorktree(worktreePath: string) {
    const worktree = this.requireWorkspace().worktrees.find((item) => item.path === worktreePath)
    if (!worktree) throw new Error('Dieser Worktree gehört nicht zum geöffneten Workspace.')
    if (worktree.missing) throw new Error('Das Worktree-Verzeichnis ist nicht vorhanden.')
    return worktree
  }

  async open(directory: string): Promise<OpenWorkspace> {
    const workspace = await inspectWorkspace(directory)
    const preferences = await this.settings.load(workspace.commonDir)
    if (
      !workspace.worktrees.some((item) => item.path === preferences.activeWorktree && !item.missing)
    ) {
      preferences.activeWorktree = workspace.worktrees.find((item) => !item.missing)?.path ?? null
    }
    if (!preferences.targetBranch) preferences.targetBranch = workspace.defaultBase
    this.terminals.closeAll()
    this.current = workspace
    await this.settings.remember(workspace.rootPath)
    return { workspace, preferences }
  }

  async refresh(): Promise<Workspace> {
    const current = this.requireWorkspace()
    const directory = current.worktrees.find((item) => !item.missing)?.path ?? current.rootPath
    const workspace = await inspectWorkspace(directory)
    this.terminals.reconcileWorktrees(
      new Set(workspace.worktrees.filter((item) => !item.missing).map((item) => item.path)),
    )
    this.current = workspace
    return workspace
  }

  async create(branch: string, base: string, task: string): Promise<OpenWorkspace> {
    const workspace = this.requireWorkspace()
    const destination = await addWorktree(workspace, branch, base)
    const preferences = await this.settings.load(workspace.commonDir)
    preferences.worktrees[destination] = { ...defaultWorktreePreferences(), task }
    preferences.activeWorktree = destination
    await this.settings.save(workspace.commonDir, preferences)
    return { workspace: await this.refresh(), preferences }
  }

  async remove(worktreePath: string): Promise<Workspace> {
    const worktree = this.requireWorktree(worktreePath)
    if (this.terminals.hasRunning(worktreePath)) {
      throw new Error('Bitte zuerst die laufenden Terminals dieses Worktrees schließen.')
    }
    await removeWorktree(this.requireWorkspace(), worktree)
    return this.refresh()
  }

  async save(commonDir: string, preferences: WorkspacePreferences): Promise<void> {
    if (this.requireWorkspace().commonDir !== commonDir) return
    await this.settings.save(commonDir, preferences)
  }

  get displayName(): string {
    return this.current ? path.basename(this.current.rootPath) : 'Agent Workspace'
  }
}
