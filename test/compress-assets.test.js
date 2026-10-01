import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { compressAssets, parseAlgorithms, validateCompressedSidecars } from '../src/compress-assets.js';
import { validateArtifactDirectory } from '../src/validate-artifact.js';

function makeStaticDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-compress-test-'));
  const staticDir = path.join(tmpDir, 'storybook-static');
  fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
  const bundle = 'export const story = "button";\n'.repeat(200);
  fs.writeFileSync(
    path.join(staticDir, 'index.html'),
    `<html><body>${'<div>Storybook</div>'.repeat(100)}</body></html>`
  );
  fs.writeFileSync(path.join(staticDir, 'assets', 'bundle.js'), bundle);
  fs.writeFileSync(path.join(staticDir, 'assets', 'tiny.css'), 'body{margin:0}');
  fs.writeFileSync(path.join(staticDir, 'assets', 'logo.png'), Buffer.alloc(4096, 1));
  return { tmpDir, staticDir, bundle };
}

test('parseAlgorithms - normalizes and rejects unknown algorithms', () => {
  assert.deepEqual(parseAlgorithms(' Brotli , gzip,brotli '), ['brotli', 'gzip']);
  assert.throws(() => parseAlgorithms(''), /at least one/);
  assert.throws(() => parseAlgorithms('gzip,zstd'), /Unsupported compression algorithm "zstd"/);
});

test('compressAssets - writes verified gzip and brotli sidecars for compressible assets only', () => {
  const { tmpDir, staticDir, bundle } = makeStaticDir();
  try {
    const summary = compressAssets(staticDir);
    assert.equal(summary.compressed, 2);
    assert.deepEqual(
      summary.sidecars.sort(),
      ['assets/bundle.js.br', 'assets/bundle.js.gz', 'index.html.br', 'index.html.gz']
        .map(p => path.normalize(p))
        .sort()
    );
    assert.equal(fs.existsSync(path.join(staticDir, 'assets', 'tiny.css.gz')), false, 'files below 1KB are skipped');
    assert.equal(fs.existsSync(path.join(staticDir, 'assets', 'logo.png.gz')), false, 'binary assets are skipped');

    const gz = fs.readFileSync(path.join(staticDir, 'assets', 'bundle.js.gz'));
    const br = fs.readFileSync(path.join(staticDir, 'assets', 'bundle.js.br'));
    assert.equal(zlib.gunzipSync(gz).toString(), bundle);
    assert.equal(zlib.brotliDecompressSync(br).toString(), bundle);
    assert.ok(br.length < bundle.length && gz.length < bundle.length);
    assert.equal(fs.statSync(path.join(staticDir, 'assets', 'bundle.js.br')).mode & 0o111, 0);

    assert.equal(validateCompressedSidecars(staticDir).checked.length, 4);
    assert.equal(validateArtifactDirectory('storybook-static', tmpDir).compressedSidecars.length, 4);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('compressAssets - honours the selected algorithm list', () => {
  const { tmpDir, staticDir } = makeStaticDir();
  try {
    const summary = compressAssets(staticDir, { algorithms: 'brotli' });
    assert.ok(summary.sidecars.every(file => file.endsWith('.br')));
    assert.equal(fs.existsSync(path.join(staticDir, 'index.html.gz')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('validateCompressedSidecars - rejects stale, corrupt, orphaned, or executable sidecars', () => {
  const { tmpDir, staticDir } = makeStaticDir();
  try {
    compressAssets(staticDir);
    const bundlePath = path.join(staticDir, 'assets', 'bundle.js');

    fs.appendFileSync(bundlePath, '// changed after compression\n');
    assert.throws(() => validateArtifactDirectory('storybook-static', tmpDir), /does not match the checksum/);

    compressAssets(staticDir);
    fs.writeFileSync(`${bundlePath}.gz`, 'not gzip');
    assert.throws(() => validateCompressedSidecars(staticDir), /is not valid gzip data/);

    compressAssets(staticDir);
    fs.chmodSync(`${bundlePath}.br`, 0o755);
    assert.throws(() => validateCompressedSidecars(staticDir), /must not be executable/);

    compressAssets(staticDir);
    fs.rmSync(path.join(staticDir, 'index.html'));
    assert.throws(() => validateCompressedSidecars(staticDir), /has no matching original file/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
