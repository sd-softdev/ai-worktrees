import type { HookRun } from './types'

// Polling and workspace refreshes can arrive out of order. Never regress a
// finished run or replace a retried setup with a response from the previous run.
export function mergeHookRuns(
  previous: Record<string, HookRun> = {},
  incoming: Record<string, HookRun> = {},
): Record<string, HookRun> {
  const runs = { ...previous }
  for (const [directory, run] of Object.entries(incoming)) {
    const old = runs[directory]
    if (
      !old ||
      run.startedAt > old.startedAt ||
      (run.id === old.id && run.revision >= old.revision)
    )
      runs[directory] = run
  }
  return runs
}
