import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Regression test for #35: `.github/workflows/pr-preview-publish.yml` pinned
// `preview-publisher` to a commit SHA that predates the `preview-publisher`
// action's existence in this repository, so GitHub Actions failed to
// resolve it ("Can't find action.yml") before any provenance gates ran.
//
// This test statically resolves every internal self-reference of the form
// `Archetipo95/storybook-github-pages/<subaction>@<full-sha>` found in the
// workflows/docs of this repository and inspects the *actual git object* at
// that pinned commit (via `git show <sha>:<path>`) to make sure the
// referenced action definition really exists there. This catches a stale or
// otherwise invalid internal pin without needing network access or GitHub's
// action resolution step.

const repoRoot = process.cwd();

// Historical SHAs can only be inspected if the local clone has that commit
// object (a shallow clone, e.g. `actions/checkout` without `fetch-depth: 0`,
// would not). Best-effort deepen the clone so the checks below are
// meaningful instead of silently no-op-ing; ignore failures (e.g. no
// network, already complete) since gitCommitExists() still guards each ref.
try {
  const isShallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .toString()
    .trim();
  if (isShallow === 'true') {
    execFileSync('git', ['fetch', '--unshallow'], { cwd: repoRoot, stdio: 'ignore' });
  }
} catch {
  // Not a git repo, offline, or already unshallowed — proceed with what we have.
}

function gitShowExists(sha, relPath) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}:${relPath}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function gitCommitExists(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', sha], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function findInternalActionRefs(content) {
  // Matches `Archetipo95/storybook-github-pages[/<subaction>]@<40-hex-sha>`
  // e.g. `Archetipo95/storybook-github-pages/preview-publisher@6fdc8e3...`
  const regex = /Archetipo95\/storybook-github-pages(\/[a-zA-Z0-9_-]+)?@([a-f0-9]{40})/g;
  const refs = [];
  for (const match of content.matchAll(regex)) {
    refs.push({ subaction: match[1] ? match[1].slice(1) : null, sha: match[2] });
  }
  return refs;
}

function filesToScan() {
  const candidates = [
    '.github/workflows/deploy-storybook.yml',
    '.github/workflows/ci.yml',
    '.github/workflows/pr-preview-build.yml',
    '.github/workflows/pr-preview-publish.yml',
    '.github/workflows/pr-preview-cleanup.yml',
    '.github/workflows/pr-preview-janitor.yml'
  ];
  return candidates.map(file => path.join(repoRoot, file)).filter(file => fs.existsSync(file));
}

test('internal action pins reference a commit that actually contains that action', () => {
  const files = filesToScan();
  assert.ok(files.length > 0, 'expected at least one workflow file to scan');

  let checked = 0;

  for (const file of files) {
    const relFile = path.relative(repoRoot, file);
    const content = fs.readFileSync(file, 'utf8');
    const refs = findInternalActionRefs(content);

    for (const { subaction, sha } of refs) {
      checked += 1;

      assert.ok(
        gitCommitExists(sha),
        `${relFile}: pinned commit ${sha} for ${subaction ?? '(root action)'} does not exist in this repository's history`
      );

      const actionYmlPath = subaction ? `${subaction}/action.yml` : 'action.yml';
      assert.ok(
        gitShowExists(sha, actionYmlPath),
        `${relFile}: pinned commit ${sha} for "${subaction ?? '(root)'}" does not contain ${actionYmlPath} — ` +
          'this is a stale/invalid release pin (action resolution would fail with "Can\'t find action.yml")'
      );
    }
  }

  assert.ok(checked > 0, 'expected to find at least one internal SHA-pinned action reference to validate');
});

test('preview-publisher pin resolves alongside the src it depends on', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/pr-preview-publish.yml'), 'utf8');
  const match = workflow.match(/Archetipo95\/storybook-github-pages\/preview-publisher@([a-f0-9]{40})/);
  assert.ok(match, 'expected a SHA-pinned preview-publisher reference in pr-preview-publish.yml');

  const sha = match[1];
  assert.ok(gitCommitExists(sha), `pinned commit ${sha} does not exist in this repository's history`);
  assert.ok(
    gitShowExists(sha, 'preview-publisher/action.yml'),
    `pinned commit ${sha} is missing preview-publisher/action.yml`
  );
  // preview-publisher/action.yml invokes `${{ github.action_path }}/../src/preview-publish.js`,
  // so the pinned commit must also contain the script it depends on.
  assert.ok(
    gitShowExists(sha, 'src/preview-publish.js'),
    `pinned commit ${sha} is missing src/preview-publish.js required by preview-publisher/action.yml`
  );

  // Guard against ever regressing to the known-bad pre-preview-publisher pin from #35.
  assert.notEqual(sha, '6fdc8e329e5109026e6f0312f3886c1e64328719');
});
