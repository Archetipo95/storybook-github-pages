import fs from 'node:fs/promises';
import path from 'node:path';
import { validateRelativeDirectory, resolveConfiguration } from './config.js';
import { run, withSerializedBranchWrite, requestPagesRebuild } from './git-branch-writer.js';

const PREVIEW_DIR_PATTERN = /^pr-(\d+)$/;

/**
 * Parses a preview root entry name and returns its PR number, or null when
 * the entry does not match the strict `pr-<digits>` naming scheme. Anything
 * that does not match (e.g. hand-created or unrelated directories) is left
 * untouched by the janitor rather than guessed at.
 */
export function parsePreviewDirName(name) {
  const match = PREVIEW_DIR_PATTERN.exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * Pure classification of preview-root entries into keep/remove/ignore,
 * independent of filesystem or network access so it can be exercised with
 * plain data in tests. A directory is removed when its PR is no longer open
 * OR it has exceeded the configured retention window while still open
 * (e.g. a long-lived draft PR); everything else, including directories that
 * do not look like `pr-<number>`, is left alone.
 */
export function classifyPreviewEntries({ entries, openPrNumbers, retentionMs, now = Date.now(), getLastModifiedMs }) {
  const keep = [];
  const remove = [];
  const ignored = [];

  for (const entry of entries) {
    const prNumber = parsePreviewDirName(entry);
    if (prNumber === null) {
      ignored.push(entry);
      continue;
    }
    if (!openPrNumbers.has(prNumber)) {
      remove.push({ entry, prNumber, reason: 'pr-not-open' });
      continue;
    }
    const lastModifiedMs = getLastModifiedMs ? getLastModifiedMs(entry) : null;
    if (Number.isFinite(retentionMs) && retentionMs > 0 && typeof lastModifiedMs === 'number' && (now - lastModifiedMs) > retentionMs) {
      remove.push({ entry, prNumber, reason: 'stale-retention' });
      continue;
    }
    keep.push(entry);
  }

  return { keep, remove, ignored };
}

async function listPreviewEntries(repo, previewRoot) {
  const root = previewRoot ? path.join(repo, previewRoot) : repo;
  try {
    const dirents = await fs.readdir(root, { withFileTypes: true });
    return dirents.filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function lastModifiedMsForPath(repo, relativePath) {
  try {
    const timestamp = await run('git', ['log', '-1', '--format=%ct', '--', relativePath], repo);
    if (!timestamp) return null;
    return Number(timestamp) * 1000;
  } catch {
    return null;
  }
}

async function fetchOpenPullRequestNumbers({ token, repository }) {
  const open = new Set();
  let page = 1;
  while (page <= 50) {
    const response = await fetch(`https://api.github.com/repos/${repository}/pulls?state=open&per_page=100&page=${page}`, {
      headers: { authorization: `token ${token}`, accept: 'application/vnd.github+json' }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Listing open pull requests failed (${response.status}): ${text}`);
    }
    const pulls = await response.json();
    for (const pull of pulls) open.add(pull.number);
    if (pulls.length < 100) break;
    page += 1;
  }
  return open;
}

/**
 * Scans the preview root of a checked-out Pages branch and removes only
 * directories that qualify for cleanup: previews for pull requests that are
 * no longer open, or previews that have exceeded the configured retention
 * window while the pull request is still open. Never touches anything
 * outside `previewRoot`, and never removes an entry that does not match the
 * `pr-<number>` naming scheme (this protects production/environment
 * directories and any manually managed content).
 */
export async function runJanitor({ repo, branch = 'gh-pages', previewRoot = 'pr-preview', retentionDays = 30, token, repository }) {
  validateRelativeDirectory(previewRoot, 'preview_root', { allowEmpty: true });
  const retentionMs = Number(retentionDays) > 0 ? Number(retentionDays) * 24 * 60 * 60 * 1000 : 0;
  const openPrNumbers = await fetchOpenPullRequestNumbers({ token, repository });
  const entries = await listPreviewEntries(repo, previewRoot);

  // Resolve last-modified timestamps up front (async git log lookups) so the
  // pure classification function below stays synchronous and test-friendly.
  const lastModifiedByEntry = new Map();
  for (const entry of entries) {
    const relative = previewRoot ? path.posix.join(previewRoot, entry) : entry;
    lastModifiedByEntry.set(entry, await lastModifiedMsForPath(repo, relative));
  }

  const { keep, remove, ignored } = classifyPreviewEntries({
    entries,
    openPrNumbers,
    retentionMs,
    now: Date.now(),
    getLastModifiedMs: entry => lastModifiedByEntry.get(entry) ?? null
  });

  if (remove.length === 0) {
    return { removed: [], keep, ignored, changed: false };
  }

  const result = await withSerializedBranchWrite({
    repo,
    branch,
    commitMessage: `Prune ${remove.length} stale Storybook preview director${remove.length === 1 ? 'y' : 'ies'}`,
    mutate: async repoPath => {
      let mutated = false;
      for (const { entry } of remove) {
        const full = previewRoot ? path.join(repoPath, previewRoot, entry) : path.join(repoPath, entry);
        await fs.rm(full, { recursive: true, force: true });
        mutated = true;
      }
      return mutated;
    }
  });

  return { removed: remove, keep, ignored, changed: result.changed };
}

if (process.argv[1] && process.argv[1].endsWith('preview-janitor.js')) {
  const config = resolveConfiguration({
    inputs: {
      preview_root: process.env.PREVIEW_ROOT,
      pages_branch: process.env.PAGES_BRANCH,
      preview_retention_days: process.env.PREVIEW_RETENTION_DAYS
    }
  });

  runJanitor({
    repo: process.env.PAGES_REPO || process.cwd(),
    branch: config.pages_branch || process.env.PAGES_BRANCH || 'gh-pages',
    previewRoot: config.preview_root,
    retentionDays: config.preview_retention_days,
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY
  }).then(async result => {
    console.log(JSON.stringify({
      removed: result.removed.map(item => item.entry),
      kept: result.keep,
      ignored: result.ignored
    }, null, 2));
    if (result.changed) {
      await requestPagesRebuild({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY });
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summary = result.removed.length > 0
        ? `### Storybook preview janitor\n\nRemoved ${result.removed.length} stale preview director${result.removed.length === 1 ? 'y' : 'ies'}: ${result.removed.map(item => `\`${item.entry}\` (${item.reason})`).join(', ')}\n`
        : '### Storybook preview janitor\n\nNo stale preview directories found.\n';
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    }
  }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
