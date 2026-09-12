import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function extractJobBlock(content, jobName) {
  const regex = new RegExp(`^  ${jobName}:[\\s\\S]*?(?=^  [A-Za-z0-9_-]+:\\n|$(?![\\s\\S]))`, 'm');
  const match = content.match(regex);
  assert.ok(match, `job "${jobName}" not found`);
  return match[0];
}

test('pr-preview-build workflow is unprivileged: contents:read only, no secrets, untrusted checkout of the PR head', () => {
  const content = read('.github/workflows/pr-preview-build.yml');

  assert.match(content, /^on:\s*\n\s*pull_request:/m);
  assert.match(content, /permissions:\s*\n\s*contents:\s*read\s*\n/);
  assert.doesNotMatch(content, /pages:\s*write/);
  assert.doesNotMatch(content, /id-token:\s*write/);
  assert.doesNotMatch(content, /pull-requests:\s*write/);
  assert.doesNotMatch(content, /secrets\./, 'the untrusted build workflow must never reference secrets');
  assert.match(content, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.doesNotMatch(content, /uses: actions\/cache/, 'no shared build cache to avoid cross-fork cache poisoning');
});

test('pr-preview-publish workflow gates on success/event/repository and requires a matching same-repo pull request', () => {
  const content = read('.github/workflows/pr-preview-publish.yml');

  assert.match(content, /workflow_run:\s*\n\s*workflows: \["PR Preview Build"\]/);
  const gateJob = extractJobBlock(content, 'gate');
  assert.match(gateJob, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(gateJob, /github\.event\.workflow_run\.event == 'pull_request'/);
  assert.match(gateJob, /github\.event\.workflow_run\.repository\.full_name == github\.repository/);
  assert.match(gateJob, /github\.event\.workflow_run\.pull_requests\[0\] != null/, 'fork PRs (empty pull_requests[]) must be excluded by the gate condition');
  assert.doesNotMatch(gateJob, /contents:\s*write/, 'the read-only gate job must not hold write permissions');

  const publishJob = extractJobBlock(content, 'publish');
  assert.match(publishJob, /contents:\s*write/);
  assert.match(publishJob, /pages:\s*write/);
  assert.match(publishJob, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(publishJob, /github-token: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
});

test('pr-preview-cleanup workflow never checks out the pull request head and stays metadata-only', () => {
  const content = read('.github/workflows/pr-preview-cleanup.yml');

  assert.match(content, /pull_request_target:\s*\n\s*types: \[closed\]/);
  assert.doesNotMatch(content, /ref: \$\{\{ github\.event\.pull_request\.head/, 'cleanup must never check out the PR head ref/sha');
  assert.doesNotMatch(content, /pull-requests:\s*write/, 'cleanup does not need PR write access; it only touches the Pages branch');
  const cleanupJob = extractJobBlock(content, 'cleanup');
  assert.match(cleanupJob, /contents:\s*write/);
  assert.match(cleanupJob, /pages:\s*write/);
  assert.match(cleanupJob, /git ls-remote --exit-code --heads origin/, 'cleanup must check if Pages branch exists remotely before attempting checkout');
  assert.match(cleanupJob, /steps\.branch_check\.outputs\.exists == 'true'/, 'checkout and removal steps must be guarded by Pages branch existence');
});

test('pr-preview-janitor workflow supports manual dispatch and schedule, never checks out a pull request head', () => {
  const content = read('.github/workflows/pr-preview-janitor.yml');

  assert.match(content, /workflow_dispatch:/);
  assert.match(content, /schedule:/);
  assert.doesNotMatch(content, /pull_request/);
});

test('all trusted write workflows share the same Pages-branch concurrency group to serialize writers', () => {
  const publish = read('.github/workflows/pr-preview-publish.yml');
  const cleanup = read('.github/workflows/pr-preview-cleanup.yml');
  const janitor = read('.github/workflows/pr-preview-janitor.yml');
  const deploy = read('.github/workflows/deploy-storybook.yml');

  const group = 'storybook-pages-${{ github.repository }}';
  for (const [name, content] of [['publish', publish], ['cleanup', cleanup], ['janitor', janitor]]) {
    assert.ok(content.includes(`group: ${group}`), `${name} workflow must share the Pages concurrency group`);
  }
  assert.ok(deploy.includes('group: storybook-pages-${{ github.repository }}'));
});

test('preview target resolution and metadata modules are wired into the workflows', () => {
  const build = read('.github/workflows/pr-preview-build.yml');
  const publish = read('.github/workflows/pr-preview-publish.yml');
  const cleanup = read('.github/workflows/pr-preview-cleanup.yml');
  const janitor = read('.github/workflows/pr-preview-janitor.yml');

  assert.match(build, /node src\/preview-metadata\.js/);
  assert.match(publish, /node src\/preview-publish\.js/);
  assert.match(cleanup, /node src\/preview-cleanup\.js/);
  assert.match(janitor, /node src\/preview-janitor\.js/);
});
