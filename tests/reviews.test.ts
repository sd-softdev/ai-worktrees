import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git } from '../src/main/git'
import { parseReviewRemote, ReviewService, runReviewCli } from '../src/main/reviews'
import { shellQuote } from '../src/main/ssh/config'
import type { ReviewPreferences } from '../src/shared/types'

const execFileAsync = promisify(execFile)
const automatic: ReviewPreferences = { provider: 'auto', remote: '' }
let directory: string
const run = vi.fn<(cwd: string, cli: 'gh' | 'glab', args: string[]) => Promise<string>>()

function pullRequest(extra = {}) {
  return {
    number: 42,
    title: 'Workspace improvements',
    url: 'https://github.com/team/project/pull/42',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    headRefName: 'main',
    baseRefName: 'stable',
    headRepository: { name: 'project' },
    headRepositoryOwner: { login: 'team' },
    updatedAt: '2026-11-01T10:00:00Z',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...extra,
  }
}

function mergeRequest(extra = {}) {
  return {
    iid: 17,
    title: 'GitLab worktree',
    web_url: 'https://gitlab.com/team/subgroup/project/-/merge_requests/17',
    state: 'opened',
    draft: false,
    source_project_id: 123,
    source_branch: 'main',
    target_branch: 'stable',
    updated_at: '2026-11-01T10:00:00Z',
    ...extra,
  }
}

beforeEach(async () => {
  const base = path.join(os.tmpdir(), 'opencode')
  await mkdir(base, { recursive: true })
  directory = await realpath(await mkdtemp(path.join(base, 'agent-workspace-reviews-')))
  await git(directory, ['init', '-b', 'main'])
  run.mockReset()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true })
})

describe('optional CLI integration', () => {
  it.each([
    ['git@github.com:team/project.git', { host: 'github.com', project: 'team/project' }],
    [
      'https://user:secret@gitlab.com/team/subgroup/project.git',
      { host: 'gitlab.com', project: 'team/subgroup/project' },
    ],
    [
      'ssh://git@git.example.test:2222/team/project.git',
      { host: 'git.example.test', project: 'team/project' },
    ],
    [
      'https://git.example.test:8443/team/project/',
      { host: 'git.example.test:8443', project: 'team/project' },
    ],
    ['/local/repository', null],
    ['C:\\local\\repository', null],
    ['file:///local/repository', null],
    ['https://github.com/team', null],
  ])('understands remote %s', (url, expected) => {
    expect(parseReviewRemote(url as string)).toEqual(expected)
  })

  it('does not invoke a CLI for repositories without remotes or disabled integrations', async () => {
    const service = new ReviewService(run)
    expect(await service.get(directory, automatic)).toMatchObject({
      status: 'unsupported',
      remotes: [],
    })
    await git(directory, ['remote', 'add', 'origin', 'git@github.com:team/project.git'])
    expect(await service.get(directory, { ...automatic, provider: 'off' })).toMatchObject({
      status: 'disabled',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it.each(['github', 'gitlab'] as const)(
    'handles a real missing %s executable and recovers after refresh',
    async (provider) => {
      await git(directory, ['remote', 'add', 'origin', `https://${provider}.com/team/project.git`])
      // Produce the real OS ENOENT shape, independent of what is installed on CI.
      run.mockImplementation(
        async (cwd, cli, args) =>
          (await execFileAsync(path.join(directory, 'missing-bin', cli), args, { cwd })).stdout,
      )
      const service = new ReviewService(run)
      const missing = await service.get(directory, automatic)
      expect(missing).toMatchObject({ status: 'unavailable', reason: 'missing-cli', provider })
      expect(missing.message).not.toContain('ENOENT')
      expect(missing.request).toBeUndefined()
      const calls = run.mock.calls.length
      expect(await service.get(directory, automatic)).toEqual(missing)
      expect(run).toHaveBeenCalledTimes(calls)
      run.mockImplementation(async (_cwd, _cli, args) =>
        args.at(-1)?.includes('/merge_requests?')
          ? '[]'
          : provider === 'gitlab'
            ? '{"id":123}'
            : '[]',
      )
      expect(await service.get(directory, automatic, true)).toMatchObject({
        status: 'ready',
        request: undefined,
      })
    },
  )

  it.each(['gh', 'glab'] as const)(
    'preserves missing-executable errors from the real %s runner',
    async (cli) => {
      vi.stubEnv('PATH', path.join(directory, 'empty-path'))
      vi.stubEnv('SHELL', path.join(directory, 'missing-shell'))
      await expect(runReviewCli(directory, cli, ['--version'])).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )

  it.each([
    ['github', { code: 4, stderr: 'Run gh auth login. secret-token' }],
    ['gitlab', { code: 1, stderr: 'GET https://gitlab.com/api/v4: 401 Unauthorized secret-token' }],
  ] as const)(
    'shows a nonfatal authentication state for %s without exposing CLI output',
    async (provider, error) => {
      await git(directory, [
        'remote',
        'add',
        'origin',
        `https://user:secret-token@${provider}.com/team/project.git`,
      ])
      run.mockRejectedValue(error)
      const result = await new ReviewService(run).get(directory, automatic)
      expect(result).toMatchObject({ status: 'unavailable', reason: 'authentication', provider })
      expect(JSON.stringify(result)).not.toContain('secret-token')
    },
  )

  it('allows an explicit provider on self-hosted instances and detects removed remotes', async () => {
    await git(directory, ['remote', 'add', 'origin', 'https://git.example.test/team/project.git'])
    const service = new ReviewService(run)
    expect(await service.get(directory, automatic)).toMatchObject({
      status: 'unsupported',
      host: 'git.example.test',
    })
    expect(run).not.toHaveBeenCalled()
    run.mockResolvedValue('[]')
    expect(await service.get(directory, { provider: 'github', remote: 'origin' })).toMatchObject({
      status: 'ready',
      provider: 'github',
    })
    expect(run.mock.calls[0][2]).toContain('git.example.test/team/project')
    expect(await service.get(directory, { provider: 'github', remote: 'removed' })).toMatchObject({
      status: 'unsupported',
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('keeps cached status on network failures, retries, and clears it when no request remains', async () => {
    await git(directory, ['remote', 'add', 'origin', 'https://github.com/team/project'])
    run.mockResolvedValue(JSON.stringify([pullRequest()]))
    const service = new ReviewService(run)
    const ready = await service.get(directory, automatic)
    run.mockRejectedValue({ code: 'ETIMEDOUT', killed: true })
    const unavailable = await service.get(directory, automatic, true)
    expect(unavailable).toMatchObject({
      status: 'unavailable',
      reason: 'request-failed',
      request: ready.request,
      checkedAt: ready.checkedAt,
    })
    run.mockResolvedValue('[]')
    expect(await service.get(directory, automatic, true)).toMatchObject({
      status: 'ready',
      request: undefined,
    })
  })

  it('treats malformed responses as unavailable rather than an empty list', async () => {
    await git(directory, ['remote', 'add', 'origin', 'https://github.com/team/project'])
    const service = new ReviewService(run)
    for (const output of ['not JSON', '{"message":"bad token"}', '[{"number":42}]']) {
      run.mockResolvedValue(output)
      expect(await service.get(directory, automatic, true)).toMatchObject({
        status: 'unavailable',
        reason: 'request-failed',
      })
    }
  })

  it('coalesces in-flight queries and refreshes cached data after one minute', async () => {
    await git(directory, ['remote', 'add', 'origin', 'https://github.com/team/project'])
    let release!: (value: string) => void
    run.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const service = new ReviewService(run)
    const first = service.get(directory, automatic)
    const second = service.get(directory, automatic)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    release('[]')
    await Promise.all([first, second])
    expect(run).toHaveBeenCalledTimes(1)
    await service.get(directory, automatic)
    expect(run).toHaveBeenCalledTimes(1)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001)
    await service.get(directory, automatic)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('invalidates cached lookups when branches or remote URLs change', async () => {
    await git(directory, ['remote', 'add', 'origin', 'https://github.com/team/project'])
    run.mockResolvedValue('[]')
    const service = new ReviewService(run)
    await service.get(directory, automatic)
    await git(directory, ['symbolic-ref', 'HEAD', 'refs/heads/topic'])
    await service.get(directory, automatic)
    expect(run.mock.calls[1][2]).toContain('topic')
    await git(directory, ['remote', 'set-url', 'origin', 'https://github.com/other/project'])
    await service.get(directory, automatic)
    expect(run.mock.calls[2][2]).toContain('github.com/other/project')
    expect(run).toHaveBeenCalledTimes(3)
  })
})

describe.runIf(process.platform === 'darwin')('macOS GUI CLI lookup', () => {
  const finderPath = '/usr/bin:/bin:/usr/sbin:/sbin'
  let home: string
  let bin: string

  beforeEach(async () => {
    home = path.join(directory, 'home')
    bin = path.join(home, "User's CLI tools")
    await mkdir(bin, { recursive: true })
    vi.stubEnv('HOME', home)
    vi.stubEnv('ZDOTDIR', home)
    vi.stubEnv('SHELL', '/bin/zsh')
    vi.stubEnv('PATH', finderPath)
    await writeFile(path.join(home, '.zshrc'), `export PATH=${shellQuote(finderPath)}\n`)
  })

  it.each(['gh', 'glab'] as const)(
    'finds %s through login and interactive config without shell-expanding CLI arguments',
    async (cli) => {
      const loginBin = path.join(home, 'login-bin')
      await mkdir(loginBin)
      await writeFile(
        path.join(home, '.zprofile'),
        `export PATH=${shellQuote(loginBin)}:${finderPath}\nprintf 'Login banner\\n'\n`,
      )
      await writeFile(
        path.join(home, '.zshrc'),
        `export PATH=${shellQuote(bin)}:"$PATH"\nprintf 'Interactive banner\\n'\n`,
      )
      await writeFile(path.join(home, '.zlogout'), "printf 'Logout banner\\n'\n")
      await writeFile(
        path.join(loginBin, 'profile-helper'),
        "#!/bin/sh\nprintf 'login PATH inherited\\n'\n",
        { mode: 0o755 },
      )
      await writeFile(
        path.join(bin, cli),
        '#!/bin/sh\nread -r unexpected && exit 1\nprintf \'%s\\n\' "$PWD" "$@" "$GH_PROMPT_DISABLED" "$GLAB_CHECK_UPDATE"\nprofile-helper\n',
        { mode: 0o755 },
      )
      const args = [
        'api',
        'projects/team%2Fproject/merge_requests?state=all&scope=all',
        "literal spaces 'quotes' $HOME $(exit 1)",
      ]
      expect(await runReviewCli(directory, cli, args)).toBe(
        [directory, ...args, '1', 'false', 'login PATH inherited', ''].join('\n'),
      )
      expect(process.env.PATH).toBe(finderPath)
    },
  )

  it('recovers after the shell PATH changes following a missing CLI result', async () => {
    await expect(runReviewCli(directory, 'glab', ['--version'])).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await writeFile(path.join(bin, 'glab'), "#!/bin/sh\nprintf 'glab fixture\\n'\n", {
      mode: 0o755,
    })
    await writeFile(path.join(home, '.zshrc'), `export PATH=${shellQuote(bin)}:${finderPath}\n`)
    expect(await runReviewCli(directory, 'glab', ['--version'])).toBe('glab fixture\n')
    expect((await git(directory, ['status', '--porcelain'])).trim()).toBe('?? home/')
  })

  it('keeps missing CLI failures nonfatal when shell startup hangs', async () => {
    const shell = path.join(home, 'slow-shell')
    await writeFile(shell, '#!/bin/sh\nexec /bin/sleep 30\n', { mode: 0o755 })
    vi.stubEnv('SHELL', shell)
    await git(directory, ['remote', 'add', 'origin', 'https://gitlab.com/team/project'])
    const start = Date.now()
    expect(await new ReviewService().get(directory, automatic)).toMatchObject({
      status: 'unavailable',
      reason: 'missing-cli',
    })
    expect(Date.now() - start).toBeLessThan(8_000)
    expect((await git(directory, ['branch', '--show-current'])).trim()).toBe('main')
  })
})

describe('provider data and branch association', () => {
  it('matches the source fork, prefers open PRs and normalizes draft/review/check statuses', async () => {
    await git(directory, ['remote', 'add', 'origin', 'git@github.com:alice/project.git'])
    await git(directory, ['remote', 'add', 'upstream', 'https://github.com/team/project'])
    run.mockResolvedValue(
      JSON.stringify([
        pullRequest({
          number: 1,
          isCrossRepository: true,
          headRepositoryOwner: { login: 'someone-else' },
        }),
        pullRequest({
          number: 2,
          state: 'MERGED',
          isCrossRepository: true,
          headRepositoryOwner: { login: 'alice' },
          updatedAt: '2026-11-02T00:00:00Z',
        }),
        pullRequest({
          isDraft: true,
          isCrossRepository: true,
          headRepositoryOwner: { login: 'alice' },
          reviewDecision: 'CHANGES_REQUESTED',
          statusCheckRollup: [{ state: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: null }],
        }),
      ]),
    )
    const result = await new ReviewService(run).get(directory, automatic)
    expect(run.mock.calls[0][2]).toContain('github.com/team/project')
    expect(result).toMatchObject({
      status: 'ready',
      remote: 'upstream',
      provider: 'github',
      request: {
        number: 42,
        state: 'open',
        draft: true,
        sourceBranch: 'main',
        targetBranch: 'stable',
        review: 'changes-requested',
        checks: 'pending',
      },
    })
  })

  it('honors push-remote overrides when branches with the same name exist in different repositories', async () => {
    await git(directory, ['remote', 'add', 'origin', 'https://github.com/team/project'])
    await git(directory, ['remote', 'add', 'fork', 'https://github.com/alice/project'])
    await git(directory, ['config', 'branch.main.pushRemote', 'fork'])
    run.mockResolvedValue(
      JSON.stringify([
        pullRequest(),
        pullRequest({
          number: 9,
          isCrossRepository: true,
          headRepositoryOwner: { login: 'alice' },
        }),
      ]),
    )
    const result = await new ReviewService(run).get(directory, { ...automatic, remote: 'origin' })
    expect(result.request?.number).toBe(9)
  })

  it('normalizes closed/merged PRs and failed, empty, or unknown checks', async () => {
    await git(directory, ['remote', 'add', 'origin', 'https://github.com/team/project'])
    const service = new ReviewService(run)
    for (const [state, rollup, expected] of [
      ['MERGED', [{ status: 'COMPLETED', conclusion: 'FAILURE' }], 'failed'],
      ['CLOSED', [{ state: 'PENDING' }, { state: 'ERROR' }], 'failed'],
      ['OPEN', [], 'none'],
      ['OPEN', [{ status: 'NEW_API_STATE' }], 'unknown'],
    ] as const) {
      run.mockResolvedValue(JSON.stringify([pullRequest({ state, statusCheckRollup: rollup })]))
      expect((await service.get(directory, automatic, true)).request).toMatchObject({
        state: state.toLowerCase(),
        checks: expected,
      })
    }
  })

  it('loads GitLab fork MRs using encoded nested paths and branch names', async () => {
    await git(directory, ['remote', 'add', 'origin', 'git@gitlab.com:alice/subgroup/project.git'])
    await git(directory, ['remote', 'add', 'upstream', 'https://gitlab.com/team/subgroup/project'])
    await git(directory, ['symbolic-ref', 'HEAD', 'refs/heads/feat/test&branch'])
    run.mockImplementation(async (_cwd, cli, args) => {
      expect(cli).toBe('glab')
      expect(args).toContain('GET')
      const endpoint = args.at(-1)!
      if (endpoint.includes('/merge_requests?'))
        return JSON.stringify([
          mergeRequest({ iid: 999, source_project_id: 456, source_branch: 'feat/test&branch' }),
          mergeRequest({ source_branch: 'feat/test&branch', draft: true }),
        ])
      if (endpoint.endsWith('/approvals'))
        return JSON.stringify({ approvals_left: 1, approvals_required: 2 })
      if (endpoint.endsWith('/merge_requests/17'))
        return JSON.stringify({
          head_pipeline: { status: 'failed' },
          detailed_merge_status: 'not_approved',
        })
      return '{"id":123}'
    })
    const result = await new ReviewService(run).get(directory, automatic)
    expect(
      run.mock.calls.some(([, , args]) =>
        args
          .at(-1)
          ?.includes(
            'projects/team%2Fsubgroup%2Fproject/merge_requests?scope=all&state=all&source_branch=feat%2Ftest%26branch',
          ),
      ),
    ).toBe(true)
    expect(result).toMatchObject({
      status: 'ready',
      provider: 'gitlab',
      request: { number: 17, state: 'open', draft: true, checks: 'failed', review: 'required' },
    })
  })

  it('keeps GitLab MR details usable when approval/pipeline APIs are unavailable', async () => {
    await git(directory, ['remote', 'add', 'origin', 'https://gitlab.com/team/subgroup/project'])
    run.mockImplementation(async (_cwd, _cli, args) => {
      const endpoint = args.at(-1)!
      if (endpoint.includes('/merge_requests?'))
        return JSON.stringify([mergeRequest({ state: 'merged' })])
      if (endpoint.includes('/merge_requests/')) throw { code: 1, stderr: '403 Forbidden' }
      return '{"id":123}'
    })
    expect(await new ReviewService(run).get(directory, automatic)).toMatchObject({
      status: 'ready',
      request: { state: 'merged', checks: 'unknown', review: 'unknown' },
    })
  })
})
