import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const COMPRESSIBLE_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.map']);
export const DEFAULT_MIN_SIZE_BYTES = 1024;

export const ALGORITHMS = {
  gzip: {
    extension: '.gz',
    compress: buffer => zlib.gzipSync(buffer, { level: zlib.constants.Z_BEST_COMPRESSION }),
    decompress: buffer => zlib.gunzipSync(buffer)
  },
  brotli: {
    extension: '.br',
    compress: (buffer, size) =>
      zlib.brotliCompressSync(buffer, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size
        }
      }),
    decompress: buffer => zlib.brotliDecompressSync(buffer)
  }
};

const SIDECAR_EXTENSIONS = new Map(Object.entries(ALGORITHMS).map(([name, { extension }]) => [extension, name]));

export function parseAlgorithms(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  const algorithms = [...new Set(raw.map(entry => String(entry).trim().toLowerCase()).filter(Boolean))];
  if (algorithms.length === 0) {
    throw new Error('compress_algorithms must list at least one of: gzip, brotli');
  }
  for (const algorithm of algorithms) {
    if (!Object.hasOwn(ALGORITHMS, algorithm)) {
      throw new Error(`Unsupported compression algorithm "${algorithm}"; expected gzip and/or brotli`);
    }
  }
  return algorithms;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function listRegularFiles(dir, baseDir = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    // Symlinks are never followed or compressed, so sidecars can only be written for real files inside the output.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      results.push(...listRegularFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, fullPath));
    }
  }
  return results;
}

function sidecarMode(sourceStat) {
  // Mirror the source's read bits but never carry executable or group/other write bits onto sidecars.
  return (sourceStat.mode & 0o444) | 0o200;
}

export function compressAssets(staticDir, { algorithms = 'gzip,brotli', minSize = DEFAULT_MIN_SIZE_BYTES } = {}) {
  const selected = parseAlgorithms(algorithms);
  const rootReal = fs.realpathSync(path.resolve(staticDir));
  if (!fs.statSync(rootReal).isDirectory()) {
    throw new Error(`Pre-compression failed: "${staticDir}" is not a directory.`);
  }

  const summary = { compressed: 0, skipped: 0, sidecars: [], originalBytes: 0, compressedBytes: {} };
  for (const algorithm of selected) summary.compressedBytes[algorithm] = 0;

  for (const relFile of listRegularFiles(rootReal)) {
    const ext = path.extname(relFile).toLowerCase();
    if (!COMPRESSIBLE_EXTENSIONS.has(ext)) continue;

    const fullPath = path.join(rootReal, relFile);
    const stat = fs.statSync(fullPath);
    if (stat.size < minSize) {
      summary.skipped++;
      continue;
    }

    const source = fs.readFileSync(fullPath);
    let wroteAny = false;
    for (const algorithm of selected) {
      const { extension, compress } = ALGORITHMS[algorithm];
      const compressed = compress(source, source.length);
      // A sidecar that is not smaller than the original only wastes artifact space.
      if (compressed.length >= source.length) continue;
      const sidecarPath = `${fullPath}${extension}`;
      if (fs.existsSync(sidecarPath) && fs.lstatSync(sidecarPath).isSymbolicLink()) {
        throw new Error(`Pre-compression failed: refusing to overwrite symlinked sidecar "${relFile}${extension}".`);
      }
      fs.writeFileSync(sidecarPath, compressed, { mode: sidecarMode(stat) });
      fs.chmodSync(sidecarPath, sidecarMode(stat));
      summary.sidecars.push(`${relFile}${extension}`);
      summary.compressedBytes[algorithm] += compressed.length;
      wroteAny = true;
    }
    if (wroteAny) {
      summary.compressed++;
      summary.originalBytes += source.length;
    } else {
      summary.skipped++;
    }
  }

  return summary;
}

export function validateCompressedSidecars(staticDir) {
  const rootReal = fs.realpathSync(path.resolve(staticDir));
  const checked = [];

  for (const relFile of listRegularFiles(rootReal)) {
    const sidecarExt = path.extname(relFile).toLowerCase();
    const algorithm = SIDECAR_EXTENSIONS.get(sidecarExt);
    if (!algorithm) continue;

    const originalRel = relFile.slice(0, -sidecarExt.length);
    // Only sidecars of compressible assets are ours; other .gz/.br files are treated as ordinary content.
    if (!COMPRESSIBLE_EXTENSIONS.has(path.extname(originalRel).toLowerCase())) continue;

    const originalPath = path.join(rootReal, originalRel);
    if (!fs.existsSync(originalPath) || !fs.lstatSync(originalPath).isFile()) {
      throw new Error(`Compressed sidecar "${relFile}" has no matching original file "${originalRel}".`);
    }

    const sidecarPath = path.join(rootReal, relFile);
    const sidecarStat = fs.statSync(sidecarPath);
    if ((sidecarStat.mode & 0o444) !== 0o444) {
      throw new Error(
        `Compressed sidecar "${relFile}" must be world-readable (mode ${(sidecarStat.mode & 0o777).toString(8)}).`
      );
    }
    if (sidecarStat.mode & 0o111) {
      throw new Error(`Compressed sidecar "${relFile}" must not be executable.`);
    }

    let decompressed;
    try {
      decompressed = ALGORITHMS[algorithm].decompress(fs.readFileSync(sidecarPath));
    } catch (err) {
      throw new Error(`Compressed sidecar "${relFile}" is not valid ${algorithm} data: ${err.message}`);
    }
    if (sha256(decompressed) !== sha256(fs.readFileSync(originalPath))) {
      throw new Error(`Compressed sidecar "${relFile}" does not match the checksum of "${originalRel}".`);
    }
    checked.push(relFile);
  }

  return { valid: true, checked };
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}

// CLI invocation handling
if (process.argv[1] && process.argv[1].endsWith('compress-assets.js')) {
  const staticDir = process.argv[2] || 'storybook-static';
  const algorithms = process.argv[3] || process.env.SB_COMPRESS_ALGORITHMS || 'gzip,brotli';

  try {
    const summary = compressAssets(staticDir, { algorithms });
    const { checked } = validateCompressedSidecars(staticDir);
    const ratios = Object.entries(summary.compressedBytes)
      .map(([algorithm, bytes]) => `${algorithm} ${formatBytes(bytes)}`)
      .join(', ');
    console.log(
      `✅ Pre-compressed ${summary.compressed} assets (${formatBytes(summary.originalBytes)} → ${ratios || 'none'}); ` +
        `skipped ${summary.skipped}; verified ${checked.length} sidecars.`
    );
    process.exit(0);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
