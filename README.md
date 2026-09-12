# storybook-github-pages

[![CI](https://github.com/Archetipo95/storybook-github-pages/actions/workflows/ci.yml/badge.svg)](https://github.com/Archetipo95/storybook-github-pages/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Security-hardened GitHub Action and reusable workflows for building, validating, and deploying static Storybook builds to GitHub Pages.

---

## Features

- **Security First**: Job-scoped least privilege permissions (`contents: read`, `pages: write`, `id-token: write`).
- **Artifact Validation**: Validates existence, path containment, non-empty static content, and symlink safety before upload.
- **Bitovi Compatible**: Preserves interface compatibility with `bitovi/github-actions-storybook-to-github-pages` inputs (`checkout`, `path`, `install_command`, `build_command`) for zero-friction migration.
- **Reusable Workflow & Composite Action**: Offers a primary reusable workflow for turnkey pipelines and a composite action for existing pipelines.
- **Pinned Dependencies**: All third-party GitHub Actions are pinned to full 40-character commit SHAs.
- **Directory Deployments**: Trusted publishers atomically update a directory on a Pages branch while preserving other environments.
- **PR Preview Lifecycle**: Unprivileged per-PR builds, a trusted `workflow_run` publisher with strict provenance/stale-run validation, an idempotent bot preview comment, metadata-only close cleanup, and a scheduled/manual retention janitor.

---

## Quickstart

### Option 1: Reusable Workflow (Recommended)

Call the reusable workflow directly in your repository `.github/workflows/deploy-storybook.yml`:

```yaml
name: Deploy Storybook

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy-storybook:
    uses: Archetipo95/storybook-github-pages/.github/workflows/deploy-storybook.yml@main
    with:
      path: 'storybook-static'
      package_manager: 'npm'
      build_command: 'npm run build-storybook'
```

### Option 2: Composite Action

Use the composite action in your own custom job:

```yaml
name: Custom Deploy Pipeline

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Build and Deploy Storybook
        uses: Archetipo95/storybook-github-pages@main
        with:
          path: 'storybook-static'
          build_command: 'npm run build-storybook'
```

---

## Inputs & Outputs

### Action / Workflow Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | `string` | `storybook-static` | Path to the directory containing built static Storybook files |
| `package_manager` | `string` | `npm` | Package manager to use (`npm`, `yarn`, `pnpm`, `bun`) |
| `checkout` | `string` | `'true'` | Whether to check out the repository automatically (Action only) |
| `install_command` | `string` | `''` | Bitovi compatibility / custom dependency installation command |
| `build_command` | `string` | `''` | Bitovi compatibility / custom Storybook build command |
| `custom_install_command` | `string` | `''` | Alias for `install_command` |
| `custom_build_command` | `string` | `''` | Alias for `build_command` |
| `publish` | `string` | `'true'` | Whether to upload and deploy the Pages artifact |
| `artifact_name` | `string` | `github-pages` | GitHub Pages artifact name |
| `environment` | `string` | `github-pages` | GitHub Pages deployment environment name |
| `mode` | `string` | `artifact` | `artifact` or trusted branch-backed `directory` |
| `pages_branch` | `string` | `gh-pages` | Pages branch used by directory mode |
| `target_directory` | `string` | `''` | Relative directory to replace; empty means the production root |
| `site_url` | `string` | `''` | Canonical site URL used for deployment metadata |
| `base_path` | `string` | `''` | URL base path; derived from `target_directory` when empty |
| `preview_root` | `string` | `pr-preview` | Root directory (on the Pages branch) under which PR previews are published, as `<preview_root>/pr-<number>` |
| `preview_retention_days` | `number` | `30` | Days an *open* PR's preview may remain before the janitor prunes it; closed-PR previews are always eligible for removal regardless of age |

### Outputs

| Output | Description |
|--------|-------------|
| `page_url` | The URL of the published GitHub Pages site |
| `status` | Status of the deployment (`success`, `skipped`, `failed`) |
| `deployment_id` | The GitHub Pages deployment ID |

---

## Bitovi Migration Guide

`storybook-github-pages` maintains input compatibility with `bitovi/github-actions-storybook-to-github-pages`:

| Bitovi Input | `storybook-github-pages` Equivalent | Notes |
|--------------|------------------------------------|-------|
| `path` | `path` | Identical default (`storybook-static`) |
| `checkout` | `checkout` | Identical boolean string behavior |
| `install_command` | `install_command` / `custom_install_command` | Fully supported |
| `build_command` | `build_command` / `custom_build_command` | Fully supported |

**Migrating to `storybook-github-pages`:**
Simply replace `bitovi/github-actions-storybook-to-github-pages@v1.0.3` with `Archetipo95/storybook-github-pages@main` in your workflow.

---

## Security & Required Permissions

Deployment requires configuring GitHub Pages settings in your repository (`Settings > Pages > Source: GitHub Actions`).

The required workflow job permissions are:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

- `contents: read`: Fetch source repository files.
- `pages: write`: Upload and deploy to GitHub Pages.
- `id-token: write`: Mint OpenID Connect (OIDC) JWT tokens for authenticated Pages deployment.

For reusable workflow callers, artifact mode requires `contents: read`, `pages: write`, and `id-token: write`. Directory mode requires `contents: write` and `pages: write` because the trusted publisher pushes the Pages branch and explicitly requests a Pages rebuild:

```yaml
permissions:
  contents: write
  pages: write
```

GitHub Actions cannot elevate permissions granted by the caller; grant the mode-specific block in the calling workflow.

The PR preview lifecycle workflows declare their own job-scoped permissions and need no caller configuration: the untrusted build job uses `contents: read` only; the trusted publish job uses `contents: write`, `pages: write`, `pull-requests: write` (for the bot comment), and `actions: read` (to download the build artifact by run id); cleanup uses `contents: write` and `pages: write`; the janitor uses `contents: write` and `pages: write`.

---

## Configuration File (`.storybook-pages.yml`)

An optional `.storybook-pages.yml` file in the repository root allows centralizing configuration across workflows:

```yaml
version: 1
mode: artifact
path: storybook-static
package_manager: npm
build:
  install_command: npm ci
  build_command: npm run build-storybook
```

*Note: Explicit workflow inputs override file configuration, which in turn overrides default values.*

### Trusted directory mode

Set `mode: directory` to publish to a shared Pages branch. The build job remains untrusted (`contents: read`) and transfers its validated output to a separate publisher job with `contents: write`. Writes are serialized per repository and branch, conflicts receive bounded fetch/rebase retries, and the configured target is staged and replaced atomically. A Pages rebuild is requested only after a successful push.

Use an empty `target_directory` for the production root and a name such as `staging` for a named environment; both can coexist. Targets must be relative and cannot traverse or address `.git` or `.github`. Unrelated directories are preserved. GitHub Pages has one site/custom-domain configuration, so named environments are URL subpaths (for example `/staging`) and publication is eventually visible after the rebuild.

---

## PR Preview Lifecycle

Four workflows implement a full pull-request preview lifecycle on top of directory mode: `.github/workflows/pr-preview-build.yml`, `pr-preview-publish.yml`, `pr-preview-cleanup.yml`, and `pr-preview-janitor.yml`. Together they publish one preview per pull request at `<preview_root>/pr-<number>` (default `pr-preview/pr-<number>`), post exactly one bot comment with the preview URL, and clean the directory up when the PR closes - all without ever running PR-controlled code in a privileged context.

### Security model

| Stage | Trigger | Trust level | What it can do |
|-------|---------|-------------|----------------|
| **Build** (`pr-preview-build.yml`) | `pull_request` (`opened`, `synchronize`, `reopened`) | Untrusted | `contents: read` only. No secrets, no `pages`/`pull-requests` permission, no cache shared across builds. Builds and validates the PR's actual code (including forks), then uploads a single artifact bundling the static output with signed-shape metadata (repository, run id, PR number, base ref, head repository, head SHA, artifact name, schema version, and the computed preview target, or `null` for forks). |
| **Publish** (`pr-preview-publish.yml`) | `workflow_run` on completion of the build workflow | Trusted | Never checks out PR content. The `gate` job (read-only) accepts a run only if it succeeded, was triggered by `pull_request`, belongs to this repository, and - critically - has a non-empty `workflow_run.pull_requests[]` array. GitHub only populates that array for **same-repository** pull requests, so forked PRs are excluded by construction before any privileged job runs. The `publish` job then downloads the artifact by run id, re-validates every metadata field against this trusted context, re-fetches the PR's *current* head SHA from the API, and only proceeds if it still matches the build's head SHA (an older completed run for an already-superseded commit is skipped, never published). Only then does it publish and post/update the PR comment. |
| **Cleanup** (`pr-preview-cleanup.yml`) | `pull_request_target` (`closed`) | Trusted, metadata-only | Uses `pull_request_target` for a write-capable token even on forked PR closures, but only ever reads structured event fields (PR number) - it never checks out the pull request's head ref/SHA or executes any code from it. It checks out only the trusted Pages branch, removes `<preview_root>/pr-<number>` if present (a no-op otherwise), and requests a Pages rebuild after a successful removal. |
| **Janitor** (`pr-preview-janitor.yml`) | `workflow_dispatch` or daily `schedule` | Trusted | Lists live open PR numbers via the API and removes any `<preview_root>/pr-<number>` directory whose PR is no longer open, plus any still-open PR's preview older than `preview_retention_days`. Only entries matching the strict `pr-<number>` name are ever considered; everything else at the Pages branch root (production output, named environments, unrelated files) is left untouched. |

### Fork PRs

A pull request is treated as a fork whenever its head repository differs from the base repository. Fork PRs:

- **do** get a real, isolated build (so contributors see build failures), with `contents: read` and no secrets;
- **never** reach the publish job - the `gate` job's `workflow_run.pull_requests[0] != null` condition is false for forks, so the entire trusted job is skipped, not merely denied inside;
- **never** get a PR comment, a Pages write, or any other privileged side effect from this platform.

### Stale-run protection

Because multiple build runs can complete out of order (retries, re-runs, or a fast follow-up push), the publisher always compares the artifact's `headSha` against the pull request's **current** head SHA fetched live from the API at publish time, not against a cached value. A run whose commit is no longer the PR's head SHA is skipped with an explicit `skip-stale` status; it can never overwrite a newer preview.

### The preview comment

The comment is idempotent: it is identified by a stable hidden marker (`<!-- storybook-pages-preview:pr-<number> -->`), created once, and updated in place on every subsequent successful publish - never duplicated. Updates are restricted to an existing comment authored by `github-actions[bot]` with GitHub's `Bot` user type; if a user comment claims the marker, the publisher fails closed without editing or creating a comment. Comment failures are reported independently of the publish step: if the directory push already succeeded but the comment API call fails (for example, a transient GitHub outage), the job fails visibly on the comment step without rolling back or hiding the successful publish.

### Configuring the preview path and retention

Both are ordinary `.storybook-pages.yml` / workflow-input settings, validated the same way as `target_directory`:

```yaml
preview_root: pr-preview          # default; must be relative and cannot be .git/.github
preview_retention_days: 30        # default; 0 disables age-based pruning (closed-PR previews are still removed)
```

### Adapting the templates to another repository

This repository ships the four workflows above as a working reference implementation using its own bundled `test/fixtures/sample-storybook` fixture as a stand-in Storybook build (it has no Storybook of its own). To adopt them in a repository that does build a real Storybook:

1. Copy the four `pr-preview-*.yml` workflows into your repository's `.github/workflows/`.
2. Replace the build step in `pr-preview-build.yml` with your real install/build commands (or the composite action with `path` set to your actual build output directory).
3. Ensure a `gh-pages` (or your configured `pages_branch`) branch exists; the publish/cleanup/janitor workflows all target it.
4. Optionally add `preview_root`/`preview_retention_days` to `.storybook-pages.yml`.

---

## License & Attribution

This project is licensed under the [MIT License](LICENSE).

Preserves interface compatibility with `bitovi/github-actions-storybook-to-github-pages` (Copyright (c) 2023 Bitovi, MIT License).
