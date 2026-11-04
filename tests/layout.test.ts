import { expect, it } from 'vitest'
import { leaves, removeLeaf } from '../src/shared/layout'
import type { TerminalLayout } from '../src/shared/types'

it('collapses a nested split while preserving remaining session identities', () => {
  const layout: TerminalLayout = {
    type: 'split',
    id: 'outer',
    direction: 'horizontal',
    ratio: 0.5,
    first: { type: 'terminal', id: 'agent', title: 'Agent' },
    second: {
      type: 'split',
      id: 'inner',
      direction: 'vertical',
      ratio: 0.5,
      first: { type: 'terminal', id: 'build', title: 'Build' },
      second: { type: 'terminal', id: 'test', title: 'Test' },
    },
  }
  const result = removeLeaf(layout, 'build')!
  expect(leaves(result).map((leaf) => leaf.id)).toEqual(['agent', 'test'])
  expect(result.type === 'split' && result.second).toEqual({
    type: 'terminal',
    id: 'test',
    title: 'Test',
  })
  const remaining = removeLeaf(result, 'agent')!
  expect(remaining.id).toBe('test')
  expect(removeLeaf(remaining, 'test')).toBeNull()
})
