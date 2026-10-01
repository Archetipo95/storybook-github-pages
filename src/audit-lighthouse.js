import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createStaticServer, resolveStaticDirectory } from './smoke-test.js';
import { AUDIT_DIRECTORY } from './audit-static.js';

// Opt-in Lighthouse audit of the built Storybook manager page. The static
// output is served from loopback with the same hardened server the smoke test
// uses, and Lighthouse runs from a pinned npm version against headless Chrome.

export const LIGHTHOUSE_VERSION = '13.5.0';
export const LIGHTHOUSE_REPORT_FILENAME = 'lighthouse.json';
export const LIGHTHOUSE_CATEGORIES = [
  { id: 'performance', label: 'Performance' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'seo', label: 'SEO' }
];

export function parseMinScore(value) {
  if (value === undefined || value === null || value === '') return null;
  const score = Number(value);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error(`lighthouse_min_score must be an integer between 0 and 100, got "${value}"`);
  }
  return score;
}

/** Extracts 0-100 category scores from a Lighthouse result (LHR) object. */
export function extractScores(lhr) {
  const scores = {};
  for (const { id } of LIGHTHOUSE_CATEGORIES) {
    const raw = lhr?.categories?.[id]?.score;
    scores[id] = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw * 100) : null;
  }
  return scores;
}

/**
 * Validates scores read from disk. PR preview reports are produced by the
 * untrusted build job, so only integers in [0, 100] for known categories are
 * ever rendered.
 */
export function sanitizeLighthouseReport(report) {
  if (!report || typeof report !== 'object' || typeof report.scores !== 'object' || report.scores === null) {
    return null;
  }
  const scores = {};
  let any = false;
  for (const { id } of LIGHTHOUSE_CATEGORIES) {
    const value = report.scores[id];
    if (Number.isInteger(value) && value >= 0 && value <= 100) {
      scores[id] = value;
      any = true;
    } else {
      scores[id] = null;
    }
  }
  if (!any) return null;
  const minScore =
    Number.isInteger(report.minScore) && report.minScore >= 0 && report.minScore <= 100 ? report.minScore : null;
  return { scores, minScore };
}

export function evaluateScores(scores, minScore) {
  if (minScore === null || minScore === undefined) return [];
  return LIGHTHOUSE_CATEGORIES.filter(({ id }) => scores[id] === null || scores[id] < minScore).map(
    ({ id, label }) => ({ id, label, score: scores[id] })
  );
}

function scoreIcon(score) {
  if (score === null) return '⚪';
  if (score >= 90) return '🟢';
  if (score >= 50) return '🟠';
  return '🔴';
}

export function formatLighthouseReport(report, { heading = '### 🚦 Lighthouse', note = '' } = {}) {
  const clean = sanitizeLighthouseReport(report);
  if (!clean) return '';
  const lines = [heading, ''];
  if (note) lines.push(note, '');
  lines.push('| Category | Score |', '| :--- | :---: |');
  for (const { id, label } of LIGHTHOUSE_CATEGORIES) {
    const score = clean.scores[id];
    lines.push(`| ${label} | ${scoreIcon(score)} ${score === null ? 'n/a' : score} |`);
  }
  lines.push('');
  if (clean.minScore !== null) {
    const failures = evaluateScores(clean.scores, clean.minScore);
    lines.push(
      failures.length > 0
        ? `> ❌ **Below the minimum score of ${clean.minScore}:** ${failures.map(f => f.label).join(', ')}.`
        : `> ✅ All categories meet the minimum score of ${clean.minScore}.`,
      ''
    );
  }
  return lines.join('\n');
}

function defaultRunLighthouse({ url, outputPath }) {
  const args = [
    '--yes',
    `lighthouse@${LIGHTHOUSE_VERSION}`,
    url,
    '--output=json',
    `--output-path=${outputPath}`,
    '--quiet',
    `--only-categories=${LIGHTHOUSE_CATEGORIES.map(c => c.id).join(',')}`,
    '--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage'
  ];
  // Asynchronous on purpose: the loopback static server lives in this same
  // process and must keep answering requests while Lighthouse runs.
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve(JSON.parse(fs.readFileSync(outputPath, 'utf8')));
      else reject(new Error(`Lighthouse exited with code ${code}`));
    });
  });
}

export async function runLighthouseAudit({
  staticPath,
  workspaceRoot = process.cwd(),
  minScore = null,
  pagePath = 'index.html',
  runLighthouse = defaultRunLighthouse,
  serverFactory = createStaticServer,
  summaryPath = process.env.GITHUB_STEP_SUMMARY
} = {}) {
  const threshold = parseMinScore(minScore);
  let staticDir;
  try {
    staticDir = resolveStaticDirectory(staticPath, workspaceRoot);
  } catch (error) {
    throw new Error(error.message.replace('Smoke test failed', 'Lighthouse audit failed'));
  }

  const server = serverFactory(staticDir);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storybook-lighthouse-'));
  let lhr;
  try {
    const { port } = server.address();
    lhr = await runLighthouse({
      url: `http://127.0.0.1:${port}/${pagePath.replace(/^\/+/, '')}`,
      outputPath: path.join(tempDir, 'lhr.json')
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const report = {
    version: 1,
    lighthouseVersion: typeof lhr?.lighthouseVersion === 'string' ? lhr.lighthouseVersion : LIGHTHOUSE_VERSION,
    page: pagePath,
    scores: extractScores(lhr),
    minScore: threshold
  };
  const auditDir = path.join(staticDir, AUDIT_DIRECTORY);
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, LIGHTHOUSE_REPORT_FILENAME), `${JSON.stringify(report, null, 2)}\n`);

  const markdown = formatLighthouseReport(report);
  if (summaryPath) fs.appendFileSync(summaryPath, `${markdown}\n`);
  return { report, markdown, failures: evaluateScores(report.scores, threshold) };
}

if (process.argv[1] && process.argv[1].endsWith('audit-lighthouse.js')) {
  const [staticPath = process.env.SB_PATH || 'storybook-static', workspaceRoot = process.cwd()] = process.argv.slice(2);
  runLighthouseAudit({ staticPath, workspaceRoot, minScore: process.env.SB_LIGHTHOUSE_MIN_SCORE || null })
    .then(({ markdown, failures, report }) => {
      console.log(markdown);
      if (failures.length > 0) {
        console.error(
          `❌ Lighthouse scores below ${report.minScore}: ${failures.map(f => `${f.label} (${f.score ?? 'n/a'})`).join(', ')}`
        );
        process.exitCode = 1;
      }
    })
    .catch(error => {
      console.error(`❌ ${error.message}`);
      process.exitCode = 1;
    });
}
