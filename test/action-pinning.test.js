import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('verify all action uses are pinned to full commit SHAs', () => {
  const root = process.cwd();
  const filesToCheck = [
    path.join(root, 'action.yml'),
    path.join(root, '.github/workflows/deploy-storybook.yml'),
    path.join(root, '.github/workflows/ci.yml')
  ];

  const shaUsesRegex = /uses:\s*([a-zA-Z0-9-_\/]+)@([a-f0-9]{40})/g;
  const anyUsesRegex = /uses:\s*([^\s]+)/g;

  for (const file of filesToCheck) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');

    const matches = [...content.matchAll(anyUsesRegex)];
    for (const match of matches) {
      const usesTarget = match[1];
      // Skip local action references like ./ or ./src
      if (usesTarget.startsWith('./')) continue;

      // Must be pinned to 40-char hex commit SHA
      const shaMatch = usesTarget.match(/@([a-f0-9]{40})/);
      assert.ok(
        shaMatch,
        `Action usage "${usesTarget}" in file ${path.relative(root, file)} is not pinned to a full 40-character commit SHA!`
      );
    }
  }
});
