import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type {
  ReviewPreferences,
  ReviewProvider,
  ReviewRequest,
  ReviewResult,
} from '../shared/types'
import { git } from './git'

const execFileAsync = promisify(execFile)
const cacheDuration = 60_000
type CliRunner = (cwd: string, cli: 'gh' | 'glab', args: string[]) => Promise<string>
interface Repository {
  host: string
  project: string
}
interface ReviewContext {
  branch: string
  source: Repository
  target: Repository
  provider: ReviewProvider
  remote: string
  remotes: string[]
}

// Execute directly, with closed stdin and a deadline: optional integrations must
// never wait for an interactive login or block Git/terminal operations.
export const runReviewCli: CliRunner = async (cwd, cli, args) => {
  const child = execFileAsync(cli, args, {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      GLAB_CHECK_UPDATE: 'false',
      GIT_TERMINAL_PROMPT: '0',
      NO_COLOR: '1',
      LC_ALL: 'C',
    },
  })
  child.child.stdin?.end()
  return (await child).stdout
}

export function parseReviewRemote(value: string): Repository | null {
  try {
    if (/^[a-z]:[\\/]/i.test(value)) return null
    // SCP-style SSH remotes, HTTPS URLs and ssh:// URLs are all common.
    const scp = !value.includes('://') && /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(value)
    const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : value)
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return null
    const host = (['ssh:', 'git:'].includes(url.protocol) ? url.hostname : url.host).toLowerCase()
    const project = decodeURIComponent(url.pathname)
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/, '')
    if (!host || project.split('/').length < 2 || /[\s\x00-\x1f?#]/.test(project)) return null
    if (project.split('/').some((part) => !part || part === '.' || part === '..')) return null
    return { host, project }
  } catch {
    return null
  }
}

async function context(
  directory: string,
  preferences: ReviewPreferences,
): Promise<ReviewContext | ReviewResult> {
  const [branch, configuration] = await Promise.all([
    git(directory, ['branch', '--show-current']).then((value) => value.trim()),
    git(directory, ['config', '--null', '--list']),
  ])
  const config = new Map<string, string>()
  for (const entry of configuration.split('\0')) {
    const separator = entry.indexOf('\n')
    if (separator > 0) config.set(entry.slice(0, separator), entry.slice(separator + 1))
  }
  const remotes = [...config.keys()].flatMap((key) => {
    const match = /^remote\.(.+)\.url$/.exec(key)
    return match ? [match[1]] : []
  })
  if (preferences.provider === 'off')
    return {
      status: 'disabled',
      remotes,
      message: 'PR/MR integration is disabled for this workspace.',
    }
  if (!branch)
    return {
      status: 'unsupported',
      remotes,
      message: 'Select a worktree with a branch to find its PR or MR.',
    }
  if (!remotes.length)
    return {
      status: 'unsupported',
      remotes,
      message: 'Add a GitHub or GitLab remote to enable PR/MR status.',
    }

  const sourceRemote = [
    config.get(`branch.${branch}.pushremote`),
    config.get('remote.pushdefault'),
    config.get(`branch.${branch}.remote`),
    'origin',
    remotes[0],
  ].find((name) => name && remotes.includes(name))!
  const remote = preferences.remote || (remotes.includes('upstream') ? 'upstream' : sourceRemote)
  if (!remotes.includes(remote))
    return {
      status: 'unsupported',
      remotes,
      message: 'The selected Git remote no longer exists. Choose another remote.',
    }
  const [targetUrl, sourceUrl] = await Promise.all([
    git(directory, ['remote', 'get-url', '--', remote]),
    git(directory, ['remote', 'get-url', '--push', '--', sourceRemote]),
  ])
  const target = parseReviewRemote(targetUrl.trim())
  const source = parseReviewRemote(sourceUrl.trim())
  if (!target || !source || source.host !== target.host)
    return {
      status: 'unsupported',
      remotes,
      remote,
      message: 'Choose a GitHub or GitLab remote on the same host as the branch source.',
    }
  const provider =
    preferences.provider === 'auto'
      ? target.host === 'github.com'
        ? 'github'
        : target.host === 'gitlab.com'
          ? 'gitlab'
          : undefined
      : preferences.provider
  if (!provider)
    return {
      status: 'unsupported',
      remotes,
      remote,
      host: target.host,
      message: 'Select GitHub or GitLab below for a self-hosted instance.',
    }
  if (provider === 'github' && target.project.split('/').length !== 2)
    return {
      status: 'unsupported',
      remotes,
      remote,
      provider,
      message: 'GitHub remotes must use an owner/repository path.',
    }
  return { branch, source, target, provider, remote, remotes }
}

const webUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value))
const githubRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: webUrl,
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  isCrossRepository: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRepository: z.object({ name: z.string() }).nullish(),
  headRepositoryOwner: z.object({ login: z.string() }).nullish(),
  updatedAt: z.string(),
  reviewDecision: z.string().nullish(),
  statusCheckRollup: z
    .array(
      z.object({
        status: z.string().nullish(),
        conclusion: z.string().nullish(),
        state: z.string().nullish(),
      }),
    )
    .nullish(),
})
const gitlabRequest = z.object({
  iid: z.number().int().positive(),
  title: z.string(),
  web_url: webUrl,
  state: z.enum(['opened', 'closed', 'merged', 'locked']),
  draft: z.boolean().optional(),
  work_in_progress: z.boolean().optional(),
  source_project_id: z.number().nullable(),
  source_branch: z.string(),
  target_branch: z.string(),
  updated_at: z.string(),
})

function checks(states: string[]): ReviewRequest['checks'] {
  if (!states.length) return 'none'
  if (
    states.some((value) =>
      [
        'FAILURE',
        'FAILED',
        'ERROR',
        'CANCELLED',
        'CANCELED',
        'TIMED_OUT',
        'ACTION_REQUIRED',
        'STARTUP_FAILURE',
      ].includes(value),
    )
  )
    return 'failed'
  if (
    states.some((value) =>
      [
        'PENDING',
        'QUEUED',
        'IN_PROGRESS',
        'RUNNING',
        'CREATED',
        'WAITING_FOR_RESOURCE',
        'PREPARING',
        'MANUAL',
        'SCHEDULED',
        'WAITING',
        'REQUESTED',
      ].includes(value),
    )
  )
    return 'pending'
  if (states.every((value) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(value))) return 'passed'
  return 'unknown'
}

async function github(
  directory: string,
  value: ReviewContext,
  run: CliRunner,
): Promise<ReviewRequest | undefined> {
  const output = await run(directory, 'gh', [
    'pr',
    'list',
    '--repo',
    `${value.target.host}/${value.target.project}`,
    '--head',
    value.branch,
    '--state',
    'all',
    '--limit',
    '100',
    '--json',
    Object.keys(githubRequest.shape).join(','),
  ])
  const requests = z
    .array(githubRequest)
    .parse(JSON.parse(output))
    .filter((request) => {
      const source = request.isCrossRepository
        ? `${request.headRepositoryOwner?.login}/${request.headRepository?.name}`
        : value.target.project
      return (
        request.headRefName === value.branch &&
        source.toLowerCase() === value.source.project.toLowerCase()
      )
    })
  requests.sort(
    (a, b) =>
      Number(b.state === 'OPEN') - Number(a.state === 'OPEN') ||
      b.updatedAt.localeCompare(a.updatedAt),
  )
  const request = requests[0]
  if (!request) return undefined
  return {
    number: request.number,
    title: request.title,
    url: request.url,
    state: request.state.toLowerCase() as ReviewRequest['state'],
    draft: request.isDraft,
    sourceBranch: request.headRefName,
    targetBranch: request.baseRefName,
    review:
      request.reviewDecision === 'APPROVED'
        ? 'approved'
        : request.reviewDecision === 'CHANGES_REQUESTED'
          ? 'changes-requested'
          : request.reviewDecision === 'REVIEW_REQUIRED'
            ? 'required'
            : 'unknown',
    checks: checks(
      (request.statusCheckRollup ?? []).map(
        (check) =>
          check.state ||
          (check.status === 'COMPLETED' ? check.conclusion : check.status) ||
          'UNKNOWN',
      ),
    ),
  }
}

async function gitlab(
  directory: string,
  value: ReviewContext,
  run: CliRunner,
): Promise<ReviewRequest | undefined> {
  const api = async (endpoint: string) =>
    JSON.parse(
      await run(directory, 'glab', [
        'api',
        '--hostname',
        value.target.host,
        '--method',
        'GET',
        endpoint,
      ]),
    ) as unknown
  const project = `projects/${encodeURIComponent(value.target.project)}`
  const [source, listed] = await Promise.all([
    api(`projects/${encodeURIComponent(value.source.project)}`).then((data) =>
      z.object({ id: z.number() }).parse(data),
    ),
    api(
      `${project}/merge_requests?scope=all&state=all&source_branch=${encodeURIComponent(value.branch)}&order_by=updated_at&sort=desc&per_page=100`,
    ),
  ])
  const requests = z
    .array(gitlabRequest)
    .parse(listed)
    .filter(
      (request) =>
        request.source_project_id === source.id && request.source_branch === value.branch,
    )
  requests.sort(
    (a, b) =>
      Number(b.state === 'opened') - Number(a.state === 'opened') ||
      b.updated_at.localeCompare(a.updated_at),
  )
  const request = requests[0]
  if (!request) return undefined
  const endpoint = `${project}/merge_requests/${request.iid}`
  // Approval APIs vary by GitLab edition and permissions. Core MR data remains
  // useful when either optional detail request is unavailable.
  const [detail, approvals] = await Promise.all([
    api(endpoint)
      .then((data) =>
        z
          .object({
            head_pipeline: z.object({ status: z.string() }).nullish(),
            detailed_merge_status: z.string().optional(),
          })
          .parse(data),
      )
      .catch(() => null),
    api(`${endpoint}/approvals`)
      .then((data) =>
        z
          .object({
            approved: z.boolean().optional(),
            approvals_left: z.number().optional(),
            approvals_required: z.number().optional(),
          })
          .parse(data),
      )
      .catch(() => null),
  ])
  return {
    number: request.iid,
    title: request.title,
    url: request.web_url,
    state: request.state === 'merged' ? 'merged' : request.state === 'closed' ? 'closed' : 'open',
    draft: request.draft ?? request.work_in_progress ?? false,
    sourceBranch: request.source_branch,
    targetBranch: request.target_branch,
    review:
      detail?.detailed_merge_status === 'requested_changes'
        ? 'changes-requested'
        : approvals?.approved ||
            (approvals?.approvals_left === 0 && (approvals.approvals_required ?? 0) > 0)
          ? 'approved'
          : (approvals?.approvals_left ?? 0) > 0 || detail?.detailed_merge_status === 'not_approved'
            ? 'required'
            : 'unknown',
    checks: detail
      ? checks(detail.head_pipeline ? [detail.head_pipeline.status.toUpperCase()] : [])
      : 'unknown',
  }
}

function failure(error: unknown, value: ReviewContext): ReviewResult {
  const cli = value.provider === 'github' ? 'gh' : 'glab'
  const detail = error as { code?: string | number; message?: string; stderr?: string }
  const text = `${detail?.stderr ?? ''} ${detail?.message ?? ''}`
  const reason =
    detail?.code === 'ENOENT'
      ? 'missing-cli'
      : detail?.code === 4 ||
          /(?:not logged|auth login|authentication|authenticate|401|bad credentials|invalid token)/i.test(
            text,
          )
        ? 'authentication'
        : 'request-failed'
  return {
    status: 'unavailable',
    reason,
    provider: value.provider,
    host: value.target.host,
    repository: value.target.project,
    remote: value.remote,
    remotes: value.remotes,
    message:
      reason === 'missing-cli'
        ? `${cli} is not available on PATH. Install the CLI, then refresh.`
        : reason === 'authentication'
          ? `Sign in with ${cli} for ${value.target.host}, then refresh.`
          : `Could not load PR/MR status. Check ${cli} access to ${value.target.host} and your network, then refresh.`,
  }
}

export class ReviewService {
  private cache = new Map<string, { time: number; result: ReviewResult }>()
  private pending = new Map<string, Promise<ReviewResult>>()

  constructor(private run: CliRunner = runReviewCli) {}

  async get(
    directory: string,
    preferences: ReviewPreferences,
    force = false,
  ): Promise<ReviewResult> {
    let value: ReviewContext | ReviewResult
    try {
      value = await context(directory, preferences)
    } catch {
      return {
        status: 'unavailable',
        reason: 'request-failed',
        remotes: [],
        message: 'PR/MR status is temporarily unavailable. Refresh to retry.',
      }
    }
    if ('status' in value) return value
    const key = JSON.stringify([directory, value])
    const previous = this.cache.get(key)
    if (!force && previous && Date.now() - previous.time < cacheDuration) return previous.result
    const pending = this.pending.get(key)
    if (pending) return pending
    const operation = (async (): Promise<ReviewResult> => {
      let result: ReviewResult
      try {
        result = {
          status: 'ready',
          provider: value.provider,
          host: value.target.host,
          repository: value.target.project,
          remote: value.remote,
          remotes: value.remotes,
          request: await (value.provider === 'github' ? github : gitlab)(
            directory,
            value,
            this.run,
          ),
          checkedAt: new Date().toISOString(),
        }
      } catch (error) {
        result = failure(error, value)
        if (result.reason === 'request-failed' && previous?.result.request) {
          result.request = previous.result.request
          result.checkedAt = previous.result.checkedAt
        }
      }
      this.cache.set(key, { time: Date.now(), result })
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!)
      return result
    })()
    this.pending.set(key, operation)
    try {
      return await operation
    } finally {
      this.pending.delete(key)
    }
  }
}
