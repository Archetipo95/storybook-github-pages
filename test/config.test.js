import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateConfig, parseSimpleYaml, resolveConfiguration } from '../src/config.js';

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
