import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './git-branch-writer.js';

// Every generated file carries this marker so the generator only ever
// overwrites its own output, never a hand-written or Storybook-shipped
// `index.html`/`404.html` that happens to live at the same path.
export const PORTAL_MARKER = '<!-- storybook-pages-portal -->';
export const PORTAL_DIRECTORY = 'portal';
export const PORTAL_MANIFEST_FILENAME = 'environments.json';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PREVIEW_DIR_PATTERN = /^pr-(\d+)$/;
const VERSION_DIR_PATTERN = /^v\d+(?:[._-][0-9A-Za-z]+)*$/;
const MAIN_DIR_NAMES = new Set(['main', 'master', 'production', 'latest']);
const STORYBOOK_ENTRY_FILE = 'iframe.html';
const MAX_SCAN_DEPTH = 2;
const KIND_ORDER = { main: 0, environment: 1, version: 2, preview: 3 };

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// JSON embedded in an inline <script> must never be able to close the tag
// or open an HTML comment, whatever a PR title contains.
function safeJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(target) {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isOwnedOrMissing(content) {
  return content === null || content.includes(PORTAL_MARKER);
}

/**
 * Classifies a Storybook directory on the Pages branch by its relative path.
 * Pure so the naming rules can be exercised without a filesystem.
 */
export function classifyEnvironment(relativePath) {
  if (!relativePath) return { kind: 'main', name: 'main', prNumber: null };
  const name = relativePath.split('/').pop();
  const preview = PREVIEW_DIR_PATTERN.exec(name);
  if (preview) return { kind: 'preview', name, prNumber: Number(preview[1]) };
  if (VERSION_DIR_PATTERN.test(name)) return { kind: 'version', name, prNumber: null };
  if (MAIN_DIR_NAMES.has(name.toLowerCase())) return { kind: 'main', name, prNumber: null };
  return { kind: 'environment', name, prNumber: null };
}

/**
 * Finds every published Storybook on a checked-out Pages branch. A directory
 * counts as a Storybook when it contains `iframe.html` (present in every
 * Storybook static build), which keeps asset, badge, and stats directories
 * out of the catalog without a hard-coded deny list. The scan never descends
 * into a Storybook or into hidden/portal directories.
 */
export async function findStorybookDirectories(repo, { maxDepth = MAX_SCAN_DEPTH } = {}) {
  const found = [];
  if (await exists(path.join(repo, STORYBOOK_ENTRY_FILE))) found.push('');

  async function visit(relative, depth) {
    let dirents;
    try {
      dirents = await fs.readdir(path.join(repo, relative), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
      if (!relative && dirent.name === PORTAL_DIRECTORY) continue;
      const child = relative ? path.posix.join(relative, dirent.name) : dirent.name;
      if (await exists(path.join(repo, child, STORYBOOK_ENTRY_FILE))) {
        found.push(child);
      } else if (depth < maxDepth) {
        await visit(child, depth + 1);
      }
    }
  }

  await visit('', 1);
  return found.sort();
}

async function lastCommitForPath(repo, relativePath) {
  try {
    const output = await run('git', ['log', '-1', '--format=%ct', '--', relativePath], repo);
    if (!output) return null;
    return Number(output) * 1000;
  } catch {
    return null;
  }
}

/**
 * Best-effort lookup of open pull request titles/authors so preview cards
 * can show more than a number. Any API failure degrades to an empty map;
 * the portal must never block or fail a publish/cleanup/janitor run.
 */
export async function fetchOpenPullRequests({ token, repository, fetchImpl = fetch } = {}) {
  const pulls = new Map();
  if (!token || !repository) return pulls;
  try {
    for (let page = 1; page <= 10; page += 1) {
      const response = await fetchImpl(
        `https://api.github.com/repos/${repository}/pulls?state=open&per_page=100&page=${page}`,
        { headers: { authorization: `token ${token}`, accept: 'application/vnd.github+json' } }
      );
      if (!response.ok) return pulls;
      const batch = await response.json();
      if (!Array.isArray(batch)) return pulls;
      for (const pull of batch) {
        pulls.set(Number(pull.number), {
          title: typeof pull.title === 'string' ? pull.title : '',
          author: typeof pull.user?.login === 'string' ? pull.user.login : '',
          url: typeof pull.html_url === 'string' ? pull.html_url : ''
        });
      }
      if (batch.length < 100) break;
    }
  } catch {
    // Network failure: fall back to whatever was collected.
  }
  return pulls;
}

/**
 * Pure status derivation for a catalog entry. Previews within the janitor's
 * warning window are flagged "Expiring Soon" so stakeholders know a link is
 * about to disappear.
 */
export function resolveStatus({ kind, lastUpdatedMs, now, retentionDays = 30, warningDays = 3 }) {
  if (kind === 'main') return 'Main';
  if (kind === 'version') return 'Release';
  if (kind !== 'preview') return 'Active';
  const retentionMs = Number(retentionDays) > 0 ? Number(retentionDays) * DAY_MS : 0;
  const warningMs = Number(warningDays) > 0 ? Number(warningDays) * DAY_MS : 0;
  if (retentionMs && warningMs && typeof lastUpdatedMs === 'number' && now - lastUpdatedMs >= retentionMs - warningMs) {
    return 'Expiring Soon';
  }
  return 'Active';
}

function compareEnvironments(a, b) {
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (byKind) return byKind;
  if (a.kind === 'preview') return b.prNumber - a.prNumber;
  if (a.kind === 'version') return b.name.localeCompare(a.name, 'en', { numeric: true });
  return a.path.localeCompare(b.path);
}

/**
 * Builds the sorted environment catalog from a checked-out Pages branch.
 */
export async function collectEnvironments(
  repo,
  { pullRequests = new Map(), now = Date.now(), retentionDays = 30, warningDays = 3 } = {}
) {
  const directories = await findStorybookDirectories(repo);
  const environments = [];
  for (const directory of directories) {
    const { kind, name, prNumber } = classifyEnvironment(directory);
    // Root Storybooks are dated by their entry file; `git log -- .` would
    // report the latest commit to *any* directory on the branch.
    const lastUpdatedMs =
      (await lastCommitForPath(repo, directory || STORYBOOK_ENTRY_FILE)) ??
      // Written in the current mutate and not committed yet.
      now;
    const pull = prNumber !== null ? pullRequests.get(prNumber) : undefined;
    environments.push({
      path: directory,
      name,
      kind,
      prNumber,
      title: pull?.title || (prNumber !== null ? `PR #${prNumber}` : directory ? name : 'Main Storybook'),
      author: pull?.author || '',
      pullRequestUrl: pull?.url || '',
      // Minute precision: a directory written in this mutate is dated `now`,
      // while later sweeps read the commit time; rounding keeps the two in
      // agreement so a follow-up janitor run does not commit a no-op refresh.
      lastUpdated: new Date(Math.floor(lastUpdatedMs / MINUTE_MS) * MINUTE_MS).toISOString(),
      status: resolveStatus({ kind, lastUpdatedMs, now, retentionDays, warningDays })
    });
  }
  return environments.sort(compareEnvironments);
}

/**
 * Resolves the absolute site root path (always with leading and trailing
 * slash) that 404.html uses to build links, since GitHub Pages serves it
 * from whatever missing URL was requested.
 */
export function resolveSiteRoot({ siteUrl = '', repository = '' } = {}) {
  if (siteUrl) {
    try {
      const pathname = new URL(siteUrl).pathname.replace(/\/+$/, '');
      return `${pathname}/`;
    } catch {
      throw new Error(`site_url must be a valid URL to generate the portal: "${siteUrl}"`);
    }
  }
  const [owner, repoName] = String(repository).split('/');
  if (!owner || !repoName || repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`) return '/';
  return `/${repoName}/`;
}

export function defaultPortalTitle(repository = '') {
  const repoName = String(repository).split('/')[1];
  return `${repoName || 'Storybook'} Storybook Environments`;
}

const STATUS_CLASS = {
  Main: 'main',
  Release: 'release',
  Active: 'active',
  'Expiring Soon': 'expiring'
};

const STYLES = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1d2129;--muted:#5b6472;--border:#dde1e7;--accent:#ff4785;--main:#1e6fd9;--release:#7a3fd1;--active:#1a8f4c;--expiring:#b35c00;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--card:#1d2026;--text:#e8eaed;--muted:#9aa3ae;--border:#2e333b;--main:#6ea8ff;--release:#b48cff;--active:#4cc38a;--expiring:#f0a24b;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 48px}
h1{font-size:1.6rem;margin:0 0 4px}
.lead{color:var(--muted);margin:0 0 24px}
.search{width:100%;max-width:420px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font:inherit;margin-bottom:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;list-style:none;margin:0;padding:0}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;min-width:0}
.card h2{font-size:1.05rem;margin:0;overflow-wrap:anywhere}
.card a.open{color:var(--accent);font-weight:600;text-decoration:none}
.card a.open:hover{text-decoration:underline}
.meta{color:var(--muted);font-size:.85rem;margin:0;overflow-wrap:anywhere}
.meta a{color:inherit}
.badge{align-self:flex-start;font-size:.75rem;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
.badge.main{color:var(--main)}.badge.release{color:var(--release)}.badge.active{color:var(--active)}.badge.expiring{color:var(--expiring)}
.empty{color:var(--muted)}
footer{color:var(--muted);font-size:.8rem;margin-top:32px}
`;

function renderCard(environment, hrefPrefix) {
  const href = `${hrefPrefix}${environment.path ? `${environment.path}/` : ''}`;
  const statusClass = STATUS_CLASS[environment.status] || 'active';
  const searchText = [environment.title, environment.path, environment.author, environment.status].join(' ');
  const author = environment.author ? ` · by ${escapeHtml(environment.author)}` : '';
  const pullRequest = environment.pullRequestUrl
    ? `<p class="meta"><a href="${escapeHtml(environment.pullRequestUrl)}">Pull request #${environment.prNumber}</a></p>`
    : '';
  return `<li class="card" data-search="${escapeHtml(searchText.toLowerCase())}">
<span class="badge ${statusClass}">${escapeHtml(environment.status)}</span>
<h2>${escapeHtml(environment.title)}</h2>
<p class="meta">/${escapeHtml(environment.path)}</p>
<p class="meta">Updated <time datetime="${escapeHtml(environment.lastUpdated)}">${escapeHtml(environment.lastUpdated.slice(0, 10))}</time>${author}</p>
${pullRequest}<a class="open" href="${escapeHtml(href)}">Open Storybook →</a>
</li>`;
}

const FILTER_SCRIPT = `(function(){var input=document.getElementById('filter');if(!input)return;input.addEventListener('input',function(){var q=input.value.trim().toLowerCase();document.querySelectorAll('.card').forEach(function(card){card.hidden=q!==''&&card.getAttribute('data-search').indexOf(q)===-1;});});})();`;

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'";

function renderDocument({ title, heading, lead, body, script }) {
  return `<!doctype html>
${PORTAL_MARKER}
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p class="lead">${lead}</p>
${body}
<footer>Generated by storybook-github-pages</footer>
</main>
<script>${script}</script>
</body>
</html>
`;
}

function renderCatalog(environments, hrefPrefix) {
  if (environments.length === 0) {
    return '<p class="empty">No Storybook environments are published yet.</p>';
  }
  return `<input id="filter" class="search" type="search" placeholder="Filter environments…" aria-label="Filter environments">
<ul class="grid">
${environments.map(environment => renderCard(environment, hrefPrefix)).join('\n')}
</ul>`;
}

/**
 * Renders the landing portal. `hrefPrefix` is relative so the page works on
 * project pages, user pages, and custom domains alike.
 */
export function renderPortalHtml({ title, environments, hrefPrefix = '' }) {
  const count = environments.length;
  return renderDocument({
    title,
    heading: title,
    lead: `${count} published Storybook environment${count === 1 ? '' : 's'}.`,
    body: renderCatalog(environments, hrefPrefix),
    script: FILTER_SCRIPT
  });
}

/**
 * Client-side 404 resolution. Given the requested path relative to the site
 * root, it either (a) redirects a shortcut such as `/pr-12/` to the single
 * environment named `pr-12` (e.g. `/pr-preview/pr-12/`), keeping any deeper
 * path, query, and hash; or (b) points at the environment the missing file
 * belongs to. Exported as source so tests can evaluate it directly.
 */
export const RESOLVE_404_SOURCE = `function resolveNotFound(relativePath, environments){
  var segments=relativePath.split('/').filter(Boolean);
  if(segments.length===0)return {type:'none'};
  var inside=null;
  environments.forEach(function(env){
    if(!env.path)return;
    var envSegments=env.path.split('/');
    var matches=envSegments.every(function(part,i){return segments[i]===part;});
    if(matches&&(!inside||envSegments.length>inside.path.split('/').length))inside=env;
  });
  if(inside)return {type:'inside',environment:inside};
  var named=environments.filter(function(env){return env.path&&env.name===segments[0];});
  if(named.length===1){
    return {type:'redirect',environment:named[0],target:named[0].path+'/'+segments.slice(1).join('/')};
  }
  return {type:'none'};
}`;

function render404Script({ siteRoot, environments }) {
  const catalog = environments.map(({ path: envPath, name, title }) => ({ path: envPath, name, title }));
  return `(function(){
var SITE_ROOT=${safeJson(siteRoot)};
var ENVIRONMENTS=${safeJson(catalog)};
${RESOLVE_404_SOURCE}
var pathname=window.location.pathname;
var relative=pathname.indexOf(SITE_ROOT)===0?pathname.slice(SITE_ROOT.length):pathname.replace(/^\\/+/, '');
var result=resolveNotFound(relative,ENVIRONMENTS);
var notice=document.getElementById('notice');
if(result.type==='redirect'){
  window.location.replace(SITE_ROOT+result.target+window.location.search+window.location.hash);
  return;
}
if(result.type==='inside'&&notice){
  var link=document.createElement('a');
  link.className='open';
  link.href=SITE_ROOT+result.environment.path+'/';
  link.textContent='Open '+result.environment.title+' →';
  notice.textContent='This page does not exist in the "'+result.environment.path+'" environment. ';
  notice.appendChild(link);
}
document.querySelectorAll('.card a.open').forEach(function(a){a.setAttribute('href',SITE_ROOT+a.getAttribute('href'));});
${FILTER_SCRIPT}
})();`;
}

export function render404Html({ title, environments, siteRoot = '/' }) {
  return renderDocument({
    title: `Page not found · ${title}`,
    heading: 'Page not found',
    lead: `<span id="notice">The page you requested does not exist. Pick one of the available environments below.</span>`,
    // Links are emitted root-relative here and made absolute by the script,
    // so they still resolve when GitHub Pages serves this from a deep path.
    body: renderCatalog(environments, ''),
    script: render404Script({ siteRoot, environments })
  });
}

/**
 * Regenerates the portal on a checked-out Pages branch working tree. The
 * landing page goes to the branch root when the root is free (no
 * `index.html`, or one we generated), otherwise to `portal/index.html` so a
 * root Storybook is never replaced. `404.html` is only written at the root
 * (the only place GitHub Pages reads it) and only if it is missing or ours.
 * Must run inside a serialized branch write so it sees the final tree.
 */
export async function writePortal(
  repo,
  {
    title = '',
    repository = '',
    siteUrl = '',
    pullRequests = new Map(),
    retentionDays = 30,
    warningDays = 3,
    now = Date.now()
  } = {}
) {
  const portalTitle = title || defaultPortalTitle(repository);
  const environments = await collectEnvironments(repo, { pullRequests, now, retentionDays, warningDays });
  const rootIndexPath = path.join(repo, 'index.html');
  const portalAtRoot = isOwnedOrMissing(await readIfExists(rootIndexPath));
  const portalDir = portalAtRoot ? repo : path.join(repo, PORTAL_DIRECTORY);
  if (portalAtRoot) {
    // The root was reclaimed by the portal; drop a stale nested copy.
    await fs.rm(path.join(repo, PORTAL_DIRECTORY), { recursive: true, force: true });
  }
  await fs.mkdir(portalDir, { recursive: true });

  const written = [];
  await fs.writeFile(
    path.join(portalDir, 'index.html'),
    renderPortalHtml({ title: portalTitle, environments, hrefPrefix: portalAtRoot ? '' : '../' }),
    'utf8'
  );
  written.push(portalAtRoot ? 'index.html' : `${PORTAL_DIRECTORY}/index.html`);
  await fs.writeFile(
    path.join(portalDir, PORTAL_MANIFEST_FILENAME),
    `${JSON.stringify({ title: portalTitle, environments }, null, 2)}\n`,
    'utf8'
  );
  written.push(portalAtRoot ? PORTAL_MANIFEST_FILENAME : `${PORTAL_DIRECTORY}/${PORTAL_MANIFEST_FILENAME}`);

  const notFoundPath = path.join(repo, '404.html');
  if (isOwnedOrMissing(await readIfExists(notFoundPath))) {
    await fs.writeFile(
      notFoundPath,
      render404Html({ title: portalTitle, environments, siteRoot: resolveSiteRoot({ siteUrl, repository }) }),
      'utf8'
    );
    written.push('404.html');
  }
  return { environments, written, portalPath: portalAtRoot ? '' : PORTAL_DIRECTORY };
}

/**
 * Reads portal options from the environment variables shared by the
 * publisher, cleanup, and janitor composite actions.
 */
export function portalOptionsFromEnv(env = process.env) {
  return {
    enabled: env.GENERATE_PORTAL === 'true',
    title: env.PORTAL_TITLE || '',
    siteUrl: env.SITE_URL || '',
    retentionDays:
      env.PREVIEW_RETENTION_DAYS !== undefined && env.PREVIEW_RETENTION_DAYS !== ''
        ? Number(env.PREVIEW_RETENTION_DAYS)
        : 30,
    warningDays:
      env.WARNING_DAYS_BEFORE_CLEANUP !== undefined && env.WARNING_DAYS_BEFORE_CLEANUP !== ''
        ? Number(env.WARNING_DAYS_BEFORE_CLEANUP)
        : 3
  };
}
