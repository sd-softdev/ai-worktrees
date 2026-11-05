import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { refreshReview } from '../src/renderer/src/reviews'
import { useApp } from '../src/renderer/src/store'
import {
  defaultPreferences,
  type ReviewResult,
  type Workspace,
  type Worktree,
} from '../src/shared/types'

const tree: Worktree = {
  path: '/repository',
  branch: 'main',
  head: 'abc',
  isMain: true,
  locked: false,
  prunable: false,
  missing: false,
  changedFiles: 0,
}
const workspace: Workspace = {
  id: 'repository',
  name: 'Repository',
  rootPath: tree.path,
  commonDir: '/repository/.git',
  worktrees: [tree],
  branches: ['main', 'topic'],
  defaultBase: 'main',
}
const ready: ReviewResult = { status: 'ready', provider: 'github', remotes: ['origin'] }
const getReview = vi.fn<(...args: unknown[]) => Promise<ReviewResult>>()

beforeEach(() => {
  getReview.mockReset().mockResolvedValue(ready)
  vi.stubGlobal('window', { desktop: { getReview, savePreferences: async () => {} } })
  useApp.setState({
    workspace,
    workspaceSession: useApp.getState().workspaceSession + 1,
    preferences: defaultPreferences(),
    error: null,
    loading: false,
    remoteStatus: null,
  })
})

afterEach(() => vi.unstubAllGlobals())

it('recovers when a branch changes during a request and the user switches back', async () => {
  let complete!: (value: ReviewResult) => void
  getReview.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const pending = refreshReview(tree)
  useApp.setState({ workspace: { ...workspace, worktrees: [{ ...tree, branch: 'topic' }] } })
  complete(ready)
  await pending
  useApp.setState({ workspace })
  await refreshReview(tree)
  expect(getReview).toHaveBeenCalledTimes(2)
  expect(useApp.getState().error).toBeNull()
})

it('contains transport failures and allows retry without disturbing the workspace', async () => {
  getReview.mockRejectedValueOnce(new Error('SSH connection lost'))
  await refreshReview(tree)
  expect(useApp.getState().workspace).toEqual(workspace)
  expect(useApp.getState().error).toBeNull()
  await refreshReview(tree, true)
  expect(getReview).toHaveBeenCalledTimes(2)
  expect(useApp.getState().error).toBeNull()
})

it('keeps requests from a previous workspace out of a newly opened workspace', async () => {
  let complete!: (value: ReviewResult) => void
  getReview.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  const pending = refreshReview(tree)
  useApp.setState({ workspaceSession: useApp.getState().workspaceSession + 1 })
  await refreshReview(tree)
  complete({ status: 'unavailable', reason: 'missing-cli', remotes: [] })
  await pending
  await refreshReview(tree)
  expect(getReview).toHaveBeenCalledTimes(2)
})
