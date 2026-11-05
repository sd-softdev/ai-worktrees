import { useState } from 'react'
import { ExternalLink, GitPullRequest, RefreshCw } from 'lucide-react'
import type { ReviewPreferences, ReviewRequest, Worktree } from '../../../shared/types'
import { refreshReview, useWorktreeReview } from '../reviews'
import { useApp } from '../store'

function stateLabel(request: ReviewRequest): string {
  if (request.state === 'merged') return 'Merged'
  if (request.state === 'closed') return 'Closed'
  return request.draft ? 'Draft' : 'Open'
}

export function ReviewBadge({ worktree }: { worktree: Worktree }) {
  const result = useWorktreeReview(worktree)?.result
  if (!result?.request) return null
  const { request } = result
  const stale = result.status !== 'ready'
  return (
    <span
      className={`review-badge ${request.state} ${request.draft ? 'draft' : ''} ${stale ? 'stale' : ''}`}
      title={`${request.title}${stale ? ' · Last known status; refresh unavailable' : ''}`}
    >
      <GitPullRequest size={12} />
      {result.provider === 'github' ? `PR #${request.number}` : `MR !${request.number}`} ·{' '}
      {stateLabel(request)}
      {stale && ' · Cached'}
    </span>
  )
}

const reviewLabels: Record<ReviewRequest['review'], string> = {
  approved: 'Approved',
  'changes-requested': 'Changes requested',
  required: 'Review required',
  unknown: 'Not available',
}
const checkLabels: Record<ReviewRequest['checks'], string> = {
  passed: 'Passed',
  failed: 'Failed',
  pending: 'Pending',
  none: 'No checks',
  unknown: 'Not available',
}

export function Reviews({ worktree }: { worktree: Worktree }) {
  const preferences = useApp((state) => state.preferences.reviews)
  const host = useApp((state) => state.workspace?.remote?.host)
  const disconnected = useApp((state) => state.remoteStatus?.state === 'disconnected')
  const entry = useWorktreeReview(worktree)
  const result = entry?.result
  const request = result?.request
  const loading = entry?.loading ?? (!worktree.missing && !disconnected)
  const cli = result?.provider === 'github' ? 'gh' : 'glab'
  const [linkError, setLinkError] = useState(false)
  const update = (value: Partial<ReviewPreferences>) =>
    useApp.getState().updatePreferences({ reviews: { ...preferences, ...value } })
  const open = (url: string) => {
    setLinkError(false)
    void window.desktop.openExternal(url).catch(() => setLinkError(true))
  }

  return (
    <section className="review-panel" aria-label="Pull and merge requests">
      <div className="section-heading">
        <h2>
          {result?.provider === 'github'
            ? 'Pull request'
            : result?.provider === 'gitlab'
              ? 'Merge request'
              : 'Pull / merge request'}
        </h2>
        <button
          className="icon-button"
          title="Refresh PR/MR status"
          aria-label="Refresh PR/MR status"
          disabled={loading || disconnected || worktree.missing}
          onClick={() => void refreshReview(worktree, true)}
        >
          <RefreshCw size={14} className={loading ? 'spinning' : ''} />
        </button>
      </div>
      {request && (
        <div className="review-details">
          <ReviewBadge worktree={worktree} />
          <h3>{request.title}</h3>
          <div className="review-branches">
            <code>{request.sourceBranch}</code> → <code>{request.targetBranch}</code>
          </div>
          <dl>
            <dt>Review</dt>
            <dd>{reviewLabels[request.review]}</dd>
            <dt>{result.provider === 'github' ? 'Checks' : 'Pipeline'}</dt>
            <dd className={`review-checks ${request.checks}`}>{checkLabels[request.checks]}</dd>
          </dl>
          <button className="secondary-button full-width" onClick={() => open(request.url)}>
            <ExternalLink size={14} /> Open in browser
          </button>
        </div>
      )}
      <div className="review-notice" role="status">
        {worktree.missing
          ? 'Worktree directory is missing.'
          : disconnected
            ? 'Reconnect to refresh PR/MR status.'
            : result?.message ||
              (result?.status === 'ready' && !request
                ? 'No PR or MR found for this branch.'
                : !result && loading
                  ? 'Checking PR/MR integration …'
                  : '')}
        {result?.status === 'unavailable' && request && <p>Showing the last known status.</p>}
      </div>
      {result?.reason === 'missing-cli' && result.provider && (
        <button
          className="secondary-button full-width"
          onClick={() =>
            open(
              result.provider === 'github'
                ? 'https://cli.github.com/'
                : 'https://gitlab.com/gitlab-org/cli#installation',
            )
          }
        >
          <ExternalLink size={14} /> {cli} installation instructions
        </button>
      )}
      {result?.reason === 'authentication' && (
        <code className="review-login">
          {cli} auth login --hostname {result.host}
        </code>
      )}
      {linkError && <p className="small muted">Could not open the browser. Please try again.</p>}
      {result?.repository && (
        <p className="small muted review-repository">
          {result.host}/{result.repository}
        </p>
      )}
      {result?.checkedAt && (
        <p className="small muted">
          Last checked {new Date(result.checkedAt).toLocaleTimeString()}
        </p>
      )}
      <div className="review-settings">
        <label htmlFor="review-provider">PR/MR provider</label>
        <select
          id="review-provider"
          value={preferences.provider}
          onChange={(event) =>
            update({ provider: event.target.value as ReviewPreferences['provider'] })
          }
        >
          <option value="auto">Automatic</option>
          <option value="github">GitHub (gh)</option>
          <option value="gitlab">GitLab (glab)</option>
          <option value="off">Disabled</option>
        </select>
        <label htmlFor="review-remote">Target remote</label>
        <select
          id="review-remote"
          value={preferences.remote}
          onChange={(event) => update({ remote: event.target.value })}
        >
          <option value="">Automatic</option>
          {[...new Set([...(result?.remotes ?? []), preferences.remote])]
            .filter(Boolean)
            .map((remote) => (
              <option key={remote}>{remote}</option>
            ))}
        </select>
        <p className="small muted">
          {host
            ? `CLIs run on SSH host ${host}. Install and sign in there.`
            : 'Uses your locally installed CLI and its existing sign-in.'}{' '}
          Status refreshes every 60 seconds.
        </p>
      </div>
    </section>
  )
}
