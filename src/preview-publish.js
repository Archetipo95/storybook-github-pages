import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { decidePreviewAction, digestDirectory, PREVIEW_METADATA_FILENAME, PREVIEW_CONTENT_DIRNAME } from './preview-metadata.js';
import { validateArtifactDirectory } from './validate-artifact.js';
import { publishDirectory } from './publish-directory.js';
import { buildCommentBody, upsertPreviewComment } from './preview-comment.js';

/**
 * Reads and parses the metadata file bundled inside the downloaded build
 * artifact. Throws with a clear message if it is missing or malformed -
 * this is the first line of defense against a build artifact that does not
 * conform to the expected schema.
 */
export function readBundleMetadata(bundleDir) {
  const metadataPath = path.join(bundleDir, PREVIEW_METADATA_FILENAME);
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Preview bundle is missing ${PREVIEW_METADATA_FILENAME} at "${metadataPath}"`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    throw new Error(`Preview bundle metadata at "${metadataPath}" is not valid JSON: ${error.message}`);
  }
  return parsed;
}

/**
 * End-to-end trusted publish: validates the bundle metadata against the
 * trusted workflow_run context and the live PR head SHA, validates the
 * bundled static content, and only then publishes and comments. Every
 * rejection path (fork, stale run, provenance mismatch) is returned/thrown
 * before any write-capable operation runs.
 */
export async function publishPreview({
  bundleDir,
  pagesRepo,
  trustedContext,
  currentHeadSha,
  pagesBranch = 'gh-pages',
  managedDirectories = [],
  siteUrl = '',
  basePath = '',
  token,
  repository
}) {
  const metadata = readBundleMetadata(bundleDir);
  const decision = decidePreviewAction({ metadata, trustedContext, currentHeadSha });

  if (decision.action !== 'publish') {
    return { ...decision, metadata };
  }

  const contentDir = path.join(bundleDir, PREVIEW_CONTENT_DIRNAME);
  validateArtifactDirectory(PREVIEW_CONTENT_DIRNAME, bundleDir);
  const contentDigest = digestDirectory(contentDir);
  if (contentDigest !== metadata.contentDigest) {
    throw new Error(`Preview content digest mismatch: expected ${metadata.contentDigest}, got ${contentDigest}`);
  }

  const publishResult = await publishDirectory({
    repo: pagesRepo,
    source: contentDir,
    branch: pagesBranch,
    targetDirectory: metadata.target,
    managedDirectories,
    siteUrl,
    basePath,
    token,
    repository
  });

  let commentResult = null;
  let commentError = null;
  try {
    const body = buildCommentBody({
      prNumber: metadata.prNumber,
      previewUrl: publishResult.url,
      headSha: metadata.headSha,
      runId: metadata.runId,
      repository: metadata.repository
    });
    commentResult = await upsertPreviewComment({ token, repository, prNumber: metadata.prNumber, body });
  } catch (error) {
    // The publish already succeeded and must not be rolled back; a comment
    // failure is surfaced independently so it is visible without masking a
    // successful publication as a failure of the deployment itself.
    commentError = error.message;
  }

  return { action: 'published', reason: decision.reason, metadata, publishResult, commentResult, commentError };
}

if (process.argv[1] && process.argv[1].endsWith('preview-publish.js')) {
  const trustedContext = {
    repository: process.env.TRUSTED_REPOSITORY,
    runId: process.env.TRUSTED_RUN_ID ? Number(process.env.TRUSTED_RUN_ID) : undefined,
    prNumber: process.env.TRUSTED_PR_NUMBER ? Number(process.env.TRUSTED_PR_NUMBER) : undefined,
    headSha: process.env.TRUSTED_HEAD_SHA,
    headRepository: process.env.TRUSTED_HEAD_REPOSITORY,
    baseRef: process.env.TRUSTED_BASE_REF,
    artifactName: process.env.EXPECTED_ARTIFACT_NAME,
    previewRoot: process.env.PREVIEW_ROOT !== undefined ? process.env.PREVIEW_ROOT : 'pr-preview'
  };

  publishPreview({
    bundleDir: process.env.BUNDLE_DIR,
    pagesRepo: process.env.PAGES_REPO,
    trustedContext,
    currentHeadSha: process.env.CURRENT_HEAD_SHA,
    pagesBranch: process.env.PAGES_BRANCH || 'gh-pages',
    managedDirectories: process.env.MANAGED_DIRECTORIES ? process.env.MANAGED_DIRECTORIES.split(',').map(v => v.trim()).filter(Boolean) : [],
    siteUrl: process.env.SITE_URL || '',
    basePath: process.env.BASE_PATH || '',
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY
  }).then(async result => {
    console.log(JSON.stringify({ action: result.action, reason: result.reason }, null, 2));
    if (result.action !== 'published') {
      if (process.env.GITHUB_STEP_SUMMARY) {
        await fsp.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Storybook preview\n\n${result.reason}\n`);
      }
      return;
    }
    if (result.commentError) {
      console.error(`Preview published to ${result.publishResult.url}, but the PR comment failed: ${result.commentError}`);
    }
    if (process.env.GITHUB_OUTPUT) {
      await fsp.appendFile(process.env.GITHUB_OUTPUT, `page_url=${result.publishResult.url}\naction=${result.action}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      await fsp.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Storybook preview\n\nPublished PR #${result.metadata.prNumber} to ${result.publishResult.url}\n`);
    }
    if (result.commentError) {
      // Publishing succeeded; only the comment step is reported as failed so
      // this failure never appears to have skipped or reverted the publish.
      process.exit(1);
    }
  }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
