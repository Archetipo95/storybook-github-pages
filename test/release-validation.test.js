import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('release validation - package.json runtime dependency cleanliness', () => {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.equal(pkg.version, '1.0.0', 'package.json version must be set to 1.0.0 for stable release');
  assert.ok(
    !pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
    'storybook-github-pages must have zero runtime npm dependencies for maximum reproducibility'
  );
});

test('release validation - version metadata consistency across files', () => {
  const root = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;

  // Check CHANGELOG.md
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(
    changelog.includes(`## [${version}]`),
    `CHANGELOG.md must contain a section header for version [${version}]`
  );

  // Check action.yml
  const actionYml = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
  assert.match(actionYml, /name:\s*['"]?Deploy Storybook to GitHub Pages['"]?/);
  assert.match(actionYml, /using:\s*['"]?composite['"]?/);

  // Check publisher/action.yml
  const publisherYml = fs.readFileSync(path.join(root, 'publisher/action.yml'), 'utf8');
  assert.match(publisherYml, /name:\s*['"]?Trusted Storybook Pages publisher['"]?/);
  assert.match(publisherYml, /using:\s*['"]?composite['"]?/);
});

test('release validation - documentation and governance files presence', () => {
  const root = process.cwd();
  const requiredFiles = [
    'README.md',
    'CHANGELOG.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'LICENSE',
    'package.json',
    '.github/dependabot.yml',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/config.yml'
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(root, file);
    assert.ok(fs.existsSync(filePath), `Required release governance file "${file}" is missing!`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 0, `Required release governance file "${file}" is empty!`);
  }
});

test('release validation - zero telemetry and strict GitHub API endpoints in src/', () => {
  const srcDir = path.join(process.cwd(), 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

  const prohibitedPatterns = [
    /mixpanel/i,
    /segment\.io/i,
    /google-analytics/i,
    /telemetry/i,
    /sentry/i,
    /datadog/i,
    /posthog/i
  ];

  for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');

    for (const pattern of prohibitedPatterns) {
      assert.doesNotMatch(
        content,
        pattern,
        `Prohibited telemetry or tracking pattern "${pattern}" found in src/${file}`
      );
    }

    // Verify all HTTP requests in JS files target api.github.com
    const fetchMatches = [...content.matchAll(/fetch\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g)];
    for (const match of fetchMatches) {
      const url = match[1];
      assert.ok(
        url.startsWith('https://api.github.com'),
        `HTTP fetch in src/${file} targets non-GitHub API endpoint "${url}"`
      );
    }
  }
});
