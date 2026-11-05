import { expect, it } from 'vitest'
import { orderedWorktrees } from '../src/shared/worktree-order'
import type { Worktree } from '../src/shared/types'

it('keeps the base separate, ignores removed/duplicate entries and appends newly discovered worktrees', () => {
  const worktree = (path: string, isMain = false): Worktree => ({
    path,
    isMain,
    branch: path,
    head: '',
    locked: false,
    prunable: false,
    missing: false,
    changedFiles: 0,
  })
  const items = [worktree('base', true), worktree('a'), worktree('b'), worktree('new')]
  expect(
    orderedWorktrees(items, ['base', 'removed', 'b', 'b', 'a']).map((item) => item.path),
  ).toEqual(['b', 'a', 'new'])
  expect(orderedWorktrees(items, []).map((item) => item.path)).toEqual(['a', 'b', 'new'])
})
