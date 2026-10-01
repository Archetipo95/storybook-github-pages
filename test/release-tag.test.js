import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseTag, verifyReleaseTag, planRelease } from '../scripts/release-tag.js';

test('parseReleaseTag accepts stable tags and derives the major tag', () => {
  assert.deepEqual(parseReleaseTag('v1.10.0'), {
    tag: 'v1.10.0',
    version: '1.10.0',
    major: 1,
    minor: 10,
    patch: 0,
    majorTag: 'v1'
  });
});

test('parseReleaseTag rejects pre-release, unprefixed, and shell-unsafe tags', () => {
  for (const tag of ['1.2.3', 'v1.2', 'v1.2.3-rc.1', 'v1.2.3+build', 'v1', 'v1.2.3;rm -rf /', '', undefined]) {
    assert.throws(() => parseReleaseTag(tag), /stable semver tag/, `expected ${tag} to be rejected`);
  }
});

test('verifyReleaseTag requires package, lockfile, and changelog to agree with the tag', () => {
  const changelog = '# Changelog\n\n## [1.10.0] - 2026-09-30\n';
  assert.deepEqual(
    verifyReleaseTag({ tag: 'v1.10.0', packageVersion: '1.10.0', lockVersion: '1.10.0', changelog }),
    []
  );
  const problems = verifyReleaseTag({
    tag: 'v1.10.1',
    packageVersion: '1.10.0',
    lockVersion: '1.9.0',
    changelog
  });
  assert.equal(problems.length, 3);
  assert.match(problems[0], /package\.json version 1\.10\.0/);
  assert.match(problems[1], /package-lock\.json version 1\.9\.0/);
  assert.match(problems[2], /## \[1\.10\.1\]/);
});

const TAGS = ['v1', 'v0.9.0', 'v1.9.14', 'v1.10.0'];

test('planRelease creates the tag when a merged version bump on main has none', () => {
  assert.deepEqual(planRelease({ ref: 'refs/heads/main', packageVersion: '1.10.1', existingTags: TAGS }), {
    releaseTag: 'v1.10.1',
    createTag: true,
    verify: true,
    majorTag: 'v1',
    majorTarget: 'v1.10.1'
  });
});

test('planRelease only re-syncs the major tag when the version is already tagged', () => {
  assert.deepEqual(planRelease({ ref: 'refs/heads/main', packageVersion: '1.10.0', existingTags: TAGS }), {
    releaseTag: 'v1.10.0',
    createTag: false,
    verify: false,
    majorTag: 'v1',
    majorTarget: 'v1.10.0'
  });
});

test('planRelease validates a manually pushed tag without creating another one', () => {
  const plan = planRelease({ ref: 'refs/tags/v1.10.0', packageVersion: '1.10.0', existingTags: TAGS });
  assert.equal(plan.createTag, false);
  assert.equal(plan.verify, true);
  assert.equal(plan.releaseTag, 'v1.10.0');
});

test('planRelease compares versions numerically, not lexically', () => {
  assert.equal(
    planRelease({ ref: 'refs/heads/main', packageVersion: '1.10.0', existingTags: ['v1.9.99'] }).majorTarget,
    'v1.10.0'
  );
  assert.equal(
    planRelease({ ref: 'refs/heads/main', packageVersion: '1.9.99', existingTags: ['v1.10.0'] }).majorTarget,
    'v1.10.0'
  );
});

test('planRelease keeps the major tag on the newest release when a backport is tagged', () => {
  const plan = planRelease({
    ref: 'refs/tags/v1.4.3',
    packageVersion: '1.4.3',
    existingTags: ['v1.4.3', 'v1.10.0', 'v2.0.0']
  });
  assert.equal(plan.majorTag, 'v1');
  assert.equal(plan.majorTarget, 'v1.10.0');
});

test('planRelease ignores other major lines and non-release tags', () => {
  const plan = planRelease({
    ref: 'refs/heads/main',
    packageVersion: '2.0.0',
    existingTags: ['v1.99.0', 'v2', 'v2.1.0-rc.1', 'latest']
  });
  assert.equal(plan.majorTag, 'v2');
  assert.equal(plan.majorTarget, 'v2.0.0');
});

test('planRelease refuses to release a non-stable package version', () => {
  assert.throws(() => planRelease({ ref: 'refs/heads/main', packageVersion: '1.11.0-rc.1' }), /stable semver tag/);
});
