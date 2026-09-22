import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runSmokeTest, storyMatches } from '../src/smoke-test.js';

test('storyMatches supports exact ids and wildcard patterns', () => {
  assert.equal(storyMatches('button--primary', 'button--primary'), true);
  assert.equal(storyMatches('button--primary', 'button--*'), true);
  assert.equal(storyMatches('input--primary', 'button--*'), false);
});

test('runSmokeTest checks manager and iframe pages on loopback', async () => {
  const urls = [];
  const page = {
    on() {},
    async goto(url) {
      urls.push(url);
    },
    async waitForLoadState() {},
    locator() {
      return { count: async () => 1 };
    },
    async close() {}
  };
  const browser = {
    async newPage() {
      return page;
    },
    async close() {}
  };

  await runSmokeTest({
    staticPath: 'test/fixtures/sample-storybook',
    workspaceRoot: process.cwd(),
    playwright: { chromium: { launch: async () => browser } },
    timeoutMs: 1000
  });

  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/index\.html$/);
  assert.match(urls[1], /\/iframe\.html$/);
});

test('runSmokeTest rejects a static path outside the workspace', async () => {
  await assert.rejects(
    runSmokeTest({
      staticPath: path.join('test', 'fixtures', 'sample-storybook', '..', '..', '..', '..'),
      playwright: { chromium: { launch: async () => ({}) } }
    }),
    /escapes the workspace root/
  );
});
