import { useEffect } from 'react'
import { create } from 'zustand'
import type { ReviewResult, Worktree } from '../../shared/types'
import { useApp } from './store'

interface ReviewEntry {
  result?: ReviewResult
  loading: boolean
  fetchedAt?: number
}

const useReviewState = create<{ entries: Record<string, ReviewEntry> }>(() => ({ entries: {} }))

function keyFor(worktree: Worktree): string {
  const { workspaceSession, preferences } = useApp.getState()
  return JSON.stringify([workspaceSession, worktree.path, worktree.branch, preferences.reviews])
}

export function useWorktreeReview(worktree: Worktree): ReviewEntry | undefined {
  const session = useApp((state) => state.workspaceSession)
  const preferences = useApp((state) => state.preferences.reviews)
  const key = JSON.stringify([session, worktree.path, worktree.branch, preferences])
  return useReviewState((state) => state.entries[key])
}

export async function refreshReview(worktree: Worktree, force = false): Promise<void> {
  const app = useApp.getState()
  if (!app.workspace || worktree.missing || app.remoteStatus?.state === 'disconnected') return
  const key = keyFor(worktree)
  const previous = useReviewState.getState().entries[key]
  if (
    previous?.loading ||
    (!force && previous?.fetchedAt && Date.now() - previous.fetchedAt < 60_000)
  )
    return
  const pending: ReviewEntry = { ...previous, loading: true }
  useReviewState.setState((state) => ({ entries: { ...state.entries, [key]: pending } }))
  let result: ReviewResult
  try {
    result = await window.desktop.getReview(worktree.path, app.preferences.reviews, force)
  } catch {
    // Transport failures belong to this optional panel, not the workspace's
    // global error banner. Keep a clearly marked last-known result if available.
    result = {
      ...previous?.result,
      status: 'unavailable',
      reason: 'request-failed',
      remotes: previous?.result?.remotes ?? [],
      message: 'PR/MR status is temporarily unavailable. Refresh to retry.',
    }
  }
  if (useReviewState.getState().entries[key] !== pending) return
  const current = useApp.getState().workspace?.worktrees.find((item) => item.path === worktree.path)
  if (!current || keyFor(current) !== key) {
    useReviewState.setState((state) => {
      const entries = { ...state.entries }
      delete entries[key]
      return { entries }
    })
    return
  }
  useReviewState.setState((state) => ({
    entries: { ...state.entries, [key]: { result, loading: false, fetchedAt: Date.now() } },
  }))
}

export function useReviewPolling(): void {
  const session = useApp((state) => state.workspaceSession)
  const provider = useApp((state) => state.preferences.reviews.provider)
  const remote = useApp((state) => state.preferences.reviews.remote)
  const connection = useApp((state) => state.remoteStatus?.state)
  const worktrees = useApp((state) =>
    JSON.stringify(
      state.workspace?.worktrees.map((tree) => [tree.path, tree.branch, tree.missing]),
    ),
  )

  useEffect(() => {
    useReviewState.setState({ entries: {} })
  }, [session, provider, remote])

  useEffect(() => {
    let cancelled = false
    let refreshing = false
    const refresh = async (force = false) => {
      const app = useApp.getState()
      if (cancelled || refreshing || !app.workspace || document.hidden) return
      refreshing = true
      const trees = [...app.workspace.worktrees].sort(
        (a, b) =>
          Number(b.path === app.preferences.activeWorktree) -
          Number(a.path === app.preferences.activeWorktree),
      )
      try {
        // Keep process and API concurrency bounded for large workspaces.
        for (let index = 0; index < trees.length && !cancelled; index += 3)
          await Promise.all(trees.slice(index, index + 3).map((tree) => refreshReview(tree, force)))
      } finally {
        refreshing = false
      }
    }
    void refresh()
    // Scheduled refreshes bypass the cache; measuring TTL from completion would
    // otherwise make a 60-second interval skip every other tick.
    const timer = setInterval(() => void refresh(true), 60_000)
    const unsubscribe = window.desktop.onWorkspaceChanged(() => void refresh())
    return () => {
      cancelled = true
      clearInterval(timer)
      unsubscribe()
    }
  }, [session, provider, remote, worktrees, connection])
}
