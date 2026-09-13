import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateConfig, parseSimpleYaml, resolveConfiguration, resolveDeploymentTarget } from '../src/config.js';

test('validateConfig - default valid config', () => {
  const valid = {
    version: 1,
    mode: 'artifact',
    path: 'storybook-static',
    package_manager: 'npm'
  };
  assert.equal(validateConfig(valid), true);
});

test('validateConfig - rejects invalid version', () => {
  assert.throws(() => {
    validateConfig({ version: 2 });
  }, /Unsupported configuration version: 2/);
});

test('validateConfig - rejects invalid mode', () => {
  assert.throws(() => {
    validateConfig({ mode: 'invalid-mode' });
  }, /Unsupported mode: "invalid-mode"/);
});

test('validateConfig - rejects invalid package_manager', () => {
  assert.throws(() => {
    validateConfig({ package_manager: 'pip' });
  }, /Unsupported package_manager: "pip"/);
});

test('validateConfig - accepts bun package_manager', () => {
  assert.equal(validateConfig({ package_manager: 'bun' }), true);
});

test('validateConfig - rejects path traversal', () => {
  assert.throws(() => {
    validateConfig({ path: '../outside' });
  }, /Config path "\.\.\/outside" is unsafe/);
});

test('validateConfig - accepts directory mode and rejects protected targets', () => {
  assert.equal(validateConfig({ mode: 'directory', pages_branch: 'gh-pages', target_directory: 'en/preview' }), true);
  assert.throws(() => validateConfig({ mode: 'directory', target_directory: '../outside' }), /target_directory/);
  assert.throws(() => validateConfig({ mode: 'directory', target_directory: '.git/hooks' }), /target_directory/);
});

test('validateConfig - accepts a safe preview_root and rejects an unsafe one', () => {
  assert.equal(validateConfig({ preview_root: 'pr-preview' }), true);
  assert.equal(validateConfig({ preview_root: '' }), true, 'empty preview_root must be accepted for repository-root layout');
  assert.throws(() => validateConfig({ preview_root: '../outside' }), /preview_root/);
  assert.throws(() => validateConfig({ preview_root: '.git' }), /preview_root/);
});

test('validateConfig - accepts 0 or positive preview_retention_days and rejects invalid values', () => {
  assert.equal(validateConfig({ preview_retention_days: 14 }), true);
  assert.equal(validateConfig({ preview_retention_days: 0 }), true, 'retention 0 must be accepted to disable age-based pruning');
  assert.throws(() => validateConfig({ preview_retention_days: -1 }), /preview_retention_days/);
  assert.throws(() => validateConfig({ preview_retention_days: 'many' }), /preview_retention_days/);
});

test('resolveDeploymentTarget - derives URL metadata for named environments', () => {
  assert.deepEqual(resolveDeploymentTarget({
    mode: 'directory',
    target_directory: 'staging',
    site_url: 'https://example.github.io/storybook'
  }), {
    directory: 'staging',
    basePath: '/staging',
    url: 'https://example.github.io/storybook/staging'
  });
  assert.equal(resolveDeploymentTarget({ mode: 'artifact' }).directory, null);
});

test('parseSimpleYaml - parses simple key-value YAML', () => {
  const yaml = `
version: 1
mode: artifact
path: build-output
package_manager: pnpm
build:
  install_command: pnpm install
  build_command: pnpm build-storybook
`;
  const parsed = parseSimpleYaml(yaml);
  assert.deepEqual(parsed, {
    version: 1,
    mode: 'artifact',
    path: 'build-output',
    package_manager: 'pnpm',
    build: {
      install_command: 'pnpm install',
      build_command: 'pnpm build-storybook'
    }
  });
});

test('resolveConfiguration - merges inputs over config file and defaults', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-test-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');

  fs.writeFileSync(configPath, `
version: 1
mode: artifact
path: custom-static
package_manager: yarn
`);

  const resolved = resolveConfiguration({
    inputs: { path: 'override-static' },
    configFilePath: configPath
  });

  assert.equal(resolved.path, 'override-static');
  assert.equal(resolved.package_manager, 'yarn');
  assert.equal(resolved.version, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - empty workflow inputs do not mask file settings', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-precedence-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');
  fs.writeFileSync(configPath, 'mode: directory\npath: docs\npages_branch: pages\ntarget_directory: staging\n');
  const resolved = resolveConfiguration({ inputs: { mode: '', path: '', pages_branch: '', target_directory: '' }, configFilePath: configPath });
  assert.equal(resolved.mode, 'directory');
  assert.equal(resolved.path, 'docs');
  assert.equal(resolved.pages_branch, 'pages');
  assert.equal(resolved.target_directory, 'staging');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - defaults preview_root and preview_retention_days, and honors file overrides', () => {
  const defaults = resolveConfiguration({ inputs: {}, configFilePath: path.join(os.tmpdir(), 'sb-config-nonexistent.yml') });
  assert.equal(defaults.preview_root, 'pr-preview');
  assert.equal(defaults.preview_retention_days, 30);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-preview-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');
  fs.writeFileSync(configPath, 'preview_root: previews\npreview_retention_days: 10\n');
  const resolved = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(resolved.preview_root, 'previews');
  assert.equal(resolved.preview_retention_days, 10);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - preserves preview_retention_days 0 from input or config file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-retention-zero-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');

  // Test retention_days: 0 in config file
  fs.writeFileSync(configPath, 'preview_retention_days: 0\n');
  const fromFile = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(fromFile.preview_retention_days, 0, 'preview_retention_days 0 in config file must be preserved');

  // Test string "0" in workflow input over config file
  const fromInputString = resolveConfiguration({ inputs: { preview_retention_days: '0' }, configFilePath: configPath });
  assert.equal(fromInputString.preview_retention_days, 0, 'preview_retention_days "0" from input must be preserved');

  // Test numeric 0 in workflow input
  const fromInputNumber = resolveConfiguration({ inputs: { preview_retention_days: 0 }, configFilePath: configPath });
  assert.equal(fromInputNumber.preview_retention_days, 0, 'preview_retention_days 0 from input must be preserved');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - supports repository-root layout preview_root: "" and "."', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-root-layout-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');

  // Test preview_root: "" in config file
  fs.writeFileSync(configPath, 'preview_root: ""\n');
  const fromFile = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(fromFile.preview_root, '', 'preview_root "" in config file must resolve to empty string');

  // Test preview_root: "." in config file
  fs.writeFileSync(configPath, 'preview_root: "."\n');
  const fromFileDot = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(fromFileDot.preview_root, '', 'preview_root "." in config file must resolve to empty string');

  // Test preview_root: "custom" in input
  const fromInput = resolveConfiguration({ inputs: { preview_root: 'previews' }, configFilePath: configPath });
  assert.equal(fromInput.preview_root, 'previews', 'explicit preview_root input overrides config file');

  // Test preview_root: "." in input overriding non-empty config file
  fs.writeFileSync(configPath, 'preview_root: "custom-previews"\n');
  const fromInputDot = resolveConfiguration({ inputs: { preview_root: '.' }, configFilePath: configPath });
  assert.equal(fromInputDot.preview_root, '', 'explicit preview_root "." input overrides config file to root layout');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
