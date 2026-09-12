// Idempotent bot-owned PR comment for published previews. A stable HTML
// comment marker (unique per PR) lets us find and update our own comment
// on every publish instead of accumulating a new comment per commit.

const MARKER_PREFIX = '<!-- storybook-pages-preview:pr-';
const MARKER_SUFFIX = ' -->';
export const PREVIEW_COMMENT_AUTHOR = 'github-actions[bot]';

export function buildMarker(prNumber) {
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid PR number for preview comment marker: "${prNumber}"`);
  }
  return `${MARKER_PREFIX}${number}${MARKER_SUFFIX}`;
}

export function buildCommentBody({ prNumber, previewUrl, headSha, runId, repository }) {
  if (typeof previewUrl !== 'string' || previewUrl === '') {
    throw new Error('previewUrl is required to build a preview comment body');
  }
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error(`Invalid headSha "${headSha}" for preview comment body`);
  }
  const marker = buildMarker(prNumber);
  const runLink = repository && runId ? `https://github.com/${repository}/actions/runs/${runId}` : null;
  const runNote = runLink ? `[run ${runId}](${runLink})` : `run ${runId ?? 'unknown'}`;
  return [
    marker,
    '## 📖 Storybook preview',
    '',
    `**Preview URL:** ${previewUrl}`,
    '',
    `<sub>Built from commit \`${headSha.slice(0, 7)}\` (${runNote}). This comment is updated automatically as new commits are published; it is not recreated.</sub>`
  ].join('\n');
}

async function githubRequest(url, { token, method = 'GET', body } = {}) {
  if (!token) throw new Error('githubRequest requires a token');
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `token ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json'
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub API request failed (${response.status} ${method} ${url}): ${text}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function findExistingComment({ token, repository, prNumber, marker }) {
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid PR number "${prNumber}"`);
  }
  let page = 1;
  const maxPages = 20; // guard against runaway pagination on pathological threads
  while (page <= maxPages) {
    const comments = await githubRequest(
      `https://api.github.com/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
      { token }
    );
    const marked = comments.filter(comment => typeof comment.body === 'string' && comment.body.includes(marker));
    const conflicting = marked.find(comment =>
      comment.user?.login !== PREVIEW_COMMENT_AUTHOR || comment.user?.type !== 'Bot'
    );
    if (conflicting) {
      throw new Error(`Refusing to update comment ${conflicting.id}: preview marker is owned by a non-${PREVIEW_COMMENT_AUTHOR} account`);
    }
    if (marked.length > 0) return marked[0];
    if (comments.length < 100) return null;
    page += 1;
  }
  return null;
}

/**
 * Creates the bot preview comment on first publish, or updates the existing
 * one (found via the stable marker) on subsequent publishes. Never creates a
 * second comment for the same PR.
 */
export async function upsertPreviewComment({ token, repository, prNumber, body }) {
  if (!token) throw new Error('upsertPreviewComment requires a token');
  if (!repository) throw new Error('upsertPreviewComment requires a repository');
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid PR number "${prNumber}"`);
  }
  const marker = buildMarker(number);
  if (!body.includes(marker)) {
    throw new Error('Comment body must include the stable preview marker');
  }

  const existing = await findExistingComment({ token, repository, prNumber: number, marker });
  if (existing) {
    await githubRequest(`https://api.github.com/repos/${repository}/issues/comments/${existing.id}`, {
      token,
      method: 'PATCH',
      body: { body }
    });
    return { action: 'updated', commentId: existing.id };
  }

  const created = await githubRequest(`https://api.github.com/repos/${repository}/issues/${number}/comments`, {
    token,
    method: 'POST',
    body: { body }
  });
  return { action: 'created', commentId: created.id };
}

if (process.argv[1] && process.argv[1].endsWith('preview-comment.js')) {
  const prNumber = process.env.PR_NUMBER;
  const previewUrl = process.env.PREVIEW_URL;
  const headSha = process.env.HEAD_SHA;
  const runId = process.env.RUN_ID;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  const body = buildCommentBody({ prNumber, previewUrl, headSha, runId, repository });
  upsertPreviewComment({ token, repository, prNumber, body })
    .then(result => {
      console.log(`Preview comment ${result.action} (id ${result.commentId}) on PR #${prNumber}`);
    })
    .catch(error => {
      console.error(`Preview comment update failed: ${error.message}`);
      process.exit(1);
    });
}
