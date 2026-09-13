import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const LOCK_NAME = '.storybook-pages-write.lock';
const RETRIES = 3;

export function run(command, args, cwd) {
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

export async function acquireLock(repo, timeoutMs = 120000) {
  const lock = path.join(repo, LOCK_NAME);
  const started = Date.now();
  while (true) {
    try {
      await fs.mkdir(lock);
      return async () => fs.rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() - started > timeoutMs) {
        throw new Error(`Unable to acquire Pages branch write lock: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

export async function requestPagesRebuild({ token, repository }) {
  if (!token || !repository) return;
  const response = await fetch(`https://api.github.com/repos/${repository}/pages/builds`, {
    method: 'POST',
    headers: {
      authorization: `token ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json'
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Pages rebuild request failed (${response.status}) after a successful push: ${text}`);
  }
}

/**
 * Serializes a mutate-commit-push cycle against a Pages branch, with bounded
 * fetch/rebase/push retries so concurrent writers (publish, cleanup,
 * janitor) never silently clobber each other's changes. `mutate` receives
 * the local repo path and must return `true` if it changed anything.
 */
export async function withSerializedBranchWrite({ repo, branch, mutate, commitMessage }) {
  const release = await acquireLock(repo);
  try {
    let lastError;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      try {
        await run('git', ['fetch', 'origin', branch], repo);
        await run('git', ['checkout', '-B', branch, `origin/${branch}`], repo);
        const changed = await mutate(repo);
        if (!changed) return { changed: false };
        await run('git', ['add', '-A'], repo);
        let committed = true;
        await run(
          'git',
          [
            '-c',
            'user.name=storybook-pages',
            '-c',
            'user.email=storybook-pages@users.noreply.github.com',
            'commit',
            '-m',
            commitMessage
          ],
          repo
        ).catch(error => {
          if (error.message.includes('nothing to commit')) {
            committed = false;
            return;
          }
          throw error;
        });
        if (!committed) return { changed: false };
        await run('git', ['push', 'origin', `HEAD:${branch}`], repo);
        return { changed: true };
      } catch (error) {
        lastError = error;
        if (attempt + 1 < RETRIES) await run('git', ['rebase', `origin/${branch}`], repo).catch(() => {});
      }
    }
    throw new Error(`Pages branch write failed after ${RETRIES} attempts: ${lastError.message}`);
  } finally {
    await release();
  }
}
