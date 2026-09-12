import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('verify all action uses are pinned to full commit SHAs', () => {
  const root = process.cwd();
  const filesToCheck = [
    path.join(root, 'action.yml'),
    path.join(root, '.github/workflows/deploy-storybook.yml'),
    path.join(root, '.github/workflows/ci.yml'),
    path.join(root, '.github/workflows/pr-preview-build.yml'),
    path.join(root, '.github/workflows/pr-preview-publish.yml'),
    path.join(root, '.github/workflows/pr-preview-cleanup.yml'),
    path.join(root, '.github/workflows/pr-preview-janitor.yml')
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

test('verify deploy-storybook workflow build-and-upload job has minimal permissions', () => {
  const root = process.cwd();
  const workflowPath = path.join(root, '.github/workflows/deploy-storybook.yml');
  const content = fs.readFileSync(workflowPath, 'utf8');

  // Verify top-level permissions are contents: read only
  const topLevelPermissionsMatch = content.match(/permissions:\s*\n\s*contents:\s*read\s*\n\s*jobs:/);
  assert.ok(topLevelPermissionsMatch, 'Workflow-level permissions must be set to contents: read only');

  // Extract build-and-upload job block
  const buildJobMatch = content.match(/build-and-upload:[\s\S]*?(?=deploy:|$)/);
  assert.ok(buildJobMatch, 'build-and-upload job not found in deploy-storybook.yml');

  const buildJobContent = buildJobMatch[0];
  assert.match(buildJobContent, /contents:\s*read/);
  assert.doesNotMatch(buildJobContent, /pages:\s*write/, 'build-and-upload job must not have pages: write permission');
  assert.doesNotMatch(buildJobContent, /id-token:\s*write/, 'build-and-upload job must not have id-token: write permission');

  // Extract deploy job block
  const deployJobMatch = content.match(/deploy:[\s\S]*$/);
  assert.ok(deployJobMatch, 'deploy job not found in deploy-storybook.yml');

  const deployJobContent = deployJobMatch[0];
  assert.match(deployJobContent, /contents:\s*read/, 'deploy job must have contents: read');
  assert.match(deployJobContent, /pages:\s*write/, 'deploy job must have pages: write permission at job scope');
  assert.match(deployJobContent, /id-token:\s*write/, 'deploy job must have id-token: write permission at job scope');
});

test('workflow resolves configuration before setup and uses resolved deployment values', () => {
  const content = fs.readFileSync(path.join(process.cwd(), '.github/workflows/deploy-storybook.yml'), 'utf8');
  assert.ok(content.indexOf('id: config') < content.indexOf('actions/setup-node@'));
  assert.match(content, /path: \$\{\{ steps\.config\.outputs\.path \}\}/);
  assert.match(content, /target_directory: \$\{\{ needs\.build-and-upload\.outputs\.target_directory \}\}/);
  assert.doesNotMatch(content, /TARGET_DIRECTORY: \$\{\{ inputs\.target_directory \}\}/);
});

test('composite action passes dynamic paths and publish flags through runtime environment', () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'action.yml'), 'utf8');
  assert.match(content, /validate-artifact\.js" "\$SB_PATH"/);
  assert.doesNotMatch(content, /node .*validate-artifact\.js.*\$\{\{ env\.SB_PATH \}\}/);
  assert.doesNotMatch(content, /"\$\{\{ inputs\.publish \}\}"/);
});

test('directory publisher has Pages permission and rebuild is outside push retries', () => {
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/deploy-storybook.yml'), 'utf8');
  const job = workflow.match(/directory-publish:[\s\S]*$/)[0];
  assert.match(job, /contents:\s*write[\s\S]*pages:\s*write/);
  const publisher = fs.readFileSync(path.join(process.cwd(), 'src/publish-directory.js'), 'utf8');
  assert.ok(publisher.indexOf("['push'") < publisher.indexOf("fetch(`https://api.github.com"));
  assert.ok(publisher.indexOf("fetch(`https://api.github.com") > publisher.indexOf('for (let attempt'));
});

test('directory publisher reference pins the reviewed implementation commit', () => {
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/deploy-storybook.yml'), 'utf8');
  assert.match(workflow, /Archetipo95\/storybook-github-pages\/publisher@9be19be83cb05f2f648b4c78dac27befdb93d740/);
  assert.doesNotMatch(workflow, /publisher@f9dc8f9f0cc19f8df966a2a74b871c36322a789c/);
});
