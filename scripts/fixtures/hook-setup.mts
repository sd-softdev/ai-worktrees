import { appendFileSync, readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

const branch: string = process.env.WORKTREE_BRANCH!
appendFileSync(
  '.hook-runs',
  JSON.stringify({
    branch,
    event: process.env.WORKTREE_EVENT,
    root: process.env.REPOSITORY_PATH,
    worktree: process.env.WORKTREE_PATH,
    cwd: process.cwd(),
  }) + '\n',
)
console.log('HOOK_READY:' + branch)
while (true) {
  const action: string = readFileSync(process.argv[2], 'utf8')
  if (action === 'fail') {
    console.error('HOOK_FAILURE_DETAIL')
    process.exit(7)
  }
  if (action === 'success') break
  await setTimeout(100)
}
console.log('HOOK_COMPLETE')
