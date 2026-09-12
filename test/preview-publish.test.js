import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBundleMetadata, publishPreview } from '../src/preview-publish.js';
import { buildPreviewMetadata, digestDirectory } from '../src/preview-metadata.js';
import { buildMarker } from '../src/preview-comment.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function initBarePagesRepo() {
  const bareDir = makeTempDir('storybook-pages-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');

  const seedDir = makeTempDir('storybook-pages-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  fs.writeFileSync(path.join(seedDir, 'index.html'), '<html>root</html>');
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');

  const cloneDir = makeTempDir('storybook-pages-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'config', 'user.email', 'clone@example.com');
  git(cloneDir, 'config', 'user.name', 'clone');
  git(cloneDir, 'checkout', '-q', 'gh-pages');
  return cloneDir;
}

function makeBundle({ isForkOverride, headSha = SHA_A, target } = {}) {
  const bundleDir = makeTempDir('storybook-preview-bundle-');
  const metadata = buildPreviewMetadata({
    repository: 'octo/widgets',
    runId: 55,
    runAttempt: 1,
    prNumber: 42,
    baseRef: 'main',
    headRepository: isForkOverride ? 'fork/widgets' : 'octo/widgets',
    headSha,
    artifactName: 'storybook-preview-pr-42-run-55',
    contentDigest: '0'.repeat(64),
    previewRoot: 'pr-preview'
  });
  if (target !== undefined) metadata.target = target;
  const contentDir = path.join(bundleDir, 'storybook');
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'index.html'), '<html>preview</html>');
  metadata.contentDigest = digestDirectory(contentDir);
  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), JSON.stringify(metadata, null, 2));
  return { bundleDir, metadata };
}

function trustedContextFor(metadata) {
  return {
    repository: metadata.repository,
    runId: metadata.runId,
    prNumber: metadata.prNumber,
    headSha: metadata.headSha,
    headRepository: metadata.headRepository,
    baseRef: metadata.baseRef,
    artifactName: metadata.artifactName
  };
}

test('readBundleMetadata throws a clear error when the metadata file is missing', () => {
  const bundleDir = makeTempDir('storybook-preview-empty-');
  assert.throws(() => readBundleMetadata(bundleDir), /missing preview-metadata\.json/);
});

test('publishPreview skips fork pull requests without touching the Pages branch', async () => {
  const { bundleDir, metadata } = makeBundle({ isForkOverride: true });
  const pagesRepo = initBarePagesRepo();
  const beforeHead = git(pagesRepo, 'rev-parse', 'HEAD');

  const result = await publishPreview({
    bundleDir,
    pagesRepo,
    trustedContext: trustedContextFor(metadata),
    currentHeadSha: SHA_A
  });

  assert.equal(result.action, 'skip-fork');
  assert.equal(git(pagesRepo, 'rev-parse', 'HEAD'), beforeHead, 'fork skip must not create any commit');
});

test('publishPreview skips a stale run when the live PR head has moved on', async () => {
  const { bundleDir, metadata } = makeBundle({ headSha: SHA_A });
  const pagesRepo = initBarePagesRepo();
  const beforeHead = git(pagesRepo, 'rev-parse', 'HEAD');

  const result = await publishPreview({
    bundleDir,
    pagesRepo,
    trustedContext: trustedContextFor(metadata),
    currentHeadSha: SHA_B
  });

  assert.equal(result.action, 'skip-stale');
  assert.equal(git(pagesRepo, 'rev-parse', 'HEAD'), beforeHead, 'stale skip must not create any commit');
});

test('publishPreview rejects a provenance mismatch or malicious metadata target', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  await assert.rejects(publishPreview({
    bundleDir,
    pagesRepo,
    trustedContext: { ...trustedContextFor(metadata), repository: 'someone-else/widgets' },
    currentHeadSha: SHA_A
  }), /does not match trusted workflow_run context/);

  // Test malicious metadata target attempting root/production overwrite
  const malicious = makeBundle({ target: 'production-root-overwrite' });
  await assert.rejects(publishPreview({
    bundleDir: malicious.bundleDir,
    pagesRepo,
    trustedContext: { ...trustedContextFor(malicious.metadata), previewRoot: 'pr-preview' },
    currentHeadSha: SHA_A
  }), /does not match trusted workflow_run context for field\(s\): target/);
});

test('publishPreview publishes a same-repo, current-head preview and posts an idempotent comment', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/comments') && (!options || options.method === undefined || options.method === 'GET')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('/comments') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    }
    if (url.includes('/pages/builds')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext: trustedContextFor(metadata),
      currentHeadSha: SHA_A,
      token: 'tok',
      repository: 'octo/widgets',
      siteUrl: 'https://octo.github.io/widgets'
    });

    assert.equal(result.action, 'published');
    assert.equal(result.commentError, null);
    assert.equal(result.commentResult.action, 'created');
    assert.ok(fs.existsSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'index.html')));

    const commentPost = requests.find(r => r.options && r.options.method === 'POST' && r.url.includes('/comments'));
    assert.ok(commentPost.options.body.includes(buildMarker(42)), 'comment body must include the stable bot marker');
  } finally {
    global.fetch = originalFetch;
  }
});

test('publishPreview surfaces a comment failure independently without treating the publish as failed', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (url.includes('/comments')) {
      return { ok: false, status: 403, text: async () => 'forbidden' };
    }
    if (url.includes('/pages/builds')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext: trustedContextFor(metadata),
      currentHeadSha: SHA_A,
      token: 'tok',
      repository: 'octo/widgets',
      siteUrl: 'https://octo.github.io/widgets'
    });

    assert.equal(result.action, 'published', 'publish must succeed even though the comment step failed');
    assert.ok(fs.existsSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'index.html')));
    assert.match(result.commentError, /403/);
  } finally {
    global.fetch = originalFetch;
  }
});
