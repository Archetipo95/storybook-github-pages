import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  PORTAL_MARKER,
  RESOLVE_404_SOURCE,
  classifyEnvironment,
  collectEnvironments,
  defaultPortalTitle,
  fetchOpenPullRequests,
  findStorybookDirectories,
  render404Html,
  renderPortalHtml,
  resolveSiteRoot,
  resolveStatus,
  writePortal
} from '../src/generate-portal.js';
import { runJanitor } from '../src/preview-janitor.js';
import { removePreviewDirectory } from '../src/preview-cleanup.js';
import { publishDirectory } from '../src/publish-directory.js';
import { resolveConfiguration } from '../src/config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

function writeStorybook(root, relative, label = relative) {
  const dir = path.join(root, relative);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<html>${label}</html>`);
  fs.writeFileSync(path.join(dir, 'iframe.html'), `<html>${label} iframe</html>`);
}

function initPagesRepo(seed) {
  const bareDir = makeTempDir('storybook-portal-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');
  const seedDir = makeTempDir('storybook-portal-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  seed(seedDir);
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');
  const cloneDir = makeTempDir('storybook-portal-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'checkout', '-q', 'gh-pages');
  return cloneDir;
}

function mockPulls(pulls) {
  const original = global.fetch;
  global.fetch = async url => {
    if (url.includes('/pulls?state=open')) return { ok: true, status: 200, json: async () => pulls };
    if (url.includes('/pages/builds')) return { ok: true, status: 200, json: async () => [] };
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return () => {
    global.fetch = original;
  };
}

const resolveNotFound = new Function(`${RESOLVE_404_SOURCE}; return resolveNotFound;`)();

test('classifyEnvironment recognizes main, previews, versions, and named environments', () => {
  assert.deepEqual(classifyEnvironment(''), { kind: 'main', name: 'main', prNumber: null });
  assert.deepEqual(classifyEnvironment('pr-preview/pr-12'), { kind: 'preview', name: 'pr-12', prNumber: 12 });
  assert.deepEqual(classifyEnvironment('pr-3'), { kind: 'preview', name: 'pr-3', prNumber: 3 });
  assert.equal(classifyEnvironment('v1.2.0').kind, 'version');
  assert.equal(classifyEnvironment('versions/v2').kind, 'version');
  assert.equal(classifyEnvironment('main').kind, 'main');
  assert.equal(classifyEnvironment('staging').kind, 'environment');
  assert.equal(classifyEnvironment('vendor').kind, 'environment');
});

test('resolveStatus flags previews inside the janitor warning window as Expiring Soon', () => {
  const now = Date.now();
  assert.equal(resolveStatus({ kind: 'main', now }), 'Main');
  assert.equal(resolveStatus({ kind: 'version', now }), 'Release');
  assert.equal(resolveStatus({ kind: 'environment', now }), 'Active');
  assert.equal(resolveStatus({ kind: 'preview', lastUpdatedMs: now - DAY_MS, now }), 'Active');
  assert.equal(resolveStatus({ kind: 'preview', lastUpdatedMs: now - 28 * DAY_MS, now }), 'Expiring Soon');
  assert.equal(resolveStatus({ kind: 'preview', lastUpdatedMs: now - 28 * DAY_MS, now, retentionDays: 0 }), 'Active');
  assert.equal(resolveStatus({ kind: 'preview', lastUpdatedMs: now - 28 * DAY_MS, now, warningDays: 0 }), 'Active');
});

test('resolveSiteRoot derives the absolute site root for project pages, user pages, and custom domains', () => {
  assert.equal(resolveSiteRoot({ repository: 'octo/widgets' }), '/widgets/');
  assert.equal(resolveSiteRoot({ repository: 'octo/octo.github.io' }), '/');
  assert.equal(resolveSiteRoot({ repository: 'octo/widgets', siteUrl: 'https://docs.example.com' }), '/');
  assert.equal(resolveSiteRoot({ siteUrl: 'https://docs.example.com/ui/' }), '/ui/');
  assert.equal(resolveSiteRoot({}), '/');
  assert.throws(() => resolveSiteRoot({ siteUrl: 'not a url' }), /site_url must be a valid URL/);
  assert.equal(defaultPortalTitle('octo/widgets'), 'widgets Storybook Environments');
});

test('rendered portal and 404 escape PR-controlled titles and authors', () => {
  const environments = [
    {
      path: 'pr-preview/pr-7',
      name: 'pr-7',
      kind: 'preview',
      prNumber: 7,
      title: '</script><img src=x onerror=alert(1)>',
      author: '"><b>me</b>',
      pullRequestUrl: 'https://github.com/octo/widgets/pull/7',
      lastUpdated: '2026-01-01T00:00:00.000Z',
      status: 'Active'
    }
  ];
  const portal = renderPortalHtml({ title: 'Envs <x>', environments });
  assert.ok(portal.includes(PORTAL_MARKER));
  assert.ok(!portal.includes('<img src=x'));
  assert.ok(!portal.includes('<b>me</b>'));
  assert.ok(portal.includes('Envs &lt;x&gt;'));
  assert.ok(portal.includes('href="pr-preview/pr-7/"'));

  const notFound = render404Html({ title: 'Envs', environments, siteRoot: '/widgets/' });
  assert.ok(!notFound.includes('</script><img'), 'embedded JSON must not be able to close the script tag');
  assert.ok(notFound.includes('"/widgets/"'));
});

test('404 resolver redirects shortcuts, points at the owning environment, and never loops', () => {
  const environments = [
    { path: '', name: 'main', title: 'Main' },
    { path: 'staging', name: 'staging', title: 'staging' },
    { path: 'pr-preview/pr-12', name: 'pr-12', title: 'PR #12' }
  ];
  assert.deepEqual(resolveNotFound('pr-12/', environments), {
    type: 'redirect',
    environment: environments[2],
    target: 'pr-preview/pr-12/'
  });
  assert.equal(resolveNotFound('pr-12/iframe.html', environments).target, 'pr-preview/pr-12/iframe.html');
  // After the redirect the path is inside the environment, so it only links.
  assert.equal(resolveNotFound('pr-preview/pr-12/missing.js', environments).type, 'inside');
  assert.equal(resolveNotFound('staging/old', environments).environment.path, 'staging');
  assert.equal(resolveNotFound('pr-99/', environments).type, 'none');
  assert.equal(resolveNotFound('', environments).type, 'none');
});

test('findStorybookDirectories only catalogs Storybook builds and skips assets, hidden, and portal directories', async () => {
  const repo = makeTempDir('storybook-portal-scan-');
  writeStorybook(repo, '');
  writeStorybook(repo, 'staging');
  writeStorybook(repo, 'pr-preview/pr-1');
  writeStorybook(repo, 'pr-preview/pr-2');
  writeStorybook(repo, 'staging/nested-should-not-be-scanned');
  fs.mkdirSync(path.join(repo, 'badges'));
  fs.writeFileSync(path.join(repo, 'badges', 'index.html'), 'not a storybook');
  writeStorybook(repo, '.hidden');
  writeStorybook(repo, 'portal');
  assert.deepEqual(await findStorybookDirectories(repo), ['', 'pr-preview/pr-1', 'pr-preview/pr-2', 'staging']);
});

test('collectEnvironments sorts main first, previews newest first, and attaches PR metadata', async () => {
  const repo = makeTempDir('storybook-portal-collect-');
  writeStorybook(repo, 'pr-preview/pr-1');
  writeStorybook(repo, 'pr-preview/pr-10');
  writeStorybook(repo, 'v1.0.0');
  writeStorybook(repo, 'main');
  const pullRequests = new Map([[10, { title: 'Add button', author: 'octocat', url: 'https://x/pull/10' }]]);
  const environments = await collectEnvironments(repo, { pullRequests });
  assert.deepEqual(
    environments.map(env => env.path),
    ['main', 'v1.0.0', 'pr-preview/pr-10', 'pr-preview/pr-1']
  );
  assert.equal(environments[2].title, 'Add button');
  assert.equal(environments[2].author, 'octocat');
  assert.equal(environments[3].title, 'PR #1');
});

test('fetchOpenPullRequests degrades to an empty map on API failure or missing credentials', async () => {
  assert.equal((await fetchOpenPullRequests({})).size, 0);
  const failing = await fetchOpenPullRequests({
    token: 't',
    repository: 'octo/widgets',
    fetchImpl: async () => ({ ok: false, status: 500 })
  });
  assert.equal(failing.size, 0);
  const throwing = await fetchOpenPullRequests({
    token: 't',
    repository: 'octo/widgets',
    fetchImpl: async () => {
      throw new Error('offline');
    }
  });
  assert.equal(throwing.size, 0);
});

test('writePortal claims a free root and writes index.html, 404.html, and a manifest', async () => {
  const repo = makeTempDir('storybook-portal-root-');
  writeStorybook(repo, 'pr-preview/pr-4');
  const result = await writePortal(repo, { repository: 'octo/widgets' });
  assert.equal(result.portalPath, '');
  assert.deepEqual(result.written, ['index.html', 'environments.json', '404.html']);
  const index = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  assert.ok(index.includes('widgets Storybook Environments'));
  assert.ok(index.includes('href="pr-preview/pr-4/"'));
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'environments.json'), 'utf8'));
  assert.equal(manifest.environments[0].path, 'pr-preview/pr-4');
  assert.ok(fs.readFileSync(path.join(repo, '404.html'), 'utf8').includes('"/widgets/"'));
});

test('writePortal never replaces a root Storybook or a user-provided 404.html', async () => {
  const repo = makeTempDir('storybook-portal-reserved-');
  writeStorybook(repo, '', 'production');
  writeStorybook(repo, 'pr-preview/pr-4');
  fs.writeFileSync(path.join(repo, '404.html'), 'custom 404');
  const result = await writePortal(repo, { title: 'My envs', repository: 'octo/widgets' });
  assert.equal(result.portalPath, 'portal');
  assert.equal(fs.readFileSync(path.join(repo, 'index.html'), 'utf8'), '<html>production</html>');
  assert.equal(fs.readFileSync(path.join(repo, '404.html'), 'utf8'), 'custom 404');
  const portal = fs.readFileSync(path.join(repo, 'portal', 'index.html'), 'utf8');
  assert.ok(portal.includes('href="../pr-preview/pr-4/"'));
  assert.ok(portal.includes('href="../"'), 'root Storybook is listed as the main environment');
});

test('writePortal moves back to the root once the root Storybook is gone', async () => {
  const repo = makeTempDir('storybook-portal-reclaim-');
  writeStorybook(repo, '', 'production');
  writeStorybook(repo, 'staging');
  await writePortal(repo, { repository: 'octo/widgets' });
  assert.ok(fs.existsSync(path.join(repo, 'portal', 'index.html')));
  for (const file of ['index.html', 'iframe.html']) fs.rmSync(path.join(repo, file));
  const result = await writePortal(repo, { repository: 'octo/widgets' });
  assert.equal(result.portalPath, '');
  assert.ok(!fs.existsSync(path.join(repo, 'portal')));
  assert.ok(fs.readFileSync(path.join(repo, 'index.html'), 'utf8').includes(PORTAL_MARKER));
});

test('runJanitor regenerates the portal after pruning and a repeated sweep commits nothing', async () => {
  const cloneDir = initPagesRepo(seed => {
    writeStorybook(seed, 'pr-preview/pr-1');
    writeStorybook(seed, 'pr-preview/pr-2');
  });
  const restore = mockPulls([{ number: 1, title: 'Keep me', user: { login: 'octocat' } }]);
  try {
    const portal = { enabled: true, title: 'Envs' };
    const first = await runJanitor({
      repo: cloneDir,
      retentionDays: 0,
      portal,
      token: 't',
      repository: 'octo/widgets'
    });
    assert.equal(first.changed, true);
    const index = fs.readFileSync(path.join(cloneDir, 'index.html'), 'utf8');
    assert.ok(index.includes('Keep me'));
    assert.ok(!index.includes('pr-preview/pr-2/'));
    const head = git(cloneDir, 'rev-parse', 'HEAD');

    const second = await runJanitor({
      repo: cloneDir,
      retentionDays: 0,
      portal,
      token: 't',
      repository: 'octo/widgets'
    });
    assert.equal(second.changed, false);
    assert.equal(git(cloneDir, 'rev-parse', 'HEAD'), head);
  } finally {
    restore();
  }
});

test('removePreviewDirectory drops the closed preview from the portal', async () => {
  const cloneDir = initPagesRepo(seed => {
    writeStorybook(seed, 'pr-preview/pr-1');
    writeStorybook(seed, 'pr-preview/pr-2');
  });
  const restore = mockPulls([]);
  try {
    const result = await removePreviewDirectory({
      repo: cloneDir,
      prNumber: 2,
      portal: { enabled: true },
      token: 't',
      repository: 'octo/widgets'
    });
    assert.equal(result.changed, true);
    const manifest = JSON.parse(fs.readFileSync(path.join(cloneDir, 'environments.json'), 'utf8'));
    assert.deepEqual(
      manifest.environments.map(env => env.path),
      ['pr-preview/pr-1']
    );
  } finally {
    restore();
  }
});

test('publishDirectory includes the newly published directory in the portal', async () => {
  const cloneDir = initPagesRepo(seed => writeStorybook(seed, 'staging'));
  const source = makeTempDir('storybook-portal-source-');
  writeStorybook(source, '');
  const restore = mockPulls([{ number: 5, title: 'New feature', user: { login: 'octocat' } }]);
  try {
    await publishDirectory({
      repo: cloneDir,
      source,
      targetDirectory: 'pr-preview/pr-5',
      portal: { enabled: true },
      token: 't',
      repository: 'octo/widgets'
    });
    const index = fs.readFileSync(path.join(cloneDir, 'index.html'), 'utf8');
    assert.ok(index.includes('New feature'));
    assert.ok(index.includes('href="staging/"'));
    assert.match(git(cloneDir, 'show', '--stat', 'HEAD'), /404\.html/);
  } finally {
    restore();
  }
});

test('resolveConfiguration exposes generate_portal and portal_title with safe defaults', () => {
  const defaults = resolveConfiguration({ configFilePath: '/nonexistent/.storybook-pages.yml' });
  assert.equal(defaults.generate_portal, false);
  assert.equal(defaults.portal_title, '');
  const enabled = resolveConfiguration({
    configFilePath: '/nonexistent/.storybook-pages.yml',
    inputs: { generate_portal: 'true', portal_title: 'Team envs' }
  });
  assert.equal(enabled.generate_portal, true);
  assert.equal(enabled.portal_title, 'Team envs');
});
