import type { TerminalLayout, TerminalLeaf } from './types'

export function leaves(layout: TerminalLayout): TerminalLeaf[] {
  return layout.type === 'terminal' ? [layout] : [...leaves(layout.first), ...leaves(layout.second)]
}

export function replaceNode(
  layout: TerminalLayout,
  id: string,
  replacement: TerminalLayout,
): TerminalLayout {
  if (layout.id === id) return replacement
  if (layout.type === 'terminal') return layout
  return {
    ...layout,
    first: replaceNode(layout.first, id, replacement),
    second: replaceNode(layout.second, id, replacement),
  }
}

export function removeLeaf(layout: TerminalLayout, id: string): TerminalLayout | null {
  if (layout.type === 'terminal') return layout.id === id ? null : layout
  const first = removeLeaf(layout.first, id)
  const second = removeLeaf(layout.second, id)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}
