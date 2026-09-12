import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePreviewTarget } from './preview-metadata.js';
import { withSerializedBranchWrite, requestPagesRebuild } from './git-branch-writer.js';

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes exactly one PR's preview directory from a checked-out Pages
 * branch. This is metadata-only: the caller supplies nothing but a PR
 * number and the (already validated) preview root, never any PR-controlled
 * file content. A missing directory is treated as a successful no-op so
 * cleanup remains idempotent across retries and duplicate close events.
 */
export async function removePreviewDirectory({ repo, branch = 'gh-pages', previewRoot = 'pr-preview', prNumber }) {
  const target = resolvePreviewTarget({ previewRoot, prNumber });
  const result = await withSerializedBranchWrite({
    repo,
    branch,
    commitMessage: `Remove Storybook preview for closed PR #${Number(prNumber)}`,
    mutate: async repoPath => {
      const full = path.join(repoPath, target);
      if (!(await pathExists(full))) return false;
      await fs.rm(full, { recursive: true, force: true });
      return true;
    }
  });
  return { target, ...result };
}

if (process.argv[1] && process.argv[1].endsWith('preview-cleanup.js')) {
  removePreviewDirectory({
    repo: process.env.PAGES_REPO || process.cwd(),
    branch: process.env.PAGES_BRANCH || 'gh-pages',
    previewRoot: process.env.PREVIEW_ROOT || 'pr-preview',
    prNumber: process.env.PR_NUMBER
  }).then(async result => {
    console.log(JSON.stringify(result));
    if (result.changed && process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
      await requestPagesRebuild({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY });
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const message = result.changed
        ? `### Storybook preview cleanup\n\nRemoved \`${result.target}\` for the closed pull request.\n`
        : `### Storybook preview cleanup\n\nNo preview directory existed at \`${result.target}\`; nothing to remove.\n`;
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, message);
    }
  }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
