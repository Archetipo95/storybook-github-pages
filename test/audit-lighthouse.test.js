import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateScores,
  extractScores,
  formatLighthouseReport,
  parseMinScore,
  runLighthouseAudit,
  sanitizeLighthouseReport
} from '../src/audit-lighthouse.js';

const LHR = {
  lighthouseVersion: '13.5.0',
  categories: {
    performance: { score: 0.42 },
    accessibility: { score: 0.97 },
    'best-practices': { score: 1 },
    seo: { score: 0.8 }
  }
};

test('parseMinScore validates the 0-100 integer threshold', () => {
  assert.equal(parseMinScore(''), null);
  assert.equal(parseMinScore('90'), 90);
  assert.throws(() => parseMinScore('101'), /between 0 and 100/);
  assert.throws(() => parseMinScore('9.5'), /between 0 and 100/);
});

test('extractScores converts Lighthouse category scores to 0-100', () => {
  assert.deepEqual(extractScores(LHR), { performance: 42, accessibility: 97, 'best-practices': 100, seo: 80 });
  assert.equal(extractScores({ categories: {} }).seo, null);
});

test('evaluateScores reports categories below the minimum', () => {
  const scores = extractScores(LHR);
  assert.deepEqual(
    evaluateScores(scores, 80).map(f => f.id),
    ['performance']
  );
  assert.deepEqual(evaluateScores(scores, null), []);
});

test('sanitizeLighthouseReport drops anything that is not a 0-100 integer', () => {
  const clean = sanitizeLighthouseReport({
    scores: { performance: 50, accessibility: '<img src=x>', seo: 900, extra: 1 },
    minScore: 'x'
  });
  assert.deepEqual(clean, {
    scores: { performance: 50, accessibility: null, 'best-practices': null, seo: null },
    minScore: null
  });
  assert.equal(sanitizeLighthouseReport({ scores: { performance: 'nope' } }), null);
  assert.equal(sanitizeLighthouseReport(null), null);
});

test('formatLighthouseReport renders scores and threshold status', () => {
  const markdown = formatLighthouseReport({ scores: extractScores(LHR), minScore: 50 });
  assert.match(markdown, /\| Performance \| 🔴 42 \|/);
  assert.match(markdown, /\| Accessibility \| 🟢 97 \|/);
  assert.match(markdown, /Below the minimum score of 50:\*\* Performance/);
});

test('runLighthouseAudit serves the build on loopback and records scores', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lighthouse-root-'));
  const staticDir = path.join(root, 'storybook-static');
  fs.mkdirSync(staticDir);
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<html><body>sb</body></html>');
  const summaryPath = path.join(root, 'summary.md');

  let requestedUrl;
  const result = await runLighthouseAudit({
    staticPath: 'storybook-static',
    workspaceRoot: root,
    minScore: '90',
    summaryPath,
    runLighthouse: async ({ url }) => {
      requestedUrl = url;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      return LHR;
    }
  });

  assert.match(requestedUrl, /^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
  assert.deepEqual(
    result.failures.map(f => f.id),
    ['performance', 'seo']
  );
  const written = JSON.parse(fs.readFileSync(path.join(staticDir, 'audit', 'lighthouse.json'), 'utf8'));
  assert.equal(written.scores.performance, 42);
  assert.equal(written.minScore, 90);
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Lighthouse/);
});

test('runLighthouseAudit rejects paths outside the workspace', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lighthouse-escape-'));
  await assert.rejects(
    runLighthouseAudit({ staticPath: '../elsewhere', workspaceRoot: root, runLighthouse: async () => LHR }),
    /Lighthouse audit failed/
  );
});
