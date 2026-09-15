import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('v2 core action deploys only an already-built, validated static directory', () => {
  const action = fs.readFileSync(path.join(process.cwd(), 'v2/action.yml'), 'utf8');

  assert.match(action, /static_dir:/);
  assert.match(action, /validate-artifact\.js" "\$STATIC_DIR" "\$WORKSPACE_ROOT"/);
  assert.match(action, /actions\/upload-pages-artifact@[a-f0-9]{40}/);
  assert.match(action, /actions\/deploy-pages@[a-f0-9]{40}/);
  assert.doesNotMatch(action, /package_manager|install_command|build_command|eval\b|config\.js/);
});

test('repository-root v2 action retains the documented feature-parity inputs', () => {
  const action = fs.readFileSync(path.join(process.cwd(), 'action.yml'), 'utf8');

  for (const input of [
    'checkout:',
    'path:',
    'package_manager:',
    'install_command:',
    'build_command:',
    'mode:',
    'generate_badges:',
    'generate_stats_graph:',
    'enable_passcode_gate:',
    'create_deployment:'
  ]) {
    assert.match(action, new RegExp(`\\n  ${input}`));
  }
});
