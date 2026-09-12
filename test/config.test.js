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

  assert.equal(resolved.path, 'override-static');
  assert.equal(resolved.package_manager, 'yarn');
  assert.equal(resolved.version, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
