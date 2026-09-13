import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveDeploymentTarget, validateConfig, validateRelativeDirectory } from './config.js';

const LOCK_NAME = '.storybook-pages-publish.lock';
const RETRIES = 3;

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data;
    });
    child.stderr.on('data', data => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} ${args.join(' ')} failed: ${stderr.trim()}`))
    );
  });
}

async function acquireLock(repo, timeoutMs = 120000) {
  const lock = path.join(repo, LOCK_NAME);
  const started = Date.now();
  while (true) {
    try {
      await fs.mkdir(lock);
      return async () => fs.rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() - started > timeoutMs) {
        throw new Error(`Unable to acquire Pages publisher lock: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

export async function replaceDirectory(repo, targetDirectory, sourceDirectory, managedDirectories = []) {
  validateRelativeDirectory(targetDirectory, 'target_directory', { allowEmpty: true });
  if (!targetDirectory) {
    const staging = `${repo}.staging-${process.pid}`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.cp(sourceDirectory, staging, { recursive: true, preserveTimestamps: true });
    for (const entry of await fs.readdir(repo)) {
      if (entry !== '.git' && entry !== LOCK_NAME && !managedDirectories.includes(entry))
        await fs.rm(path.join(repo, entry), { recursive: true, force: true });
    }
    for (const entry of await fs.readdir(staging)) {
      await fs.rename(path.join(staging, entry), path.join(repo, entry));
    }
    await fs.rm(staging, { recursive: true, force: true });
    return;
  }
  const target = path.join(repo, targetDirectory);
  const staging = `${target}.staging-${process.pid}`;
  const backup = `${target}.previous-${process.pid}`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.cp(sourceDirectory, staging, { recursive: true, preserveTimestamps: true });
  try {
    await fs.rename(target, backup);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fs.rename(staging, target);
    await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    try {
      await fs.rename(backup, target);
    } catch {
      /* preserve original error */
    }
    throw error;
  }
}

export async function publishDirectory({
  repo,
  source,
  branch = 'gh-pages',
  targetDirectory = '',
  managedDirectories = [],
  siteUrl = '',
  basePath = '',
  token,
  repository
}) {
  validateConfig({
    mode: 'directory',
    pages_branch: branch,
    target_directory: targetDirectory,
    managed_directories: managedDirectories,
    site_url: siteUrl,
    base_path: basePath
  });
  const release = await acquireLock(repo);
  try {
    let lastError;
    let pushed = false;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      try {
        await run('git', ['fetch', 'origin', branch], repo);
        await run('git', ['checkout', '-B', branch, `origin/${branch}`], repo);
        await replaceDirectory(repo, targetDirectory, source, managedDirectories);
        await run('git', ['add', '-A', '--', targetDirectory || '.'], repo);
        await run(
          'git',
          [
            '-c',
            'user.name=storybook-pages',
            '-c',
            'user.email=storybook-pages@users.noreply.github.com',
            'commit',
            '-m',
            `Deploy Storybook${targetDirectory ? ` to ${targetDirectory}` : ''}`
          ],
          repo
        ).catch(error => {
          if (!error.message.includes('nothing to commit')) throw error;
        });
        await run('git', ['push', 'origin', `HEAD:${branch}`], repo);
        pushed = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < RETRIES) await run('git', ['rebase', `origin/${branch}`], repo).catch(() => {});
      }
    }
    if (!pushed) throw new Error(`Pages directory publish failed after ${RETRIES} attempts: ${lastError.message}`);
    if (token && repository) {
      const response = await fetch(`https://api.github.com/repos/${repository}/pages/builds`, {
        method: 'POST',
        headers: {
          authorization: `token ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json'
        }
      });
      if (!response.ok) throw new Error(`Pages rebuild request failed (${response.status}) after successful push`);
    }
    const resolvedTarget = resolveDeploymentTarget({
      mode: 'directory',
      target_directory: targetDirectory,
      site_url: siteUrl,
      base_path: basePath
    });
    let finalUrl = resolvedTarget.url;
    if (!finalUrl && repository) {
      const [owner, repoName] = repository.split('/');
      if (owner && repoName) {
        const isUserPage = repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`;
        const baseSiteUrl = isUserPage ? `https://${owner}.github.io` : `https://${owner}.github.io/${repoName}`;
        finalUrl = `${baseSiteUrl}${resolvedTarget.basePath === '/' ? '' : resolvedTarget.basePath}`;
      }
    }
    return {
      branch,
      directory: targetDirectory,
      ...resolvedTarget,
      url: finalUrl
    };
  } finally {
    await release();
  }
}

if (process.argv[1]?.endsWith('publish-directory.js')) {
  publishDirectory({
    repo: process.env.PAGES_REPO || process.cwd(),
    source: process.env.SOURCE_DIRECTORY,
    branch: process.env.PAGES_BRANCH || 'gh-pages',
    targetDirectory: process.env.TARGET_DIRECTORY || '',
    siteUrl: process.env.SITE_URL || '',
    basePath: process.env.BASE_PATH || '',
    managedDirectories: process.env.MANAGED_DIRECTORIES
      ? process.env.MANAGED_DIRECTORIES.split(',')
          .map(value => value.trim())
          .filter(Boolean)
      : [],
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY
  })
    .then(result => {
      console.log(JSON.stringify(result));
      if (process.env.GITHUB_OUTPUT) {
        const output = `page_url=${result.url}\nbase_path=${result.basePath}\n`;
        return fs.appendFile(process.env.GITHUB_OUTPUT, output);
      }
    })
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}
