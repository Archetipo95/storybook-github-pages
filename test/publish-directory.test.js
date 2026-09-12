import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { replaceDirectory } from '../src/publish-directory.js';

test('replaceDirectory replaces only the selected target and preserves siblings', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-publish-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-source-'));
  await fs.mkdir(path.join(repo, 'staging'), { recursive: true });
  await fs.mkdir(path.join(repo, 'other'), { recursive: true });
  await fs.writeFile(path.join(repo, 'staging', 'old.html'), 'old');
  await fs.writeFile(path.join(repo, 'other', 'keep.html'), 'keep');
  await fs.writeFile(path.join(source, 'index.html'), 'new');

  await replaceDirectory(repo, 'staging', source);

  assert.equal(await fs.readFile(path.join(repo, 'staging', 'index.html'), 'utf8'), 'new');
  await assert.rejects(fs.readFile(path.join(repo, 'staging', 'old.html')));
  assert.equal(await fs.readFile(path.join(repo, 'other', 'keep.html'), 'utf8'), 'keep');
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true });
});

test('root replacement preserves explicitly managed directories', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-root-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-source-'));
  await fs.mkdir(path.join(repo, 'staging'), { recursive: true });
  await fs.writeFile(path.join(repo, 'staging', 'keep.html'), 'keep');
  await fs.writeFile(path.join(repo, 'old.html'), 'old');
  await fs.writeFile(path.join(source, 'index.html'), 'new');
  const { replaceDirectory: replace } = await import('../src/publish-directory.js');
  await replace(repo, '', source, ['staging']);
  assert.equal(await fs.readFile(path.join(repo, 'staging', 'keep.html'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(repo, 'index.html'), 'utf8'), 'new');
  await assert.rejects(fs.readFile(path.join(repo, 'old.html')));
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true });
});
