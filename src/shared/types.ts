export type TaskStatus = 'todo' | 'working' | 'review' | 'done'
export type InspectorTab = 'changes' | 'history' | 'files' | 'reviews'

export type ReviewProvider = 'github' | 'gitlab'

export interface ReviewPreferences {
  provider: 'auto' | 'off' | ReviewProvider
  remote: string
}

export interface ReviewRequest {
  number: number
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  sourceBranch: string
  targetBranch: string
  review: 'approved' | 'changes-requested' | 'required' | 'unknown'
  checks: 'passed' | 'failed' | 'pending' | 'none' | 'unknown'
}

export interface ReviewResult {
  status: 'ready' | 'disabled' | 'unsupported' | 'unavailable'
  reason?: 'missing-cli' | 'authentication' | 'request-failed'
  provider?: ReviewProvider
  host?: string
  repository?: string
  remote?: string
  remotes: string[]
  request?: ReviewRequest
  message?: string
  checkedAt?: string
}

export interface UpdateState {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'up-to-date'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error'
    | 'unsupported'
  currentVersion: string
  installation: 'restart' | 'mac'
  installationPath?: string
  version?: string
  progress?: number
  transferred?: number
  total?: number
  checkedAt?: string
  error?: string
}

export interface Worktree {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  locked: boolean
  prunable: boolean
  missing: boolean
  changedFiles: number
  statusError?: string
}

export interface Workspace {
  id: string
  name: string
  rootPath: string
  commonDir: string
  worktrees: Worktree[]
  branches: string[]
  defaultBase: string
  remote?: SshTarget
  hookRuns?: Record<string, HookRun>
}

export interface WorktreeHook {
  id: string
  name: string
  enabled: boolean
  kind: 'shell' | 'javascript' | 'typescript'
  command: string
  args: string[]
  timeoutSeconds: number
}

export interface HookPreferences {
  nodePath: string
  created: WorktreeHook[]
}

export interface HookRun {
  id: string
  revision: number
  worktreePath: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  step: number
  total: number
  name: string
  output: string
  error?: string
  startedAt: number
  finishedAt?: number
}

export interface SshTarget {
  host: string
  nodePath: string
}

export interface SshConnectInput extends SshTarget {
  id: string
}

export interface RemoteWorkspaceReference extends SshTarget {
  kind: 'ssh'
  path: string
}

export interface SshHost {
  alias: string
}

export interface RemoteDirectory {
  path: string
  parent: string
  home: string
  directories: string[]
}

export interface SshPrompt {
  id: string
  host: string
  prompt: string
  confirmation: boolean
}

export interface RemoteStatus {
  state: 'connected' | 'disconnected'
  host: string
  message?: string
}

export interface TerminalLeaf {
  type: 'terminal'
  id: string
  title: string
}

export interface TerminalSplit {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  ratio: number
  first: TerminalLayout
  second: TerminalLayout
}

export type TerminalLayout = TerminalLeaf | TerminalSplit

export interface TerminalTab {
  id: string
  title: string
  layout: TerminalLayout
}

export interface WorktreePreferences {
  task: string
  status: TaskStatus
  onHold: boolean
  tabs: TerminalTab[]
  activeTab: string | null
}

export interface WorkspacePreferences {
  activeWorktree: string | null
  targetBranch: string
  leftWidth: number
  rightWidth: number
  inspectorTab: InspectorTab
  reviews: ReviewPreferences
  hooks: HookPreferences
  worktreeOrder: string[]
  baseCollapsed: boolean
  onHoldCollapsed: boolean
  worktrees: Record<string, WorktreePreferences>
}

export interface OpenWorkspace {
  workspace: Workspace
  preferences: WorkspacePreferences
}

export interface ChangedFile {
  path: string
  originalPath?: string
  index: string
  working: string
}

export interface Commit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
  refs: string
}

export interface FileEntry {
  name: string
  path: string
  kind: 'directory' | 'file' | 'symlink'
}

export interface FilePreview {
  text: string
  truncated: boolean
  binary: boolean
}

export interface TerminalEvent {
  id: string
  type: 'data' | 'exit'
  data?: string
  exitCode?: number
}

export interface TerminalSnapshot {
  output: string
  sequence: number
  exited: boolean
  exitCode?: number
}

export interface SequencedTerminalEvent extends TerminalEvent {
  sequence: number
}

export interface CreateWorktreeInput {
  branch: string
  base: string
  task: string
}

export type DiffRequest =
  | { kind: 'working' | 'staged'; path: string }
  | { kind: 'branch'; target: string }
  | { kind: 'commit'; hash: string }

export interface DesktopAPI {
  platform: string
  updateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  cancelUpdate(): Promise<void>
  installUpdate(): Promise<UpdateState>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  onUpdateRequested(listener: () => void): () => void
  bootstrap(): Promise<OpenWorkspace | null>
  openWorkspace(): Promise<OpenWorkspace | null>
  sshHosts(): Promise<SshHost[]>
  connectSsh(input: SshConnectInput): Promise<RemoteDirectory>
  browseSsh(id: string, directory: string): Promise<RemoteDirectory>
  openSshWorkspace(id: string, directory: string): Promise<OpenWorkspace | null>
  cancelSsh(id: string): Promise<void>
  reconnectWorkspace(): Promise<OpenWorkspace>
  answerSshPrompt(id: string, answer: string | null): void
  onSshPrompt(listener: (prompt: SshPrompt) => void): () => void
  onSshPromptClosed(listener: (id: string) => void): () => void
  onRemoteStatus(listener: (status: RemoteStatus) => void): () => void
  refreshWorkspace(): Promise<Workspace>
  createWorktree(input: CreateWorktreeInput): Promise<OpenWorkspace>
  getHookRuns(workspaceId: string): Promise<Record<string, HookRun>>
  retryHooks(workspaceId: string, path: string): Promise<Record<string, HookRun>>
  cancelHooks(workspaceId: string, path: string): Promise<void>
  removeWorktree(path: string): Promise<Workspace>
  fetchRepository(workspaceId: string): Promise<string>
  pushWorktree(workspaceId: string, path: string): Promise<string>
  savePreferences(commonDir: string, preferences: WorkspacePreferences): Promise<void>
  getChanges(path: string): Promise<ChangedFile[]>
  getHistory(path: string): Promise<Commit[]>
  getReview(path: string, preferences: ReviewPreferences, force?: boolean): Promise<ReviewResult>
  getDiff(path: string, request: DiffRequest): Promise<string>
  listFiles(worktree: string, relativePath: string): Promise<FileEntry[]>
  readFile(worktree: string, relativePath: string): Promise<FilePreview>
  openTerminal(id: string, worktree: string, cols: number, rows: number): Promise<TerminalSnapshot>
  writeTerminal(id: string, data: string): void
  resizeTerminal(id: string, cols: number, rows: number): void
  acknowledgeTerminal(id: string, sequence: number): void
  closeTerminal(id: string): Promise<void>
  onTerminalEvent(listener: (event: SequencedTerminalEvent) => void): () => void
  onWorkspaceChanged(listener: () => void): () => void
  onOpenRequested(listener: () => void): () => void
  openExternal(url: string): Promise<void>
}

export function defaultPreferences(): WorkspacePreferences {
  return {
    activeWorktree: null,
    targetBranch: '',
    leftWidth: 260,
    rightWidth: 340,
    inspectorTab: 'changes',
    reviews: { provider: 'auto', remote: '' },
    hooks: { nodePath: 'node', created: [] },
    worktreeOrder: [],
    baseCollapsed: false,
    onHoldCollapsed: true,
    worktrees: {},
  }
}

export function defaultWorktreePreferences(): WorktreePreferences {
  return { task: '', status: 'todo', onHold: false, tabs: [], activeTab: null }
}
