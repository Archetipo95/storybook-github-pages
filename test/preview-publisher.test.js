import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildPreviewMetadata, digestDirectory } from '../src/preview-metadata.js';
import { buildMarker } from '../src/preview-comment.js';
import { parseSimpleYaml } from '../src/config.js';

const SHA_VALID = 'c'.repeat(40);
const SHA_STALE = 'd'.repeat(40);

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function initBarePagesRepo() {
  const bareDir = makeTempDir('consumer-pages-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');

  const seedDir = makeTempDir('consumer-pages-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  fs.writeFileSync(path.join(seedDir, 'index.html'), '<html>root production</html>');
  fs.writeFileSync(path.join(seedDir, 'robots.txt'), 'User-agent: *\nDisallow:');
  const stagingDir = path.join(seedDir, 'staging');
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(path.join(stagingDir, 'index.html'), '<html>staging env</html>');
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');

  const cloneDir = makeTempDir('consumer-pages-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'config', 'user.email', 'clone@example.com');
  git(cloneDir, 'config', 'user.name', 'clone');
  git(cloneDir, 'checkout', '-q', 'gh-pages');
  return { bareDir, cloneDir };
}

function makeBundle({
  repo = 'acme/design-system',
  runId = 7788,
  prNumber = 50,
  headSha = SHA_VALID,
  headRepo = 'acme/design-system',
  previewRoot = 'pr-preview',
  target
} = {}) {
  const bundleDir = makeTempDir('consumer-bundle-');
  const metadata = buildPreviewMetadata({
    repository: repo,
    runId,
    runAttempt: 1,
    prNumber,
    baseRef: 'main',
    headRepository: headRepo,
    headSha,
    artifactName: `storybook-preview-pr-${prNumber}-run-${runId}`,
    contentDigest: '0'.repeat(64),
    previewRoot
  });
  if (target !== undefined) metadata.target = target;
  const contentDir = path.join(bundleDir, 'storybook');
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'index.html'), `<html>preview for PR ${prNumber}</html>`);
  fs.writeFileSync(path.join(contentDir, 'iframe.html'), '<html>stories iframe</html>');
  metadata.contentDigest = digestDirectory(contentDir);
  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), JSON.stringify(metadata, null, 2));
  return { bundleDir, metadata };
}

test('preview-publisher action.yml schema, inputs, and outputs are well-formed', () => {
  const actionPath = path.join(process.cwd(), 'preview-publisher/action.yml');
  assert.ok(fs.existsSync(actionPath), 'preview-publisher/action.yml must exist');
  const content = fs.readFileSync(actionPath, 'utf8');

  assert.match(content, /name:\s*['"]?Trusted Storybook preview publisher['"]?/);
  assert.match(content, /using:\s*['"]?composite['"]?/);

  // Required and optional inputs
  assert.match(content, /bundle_dir:\s*\n\s*description:.*\n\s*required:\s*true/);
  assert.match(content, /pages_repo:\s*\n\s*description:.*\n\s*required:\s*true/);
  assert.match(content, /pages_branch:/);
  assert.match(content, /preview_root:/);
  assert.match(content, /trusted_repository:/);
  assert.match(content, /trusted_run_id:/);
  assert.match(content, /trusted_pr_number:/);
  assert.match(content, /trusted_head_sha:/);
  assert.match(content, /trusted_head_repository:/);
  assert.match(content, /trusted_base_ref:/);
  assert.match(content, /expected_artifact_name:/);
  assert.match(content, /current_head_sha:/);

  // Outputs
  assert.match(content, /page_url:/);
  assert.match(content, /action:/);

  // Implementation wiring
  assert.match(content, /node "\$\{\{ github\.action_path \}\}\/\.\.\/src\/preview-publish\.js"/);
});

test('preview-publisher CLI invocation publishes preview, writes output, and preserves unrelated files', () => {
  const { bundleDir, metadata } = makeBundle({ prNumber: 50 });
  const { cloneDir: pagesRepo } = initBarePagesRepo();
  const tempDir = makeTempDir('cli-env-');
  const outputFilePath = path.join(tempDir, 'github_output');
  const summaryFilePath = path.join(tempDir, 'github_summary');
  fs.writeFileSync(outputFilePath, '');
  fs.writeFileSync(summaryFilePath, '');

  const scriptPath = path.join(process.cwd(), 'src/preview-publish.js');
  const env = {
    ...process.env,
    BUNDLE_DIR: bundleDir,
    PAGES_REPO: pagesRepo,
    PAGES_BRANCH: 'gh-pages',
    PREVIEW_ROOT: 'pr-preview',
    SITE_URL: 'https://acme.github.io/design-system',
    BASE_PATH: '',
    MANAGED_DIRECTORIES: '',
    TRUSTED_REPOSITORY: 'acme/design-system',
    TRUSTED_RUN_ID: String(metadata.runId),
    TRUSTED_PR_NUMBER: String(metadata.prNumber),
    TRUSTED_HEAD_SHA: metadata.headSha,
    TRUSTED_HEAD_REPOSITORY: metadata.headRepository,
    TRUSTED_BASE_REF: metadata.baseRef,
    EXPECTED_ARTIFACT_NAME: metadata.artifactName,
    CURRENT_HEAD_SHA: SHA_VALID,
    GITHUB_TOKEN: '', // Omitting token skips remote comment/rebuild gracefully
    GITHUB_REPOSITORY: 'acme/design-system',
    GITHUB_OUTPUT: outputFilePath,
    GITHUB_STEP_SUMMARY: summaryFilePath
  };

  const run = spawnSync('node', [scriptPath], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, `Process failed with stderr: ${run.stderr}`);

  // Verify published content
  const previewIndexPath = path.join(pagesRepo, 'pr-preview', 'pr-50', 'index.html');
  assert.ok(fs.existsSync(previewIndexPath), 'preview index.html must exist on gh-pages branch');
  assert.match(fs.readFileSync(previewIndexPath, 'utf8'), /preview for PR 50/);

  // Verify root files and named environments remain preserved
  assert.ok(fs.existsSync(path.join(pagesRepo, 'index.html')), 'root index.html must remain intact');
  assert.match(fs.readFileSync(path.join(pagesRepo, 'index.html'), 'utf8'), /root production/);
  assert.ok(fs.existsSync(path.join(pagesRepo, 'robots.txt')), 'root robots.txt must remain intact');
  assert.ok(fs.existsSync(path.join(pagesRepo, 'staging', 'index.html')), 'staging env must remain intact');

  // Verify $GITHUB_OUTPUT
  const outputContent = fs.readFileSync(outputFilePath, 'utf8');
  assert.match(outputContent, /action=published/);
  assert.match(outputContent, /page_url=https:\/\/acme\.github\.io\/design-system\/pr-preview\/pr-50/);

  // Verify $GITHUB_STEP_SUMMARY
  const summaryContent = fs.readFileSync(summaryFilePath, 'utf8');
  assert.match(summaryContent, /Published PR #50/);
});

test('preview-publisher CLI invocation handles fork skip and stale skip cleanly via GITHUB_OUTPUT', () => {
  const scriptPath = path.join(process.cwd(), 'src/preview-publish.js');
  const { cloneDir: pagesRepo } = initBarePagesRepo();

  // 1. Fork PR skip
  {
    const { bundleDir, metadata } = makeBundle({ prNumber: 51, headRepo: 'external-fork/design-system' });
    const tempDir = makeTempDir('fork-env-');
    const outputFilePath = path.join(tempDir, 'github_output');
    fs.writeFileSync(outputFilePath, '');

    const env = {
      ...process.env,
      BUNDLE_DIR: bundleDir,
      PAGES_REPO: pagesRepo,
      PAGES_BRANCH: 'gh-pages',
      PREVIEW_ROOT: 'pr-preview',
      TRUSTED_REPOSITORY: 'acme/design-system',
      TRUSTED_RUN_ID: String(metadata.runId),
      TRUSTED_PR_NUMBER: String(metadata.prNumber),
      TRUSTED_HEAD_SHA: metadata.headSha,
      TRUSTED_HEAD_REPOSITORY: metadata.headRepository,
      TRUSTED_BASE_REF: metadata.baseRef,
      EXPECTED_ARTIFACT_NAME: metadata.artifactName,
      CURRENT_HEAD_SHA: SHA_VALID,
      GITHUB_REPOSITORY: 'acme/design-system',
      GITHUB_OUTPUT: outputFilePath
    };

    const run = spawnSync('node', [scriptPath], { env, encoding: 'utf8' });
    assert.equal(run.status, 0);
    const outputContent = fs.readFileSync(outputFilePath, 'utf8');
    assert.match(outputContent, /action=skip-fork/);
  }

  // 2. Stale PR skip
  {
    const { bundleDir, metadata } = makeBundle({ prNumber: 52 });
    const tempDir = makeTempDir('stale-env-');
    const outputFilePath = path.join(tempDir, 'github_output');
    fs.writeFileSync(outputFilePath, '');

    const env = {
      ...process.env,
      BUNDLE_DIR: bundleDir,
      PAGES_REPO: pagesRepo,
      PAGES_BRANCH: 'gh-pages',
      PREVIEW_ROOT: 'pr-preview',
      TRUSTED_REPOSITORY: 'acme/design-system',
      TRUSTED_RUN_ID: String(metadata.runId),
      TRUSTED_PR_NUMBER: String(metadata.prNumber),
      TRUSTED_HEAD_SHA: metadata.headSha,
      TRUSTED_HEAD_REPOSITORY: metadata.headRepository,
      TRUSTED_BASE_REF: metadata.baseRef,
      EXPECTED_ARTIFACT_NAME: metadata.artifactName,
      CURRENT_HEAD_SHA: SHA_STALE, // PR head moved to another commit
      GITHUB_REPOSITORY: 'acme/design-system',
      GITHUB_OUTPUT: outputFilePath
    };

    const run = spawnSync('node', [scriptPath], { env, encoding: 'utf8' });
    assert.equal(run.status, 0);
    const outputContent = fs.readFileSync(outputFilePath, 'utf8');
    assert.match(outputContent, /action=skip-stale/);
  }
});

test('preview-publisher CLI invocation rejects tampering and exits with non-zero status', () => {
  const scriptPath = path.join(process.cwd(), 'src/preview-publish.js');
  const { cloneDir: pagesRepo } = initBarePagesRepo();
  const { bundleDir, metadata } = makeBundle({ prNumber: 53 });

  // Tamper with bundle content without updating contentDigest
  fs.writeFileSync(path.join(bundleDir, 'storybook', 'index.html'), '<html>tampered content</html>');

  const env = {
    ...process.env,
    BUNDLE_DIR: bundleDir,
    PAGES_REPO: pagesRepo,
    PAGES_BRANCH: 'gh-pages',
    PREVIEW_ROOT: 'pr-preview',
    TRUSTED_REPOSITORY: 'acme/design-system',
    TRUSTED_RUN_ID: String(metadata.runId),
    TRUSTED_PR_NUMBER: String(metadata.prNumber),
    TRUSTED_HEAD_SHA: metadata.headSha,
    TRUSTED_HEAD_REPOSITORY: metadata.headRepository,
    TRUSTED_BASE_REF: metadata.baseRef,
    EXPECTED_ARTIFACT_NAME: metadata.artifactName,
    CURRENT_HEAD_SHA: SHA_VALID,
    GITHUB_REPOSITORY: 'acme/design-system'
  };

  const run = spawnSync('node', [scriptPath], { env, encoding: 'utf8' });
  assert.notEqual(run.status, 0, 'Tampered content must cause non-zero exit code');
  assert.match(run.stderr, /Preview content digest mismatch/);
});

test('preview-publisher supports repository-root layout preview_root: ""', () => {
  const { bundleDir, metadata } = makeBundle({ prNumber: 54, previewRoot: '' });
  const { cloneDir: pagesRepo } = initBarePagesRepo();
  const tempDir = makeTempDir('root-layout-');
  const outputFilePath = path.join(tempDir, 'github_output');
  fs.writeFileSync(outputFilePath, '');

  const scriptPath = path.join(process.cwd(), 'src/preview-publish.js');
  const env = {
    ...process.env,
    BUNDLE_DIR: bundleDir,
    PAGES_REPO: pagesRepo,
    PAGES_BRANCH: 'gh-pages',
    PREVIEW_ROOT: '',
    SITE_URL: 'https://acme.github.io/design-system',
    BASE_PATH: '',
    MANAGED_DIRECTORIES: '',
    TRUSTED_REPOSITORY: 'acme/design-system',
    TRUSTED_RUN_ID: String(metadata.runId),
    TRUSTED_PR_NUMBER: String(metadata.prNumber),
    TRUSTED_HEAD_SHA: metadata.headSha,
    TRUSTED_HEAD_REPOSITORY: metadata.headRepository,
    TRUSTED_BASE_REF: metadata.baseRef,
    EXPECTED_ARTIFACT_NAME: metadata.artifactName,
    CURRENT_HEAD_SHA: SHA_VALID,
    GITHUB_REPOSITORY: 'acme/design-system',
    GITHUB_OUTPUT: outputFilePath
  };

  const run = spawnSync('node', [scriptPath], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, `Process failed: ${run.stderr}`);

  // Preview published at pr-54 directly under root
  assert.ok(fs.existsSync(path.join(pagesRepo, 'pr-54', 'index.html')), 'preview must be published at root pr-54/index.html');
  assert.ok(fs.existsSync(path.join(pagesRepo, 'index.html')), 'root index.html must remain intact');
  assert.match(fs.readFileSync(path.join(pagesRepo, 'index.html'), 'utf8'), /root production/);

  const outputContent = fs.readFileSync(outputFilePath, 'utf8');
  assert.match(outputContent, /page_url=https:\/\/acme\.github\.io\/design-system\/pr-54/);
});
