import fs from 'node:fs';
import path from 'node:path';

/**
 * Estimates text width in pixels for standard Verdana 11px font rendering.
 */
export function estimateTextWidth(text) {
  if (!text) return 0;
  const str = String(text);
  let width = 0;
  for (const char of str) {
    if ("ilI1.,:;!|'".includes(char)) {
      width += 4.5;
    } else if ('mwMW@%#_'.includes(char)) {
      width += 10.5;
    } else if ('abcdeghknopqrstuvxyz023456789$-+/=?'.includes(char)) {
      width += 7.2;
    } else if ('ABCDEFGHJKLMNOPQRSTUVXYZ&'.includes(char)) {
      width += 8.2;
    } else {
      width += 6.5;
    }
  }
  return Math.round(width);
}

/**
 * Escapes XML special characters.
 */
export function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalizes hex or standard color names to clean CSS/SVG hex/color string.
 */
export function normalizeColor(color) {
  if (!color) return '#007ec6';
  const c = String(color).trim();
  if (/^[0-9a-fA-F]{3,8}$/.test(c)) return `#${c}`;
  return c;
}

/**
 * Generates a standard flat Shields-style SVG badge.
 */
export function renderBadgeSvg({
  label = 'badge',
  message = 'ok',
  labelColor = '#555555',
  messageColor = '#ff4785',
  labelPadding = 12,
  messagePadding = 12
} = {}) {
  const cleanLabel = escapeXml(label);
  const cleanMessage = escapeXml(message);

  const labelTextWidth = estimateTextWidth(label);
  const messageTextWidth = estimateTextWidth(message);

  const leftWidth = labelTextWidth + labelPadding * 2;
  const rightWidth = messageTextWidth + messagePadding * 2;
  const totalWidth = leftWidth + rightWidth;

  const leftTextX = Math.round((leftWidth / 2) * 10);
  const rightTextX = Math.round((leftWidth + rightWidth / 2) * 10);
  const leftTextLength = labelTextWidth * 10;
  const rightTextLength = messageTextWidth * 10;

  const bgLeft = normalizeColor(labelColor);
  const bgRight = normalizeColor(messageColor);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${cleanLabel}: ${cleanMessage}">`,
    `  <title>${cleanLabel}: ${cleanMessage}</title>`,
    '  <linearGradient id="s" x2="0" y2="100%">',
    '    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>',
    '    <stop offset="1" stop-opacity=".1"/>',
    '  </linearGradient>',
    '  <clipPath id="r">',
    `    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>`,
    '  </clipPath>',
    '  <g clip-path="url(#r)">',
    `    <rect width="${leftWidth}" height="20" fill="${bgLeft}"/>`,
    `    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${bgRight}"/>`,
    `    <rect width="${totalWidth}" height="20" fill="url(#s)"/>`,
    '  </g>',
    '  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">',
    `    <text aria-hidden="true" x="${leftTextX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${leftTextLength}">${cleanLabel}</text>`,
    `    <text x="${leftTextX}" y="140" transform="scale(.1)" fill="#fff" textLength="${leftTextLength}">${cleanLabel}</text>`,
    `    <text aria-hidden="true" x="${rightTextX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${rightTextLength}">${cleanMessage}</text>`,
    `    <text x="${rightTextX}" y="140" transform="scale(.1)" fill="#fff" textLength="${rightTextLength}">${cleanMessage}</text>`,
    '  </g>',
    '</svg>'
  ].join('\n');
}

/**
 * Reads Storybook version from package.json if available.
 */
export function extractStorybookVersion(workspaceRoot = process.cwd()) {
  const candidatePkgPaths = [path.join(workspaceRoot, 'package.json'), path.join(workspaceRoot, '..', 'package.json')];

  for (const pkgPath of candidatePkgPaths) {
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = { ...pkg.devDependencies, ...pkg.dependencies };
        const sbKey = Object.keys(deps).find(k => k === 'storybook' || k.startsWith('@storybook/'));
        if (sbKey && deps[sbKey]) {
          const rawVersion = deps[sbKey].replace(/^[\^~>=<]+/, '');
          return rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
        }
      } catch {
        // Ignore JSON read errors
      }
    }
  }
  return 'deployed';
}

/**
 * Extracts story counts and component counts from static Storybook output.
 */
export function extractStorybookMetrics(staticDir, workspaceRoot = process.cwd()) {
  let storiesCount = 0;
  let componentsCount = 0;
  let docsCount = 0;
  let hasStoriesData = false;

  const indexJsonPath = path.join(staticDir, 'index.json');
  const storiesJsonPath = path.join(staticDir, 'stories.json');

  if (fs.existsSync(indexJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(indexJsonPath, 'utf8'));
      const entries = data.entries || data.stories || {};
      const components = new Set();

      for (const entry of Object.values(entries)) {
        if (!entry) continue;
        if (entry.type === 'docs') {
          docsCount++;
        } else {
          storiesCount++;
        }
        if (entry.title) {
          components.add(entry.title);
        } else if (entry.id) {
          const parts = entry.id.split('--');
          components.add(parts[0]);
        }
      }

      componentsCount = components.size;
      hasStoriesData = true;
    } catch {
      // Fallback
    }
  } else if (fs.existsSync(storiesJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(storiesJsonPath, 'utf8'));
      const stories = data.stories || {};
      const components = new Set();

      for (const story of Object.values(stories)) {
        if (!story) continue;
        storiesCount++;
        if (story.title) {
          components.add(story.title);
        } else if (story.id) {
          const parts = story.id.split('--');
          components.add(parts[0]);
        }
      }

      componentsCount = components.size;
      hasStoriesData = true;
    } catch {
      // Fallback
    }
  }

  const storybookVersion = extractStorybookVersion(workspaceRoot);

  return {
    storiesCount,
    componentsCount,
    docsCount,
    storybookVersion,
    hasStoriesData
  };
}

/**
 * Builds markdown badge snippets for documentation and step summaries.
 */
export function buildBadgeMarkdown({ badgesUrl, siteUrl }) {
  const cleanBadgesUrl = (badgesUrl || '').replace(/\/$/, '');
  const cleanSiteUrl = (siteUrl || cleanBadgesUrl || '#').replace(/\/$/, '');

  return [
    `[![Storybook](${cleanBadgesUrl}/storybook.svg)](${cleanSiteUrl})`,
    `[![Stories](${cleanBadgesUrl}/stories.svg)](${cleanSiteUrl})`,
    `[![Components](${cleanBadgesUrl}/components.svg)](${cleanSiteUrl})`
  ].join(' ');
}

/**
 * Generates badge SVG files and JSON endpoint files inside the static output directory.
 */
export function generateBadges({
  staticDir,
  workspaceRoot = process.cwd(),
  badgesDirectory = 'badges',
  siteUrl = '',
  basePath = ''
} = {}) {
  if (!staticDir || typeof staticDir !== 'string') {
    throw new Error('generateBadges requires a valid staticDir');
  }

  const staticAbs = path.resolve(staticDir);
  if (!fs.existsSync(staticAbs)) {
    throw new Error(`Static directory "${staticAbs}" does not exist`);
  }

  const badgesDirName = badgesDirectory && badgesDirectory !== '.' ? badgesDirectory : 'badges';
  const outDir = path.resolve(staticAbs, badgesDirName);

  // Path containment guard
  const relative = path.relative(staticAbs, outDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Badges directory "${badgesDirectory}" escapes static output directory "${staticAbs}"`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const metrics = extractStorybookMetrics(staticAbs, workspaceRoot);

  const storybookMsg = metrics.storybookVersion || 'deployed';
  const storiesMsg = metrics.hasStoriesData ? String(metrics.storiesCount) : 'active';
  const componentsMsg = metrics.hasStoriesData ? String(metrics.componentsCount) : 'active';

  // 1. Generate standard SVGs
  const svgStorybook = renderBadgeSvg({
    label: 'storybook',
    message: storybookMsg,
    labelColor: '#555555',
    messageColor: '#ff4785'
  });

  const svgStories = renderBadgeSvg({
    label: 'stories',
    message: storiesMsg,
    labelColor: '#555555',
    messageColor: '#0288d1'
  });

  const svgComponents = renderBadgeSvg({
    label: 'components',
    message: componentsMsg,
    labelColor: '#555555',
    messageColor: '#4caf50'
  });

  const svgStatus = renderBadgeSvg({
    label: 'storybook',
    message: 'deployed',
    labelColor: '#555555',
    messageColor: '#4caf50'
  });

  fs.writeFileSync(path.join(outDir, 'storybook.svg'), svgStorybook, 'utf8');
  fs.writeFileSync(path.join(outDir, 'stories.svg'), svgStories, 'utf8');
  fs.writeFileSync(path.join(outDir, 'components.svg'), svgComponents, 'utf8');
  fs.writeFileSync(path.join(outDir, 'status.svg'), svgStatus, 'utf8');

  // 2. Generate Shields.io-compatible JSON endpoints
  const jsonStories = {
    schemaVersion: 1,
    label: 'stories',
    message: storiesMsg,
    color: '0288d1'
  };

  const jsonComponents = {
    schemaVersion: 1,
    label: 'components',
    message: componentsMsg,
    color: '4caf50'
  };

  const jsonStorybook = {
    schemaVersion: 1,
    label: 'storybook',
    message: storybookMsg,
    color: 'ff4785'
  };

  const jsonOverview = {
    schemaVersion: 1,
    storybookVersion: storybookMsg,
    storiesCount: metrics.storiesCount,
    componentsCount: metrics.componentsCount,
    docsCount: metrics.docsCount,
    hasStoriesData: metrics.hasStoriesData,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(outDir, 'stories.json'), JSON.stringify(jsonStories, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'components.json'), JSON.stringify(jsonComponents, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'storybook.json'), JSON.stringify(jsonStorybook, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'overview.json'), JSON.stringify(jsonOverview, null, 2), 'utf8');

  // Calculate full URL for markdown snippets
  let derivedBadgesUrl = '';
  if (siteUrl) {
    const cleanSite = siteUrl.replace(/\/$/, '');
    const cleanBase = basePath ? `/${basePath.replace(/^\/|\/$/g, '')}` : '';
    derivedBadgesUrl = `${cleanSite}${cleanBase}/${badgesDirName}`;
  } else {
    derivedBadgesUrl = badgesDirName;
  }

  const markdownSnippets = buildBadgeMarkdown({
    badgesUrl: derivedBadgesUrl,
    siteUrl: siteUrl ? `${siteUrl.replace(/\/$/, '')}${basePath ? `/${basePath.replace(/^\/|\/$/g, '')}` : ''}` : ''
  });

  return {
    metrics,
    outDir,
    badgesDirectory: badgesDirName,
    derivedBadgesUrl,
    markdownSnippets,
    filesGenerated: [
      'storybook.svg',
      'stories.svg',
      'components.svg',
      'status.svg',
      'stories.json',
      'components.json',
      'storybook.json',
      'overview.json'
    ]
  };
}

if (process.argv[1] && process.argv[1].endsWith('generate-badges.js')) {
  const staticDir = process.argv[2] || process.env.SB_PATH || 'storybook-static';
  const workspaceRoot = process.argv[3] || process.env.WORKSPACE_ROOT || process.cwd();
  const badgesDir = process.env.SB_BADGES_DIRECTORY || 'badges';
  const siteUrl = process.env.SB_SITE_URL || '';
  const basePath = process.env.SB_BASE_PATH || '';

  try {
    const result = generateBadges({
      staticDir,
      workspaceRoot,
      badgesDirectory: badgesDir,
      siteUrl,
      basePath
    });

    console.log(`✅ Storybook badges generated in "${result.outDir}":`);
    console.log(`   • Stories: ${result.metrics.storiesCount}`);
    console.log(`   • Components: ${result.metrics.componentsCount}`);
    console.log(`   • Storybook: ${result.metrics.storybookVersion}`);
    console.log('');
    console.log('Markdown snippets:');
    console.log(result.markdownSnippets);

    if (process.env.GITHUB_STEP_SUMMARY) {
      const summaryContent = [
        '',
        '### 🏷️ Storybook Badges',
        '',
        result.markdownSnippets,
        '',
        '| Metric | Value |',
        '|---|---|',
        `| **Stories** | \`${result.metrics.storiesCount}\` |`,
        `| **Components** | \`${result.metrics.componentsCount}\` |`,
        `| **Storybook Version** | \`${result.metrics.storybookVersion}\` |`,
        ''
      ].join('\n');
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryContent);
    }
  } catch (err) {
    console.error('Badge generation error:', err.message);
    process.exit(1);
  }
}
