import { create } from 'zustand'
import { leaves, removeLeaf, replaceNode } from '../../shared/layout'
import { orderedWorktrees } from '../../shared/worktree-order'
import { mergeHookRuns } from '../../shared/hooks'
import {
  defaultPreferences,
  defaultWorktreePreferences,
  type OpenWorkspace,
  type TerminalLayout,
  type TerminalLeaf,
  type Workspace,
  type WorkspacePreferences,
  type WorktreePreferences,
  type RemoteStatus,
  type HookRun,
} from '../../shared/types'

type TerminalState = { state: 'starting' | 'running' | 'exited' | 'error'; exitCode?: number }

interface AppState {
  workspace: Workspace | null
  preferences: WorkspacePreferences
  visited: string[]
  terminals: Record<string, TerminalState>
  focusedTerminal: string | null
  loading: boolean
  error: string | null
  revision: number
  workspaceSession: number
  remoteStatus: RemoteStatus | null
  setRemoteStatus(status: RemoteStatus): void
  acceptWorkspace(value: OpenWorkspace): void
  updateWorkspace(value: Workspace): void
  updateHookRuns(workspaceId: string, runs: Record<string, HookRun>): void
  setError(error: unknown): void
  setLoading(loading: boolean): void
  updatePreferences(value: Partial<WorkspacePreferences>): void
  updateWorktree(path: string, value: Partial<WorktreePreferences>): void
  selectWorktree(path: string): void
  moveWorktree(path: string, target: string, placement: 'before' | 'after'): void
  holdWorktree(path: string, onHold: boolean): void
  addTerminal(path: string): void
  splitTerminal(path: string, id: string, direction: 'horizontal' | 'vertical'): void
  closeTerminal(path: string, id: string): Promise<void>
  closeTab(path: string, tabId: string): Promise<void>
  updateLayout(path: string, tabId: string, layout: TerminalLayout): void
  setTerminalState(id: string, state: TerminalState): void
  focusTerminal(id: string): void
}

export function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  )
}

const newLeaf = (): TerminalLeaf => ({ type: 'terminal', id: crypto.randomUUID(), title: 'Shell' })

export const useApp = create<AppState>((set, get) => ({
  workspace: null,
  preferences: defaultPreferences(),
  visited: [],
  terminals: {},
  focusedTerminal: null,
  loading: true,
  error: null,
  revision: 0,
  workspaceSession: 0,
  remoteStatus: null,
  setRemoteStatus: (remoteStatus) => {
    const terminals =
      remoteStatus.state === 'disconnected'
        ? Object.fromEntries(
            Object.keys(get().terminals).map((id) => [
              id,
              { state: 'exited' as const, exitCode: 255 },
            ]),
          )
        : get().terminals
    set({ remoteStatus, terminals })
  },
  acceptWorkspace: ({ workspace, preferences }) => {
    set({
      workspace,
      preferences,
      visited: preferences.activeWorktree ? [preferences.activeWorktree] : [],
      terminals: {},
      focusedTerminal: null,
      error: null,
      loading: false,
      revision: get().revision + 1,
      workspaceSession: get().workspaceSession + 1,
      remoteStatus: workspace.remote ? { state: 'connected', host: workspace.remote.host } : null,
    })
    if (
      preferences.activeWorktree &&
      !preferences.worktrees[preferences.activeWorktree]?.tabs.length &&
      (!workspace.hookRuns?.[preferences.activeWorktree] ||
        workspace.hookRuns[preferences.activeWorktree].status === 'succeeded')
    ) {
      get().addTerminal(preferences.activeWorktree)
    }
  },
  updateWorkspace: (workspace) => {
    if (get().workspace?.id !== workspace.id) return
    const previousRuns = get().workspace?.hookRuns
    const nextRuns = workspace.hookRuns
    const validTerminals = new Set(
      workspace.worktrees
        .filter((worktree) => !worktree.missing)
        .flatMap((worktree) => get().preferences.worktrees[worktree.path]?.tabs ?? [])
        .flatMap((tab) => leaves(tab.layout).map((leaf) => leaf.id)),
    )
    const terminals = Object.fromEntries(
      Object.entries(get().terminals).filter(([id]) => validTerminals.has(id)),
    )
    set({
      workspace: { ...workspace, hookRuns: previousRuns },
      terminals,
      revision: get().revision + 1,
    })
    get().updateHookRuns(workspace.id, nextRuns ?? {})
    const active = get().preferences.activeWorktree
    if (!workspace.worktrees.some((item) => item.path === active && !item.missing)) {
      const next = workspace.worktrees.find((item) => !item.missing)
      if (next) get().selectWorktree(next.path)
    }
  },
  updateHookRuns: (workspaceId, incoming) => {
    const workspace = get().workspace
    if (!workspace || workspace.id !== workspaceId) return
    const runs = mergeHookRuns(workspace.hookRuns, incoming)
    set({ workspace: { ...workspace, hookRuns: runs } })
    for (const [directory, run] of Object.entries(runs)) {
      if (
        run.status === 'succeeded' &&
        workspace.hookRuns?.[directory]?.status === 'running' &&
        workspace.worktrees.some((tree) => tree.path === directory && !tree.missing) &&
        !get().preferences.worktrees[directory]?.tabs.length
      )
        get().addTerminal(directory)
    }
  },
  setError: (error) => set({ error: error === null ? null : errorMessage(error) }),
  setLoading: (loading) => set({ loading }),
  updatePreferences: (value) => set({ preferences: { ...get().preferences, ...value } }),
  updateWorktree: (path, value) => {
    const preferences = get().preferences
    set({
      preferences: {
        ...preferences,
        worktrees: {
          ...preferences.worktrees,
          [path]: { ...(preferences.worktrees[path] ?? defaultWorktreePreferences()), ...value },
        },
      },
    })
  },
  selectWorktree: (path) => {
    const existing = get().preferences.worktrees[path]
    set({
      preferences: { ...get().preferences, activeWorktree: path },
      visited: [...new Set([...get().visited, path])],
      focusedTerminal: null,
    })
    if (!existing) get().addTerminal(path)
  },
  moveWorktree: (path, target, placement) => {
    const { workspace, preferences } = get()
    if (!workspace || path === target) return
    const order = orderedWorktrees(workspace.worktrees, preferences.worktreeOrder).map(
      (item) => item.path,
    )
    if (!order.includes(path) || !order.includes(target)) return
    order.splice(order.indexOf(path), 1)
    order.splice(order.indexOf(target) + (placement === 'after' ? 1 : 0), 0, path)
    const onHold = preferences.worktrees[target]?.onHold ?? false
    get().updatePreferences({
      worktreeOrder: order,
      onHoldCollapsed: onHold ? false : preferences.onHoldCollapsed,
      worktrees: {
        ...preferences.worktrees,
        [path]: { ...defaultWorktreePreferences(), ...preferences.worktrees[path], onHold },
      },
    })
  },
  holdWorktree: (path, onHold) => {
    const { workspace, preferences } = get()
    if (!workspace?.worktrees.some((tree) => tree.path === path && !tree.isMain)) return
    const order = orderedWorktrees(workspace.worktrees, preferences.worktreeOrder)
      .map((tree) => tree.path)
      .filter((item) => item !== path)
    get().updatePreferences({
      worktreeOrder: [...order, path],
      onHoldCollapsed: onHold ? false : preferences.onHoldCollapsed,
      worktrees: {
        ...preferences.worktrees,
        [path]: { ...defaultWorktreePreferences(), ...preferences.worktrees[path], onHold },
      },
    })
  },
  addTerminal: (path) => {
    if (get().workspace?.hookRuns?.[path]?.status === 'running') return
    const preferences = get().preferences.worktrees[path] ?? defaultWorktreePreferences()
    if (preferences.tabs.length >= 24) return
    const terminal = newLeaf()
    const tab = {
      id: crypto.randomUUID(),
      title: `Terminal ${preferences.tabs.length + 1}`,
      layout: terminal,
    }
    get().updateWorktree(path, { tabs: [...preferences.tabs, tab], activeTab: tab.id })
    set({ focusedTerminal: terminal.id })
  },
  splitTerminal: (path, id, direction) => {
    const preferences = get().preferences.worktrees[path]
    if (!preferences) return
    const tab = preferences.tabs.find((item) => leaves(item.layout).some((leaf) => leaf.id === id))
    if (!tab || leaves(tab.layout).length >= 8) return
    const original = leaves(tab.layout).find((leaf) => leaf.id === id)!
    const terminal = newLeaf()
    const layout = replaceNode(tab.layout, id, {
      type: 'split',
      id: crypto.randomUUID(),
      direction,
      ratio: 0.5,
      first: original,
      second: terminal,
    })
    get().updateLayout(path, tab.id, layout)
    set({ focusedTerminal: terminal.id })
  },
  closeTerminal: async (path, id) => {
    await window.desktop.closeTerminal(id)
    const preferences = get().preferences.worktrees[path]
    if (!preferences) return
    const tabs = preferences.tabs.flatMap((tab) => {
      const layout = removeLeaf(tab.layout, id)
      return layout ? [{ ...tab, layout }] : []
    })
    const terminals = { ...get().terminals }
    delete terminals[id]
    set({ terminals })
    get().updateWorktree(path, {
      tabs,
      activeTab: tabs.some((tab) => tab.id === preferences.activeTab)
        ? preferences.activeTab
        : (tabs.at(-1)?.id ?? null),
    })
  },
  closeTab: async (path, tabId) => {
    const preferences = get().preferences.worktrees[path]
    const tab = preferences?.tabs.find((item) => item.id === tabId)
    if (!tab) return
    await Promise.all(leaves(tab.layout).map((leaf) => window.desktop.closeTerminal(leaf.id)))
    const latest = get().preferences.worktrees[path]
    const tabs = latest.tabs.filter((item) => item.id !== tabId)
    const terminals = { ...get().terminals }
    for (const leaf of leaves(tab.layout)) delete terminals[leaf.id]
    set({ terminals })
    get().updateWorktree(path, {
      tabs,
      activeTab: latest.activeTab === tabId ? (tabs.at(-1)?.id ?? null) : latest.activeTab,
    })
  },
  updateLayout: (path, tabId, layout) => {
    const preferences = get().preferences.worktrees[path]
    if (!preferences) return
    get().updateWorktree(path, {
      tabs: preferences.tabs.map((tab) => (tab.id === tabId ? { ...tab, layout } : tab)),
    })
  },
  setTerminalState: (id, state) => set({ terminals: { ...get().terminals, [id]: state } }),
  focusTerminal: (id) => set({ focusedTerminal: id }),
}))

// Serialize writes in the backend; save each meaningful UI transition immediately.
// This also makes window close and workspace switch independent of debounce timers.
useApp.subscribe((state, previous) => {
  if (!state.workspace || state.preferences === previous.preferences) return
  void window.desktop.savePreferences(state.workspace.id, state.preferences).catch(state.setError)
})

export async function openWorkspace(): Promise<void> {
  const app = useApp.getState()
  if (app.loading) return
  app.setLoading(true)
  try {
    const result = await window.desktop.openWorkspace()
    if (result) app.acceptWorkspace(result)
  } catch (error) {
    app.setError(error)
  } finally {
    app.setLoading(false)
  }
}

let refreshing = false
export async function refreshWorkspace(): Promise<void> {
  const app = useApp.getState()
  if (!app.workspace || app.loading || refreshing || app.remoteStatus?.state === 'disconnected')
    return
  refreshing = true
  try {
    app.updateWorkspace(await window.desktop.refreshWorkspace())
  } catch (error) {
    app.setError(error)
  } finally {
    refreshing = false
  }
}
