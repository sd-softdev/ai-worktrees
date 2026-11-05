import type { Worktree } from './types'

export function orderedWorktrees(worktrees: Worktree[], order: string[]): Worktree[] {
  const remaining = new Map(
    worktrees.filter((item) => !item.isMain).map((item) => [item.path, item]),
  )
  const result: Worktree[] = []
  for (const path of order) {
    const worktree = remaining.get(path)
    if (!worktree) continue
    result.push(worktree)
    remaining.delete(path)
  }
  return [...result, ...remaining.values()]
}
