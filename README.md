# storybook-github-pages

[![CI](https://github.com/Archetipo95/storybook-github-pages/actions/workflows/ci.yml/badge.svg)](https://github.com/Archetipo95/storybook-github-pages/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Security-hardened GitHub Action and reusable workflows for building, validating, and deploying static Storybook builds to GitHub Pages.

> 💡 **Demo & Example Repository:** See [Archetipo95/storybook-vue-demo](https://github.com/Archetipo95/storybook-vue-demo) for a live Vue 3 + Storybook 10 example.

---

## Features

- **Security First**: Job-scoped least privilege permissions (`contents: read`, `pages: write`, `id-token: write`).
- **Artifact Validation**: Validates existence, path containment, non-empty static content, and symlink safety before upload.
- **Bitovi Compatible**: Preserves interface compatibility with `bitovi/github-actions-storybook-to-github-pages` inputs (`checkout`, `path`, `install_command`, `build_command`) for zero-friction migration.
- **Reusable Workflow & Composite Action**: Offers a primary reusable workflow for turnkey pipelines and a composite action for existing pipelines.
- **Pinned Dependencies**: All third-party GitHub Actions are pinned to full 40-character commit SHAs.
- **Directory Deployments**: Trusted publishers atomically update a directory on a Pages branch while preserving other environments and root `.nojekyll`.
- **PR Preview Lifecycle**: Unprivileged per-PR builds, a trusted `workflow_run` publisher with strict provenance/stale-run validation, an idempotent bot preview comment with live badges, base vs PR delta comparison table, collapsible growth chart, metadata-only close cleanup, and a scheduled/manual retention janitor.
- **Dynamic SVG Badges**: Automatically generates Shields.io-style SVG badges (Component Coverage %, Story count, Component count, Storybook version, and state-aware Status/Build) and JSON endpoints (`badges/`) for your documentation and README.
- **Hand-Drawn Growth Chart**: Generates a star-history styled hand-drawn SVG growth chart (`stats/history.svg`) and metrics ledger (`stats/history.json`) tracking component coverage, story count, and component count evolution.

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
    uses: Archetipo95/storybook-github-pages/.github/workflows/deploy-storybook.yml@v1.0.0
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
        uses: Archetipo95/storybook-github-pages@v1.0.0
        with:
          path: 'storybook-static'
          build_command: 'npm run build-storybook'
```

### Option 3: Trusted Directory Mode Pipeline (Branch-backed)

For branch-backed directory deployments (e.g., publishing to subdirectories on `gh-pages`), use a two-job pipeline separating unprivileged building from trusted publishing with the dedicated `publisher` action:

```yaml
name: Deploy Storybook Directory

on:
  push:
    branches:
      - main

concurrency:
  group: storybook-pages-${{ github.repository }}
  cancel-in-progress: false

jobs:
  build:
    name: Build Storybook
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: '20'

      - name: Install dependencies and build
        run: |
          npm ci
          npm run build-storybook

      - name: Upload static build
        uses: actions/upload-artifact@65462800fd760344b1a7b4382951275a0abb4808 # v4.3.3
        with:
          name: storybook-static
          path: storybook-static

  publish:
    name: Publish to Pages Branch
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pages: write
    steps:
      - name: Download build output
        uses: actions/download-artifact@fa0a91b85d4f404e444e00e005971372dc801d16 # v4.1.8
        with:
          name: storybook-static
          path: storybook-static

      - name: Checkout Pages branch
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: gh-pages
          path: pages-repo
          fetch-depth: 0

      - name: Publish directory
        uses: Archetipo95/storybook-github-pages/publisher@v1.0.1
        with:
          pages_repo: ${{ github.workspace }}/pages-repo
          source_directory: ${{ github.workspace }}/storybook-static
          pages_branch: gh-pages
          target_directory: preprod
```

---

## Support Matrix & Execution Environment

`storybook-github-pages` is designed and validated for the following support matrix:

| Category             | Supported Environments                                                                   | Notes                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform**         | GitHub.com (Public & Private Repositories)                                               | Uses native GitHub Pages API & OIDC JWTs                                                                                                                                          |
| **Runner OS**        | GitHub-hosted Linux (`ubuntu-latest`)                                                    | Tested on `ubuntu-latest` with Node.js 20+                                                                                                                                        |
| **Node.js Runtime**  | Node.js 20+                                                                              | Zero external npm dependencies (uses native Node.js ES modules)                                                                                                                   |
| **Package Managers** | Reusable workflow: `npm`, `yarn`, `pnpm`, `bun`; composite action: `npm`, `yarn`, `pnpm` | Bun is provisioned only in the reusable workflow's read-only build job                                                                                                            |
| **Tagging Strategy** | Immutable release tags (for example, `@v1.0.1`)                                          | **Recommended for stable, reproducible use.** This Bun support change requires a new release tag after merge. Floating major tags (e.g. `@v1`) are optional and non-reproducible. |

---

## Inputs & Outputs

### Action / Workflow Inputs

| Input                    | Type      | Default            | Description                                                                                                                               |
| ------------------------ | --------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `path`                   | `string`  | `storybook-static` | Path to the directory containing built static Storybook files                                                                             |
| `package_manager`        | `string`  | `npm`              | Reusable workflow: `npm`, `yarn`, `pnpm`, or `bun`; composite action: `npm`, `yarn`, or `pnpm`                                            |
| `checkout`               | `string`  | `'true'`           | Whether to check out the repository automatically (Action only)                                                                           |
| `install_command`        | `string`  | `''`               | Bitovi compatibility / custom dependency installation command                                                                             |
| `build_command`          | `string`  | `''`               | Bitovi compatibility / custom Storybook build command                                                                                     |
| `custom_install_command` | `string`  | `''`               | Alias for `install_command`                                                                                                               |
| `custom_build_command`   | `string`  | `''`               | Alias for `build_command`                                                                                                                 |
| `publish`                | `string`  | `'true'`           | Whether to upload and deploy the Pages artifact                                                                                           |
| `artifact_name`          | `string`  | `github-pages`     | GitHub Pages artifact name                                                                                                                |
| `environment`            | `string`  | `github-pages`     | GitHub Pages deployment environment name                                                                                                  |
| `mode`                   | `string`  | `artifact`         | `artifact` or trusted branch-backed `directory`                                                                                           |
| `pages_branch`           | `string`  | `gh-pages`         | Pages branch used by directory mode                                                                                                       |
| `target_directory`       | `string`  | `''`               | Relative directory to replace; empty means the production root                                                                            |
| `site_url`               | `string`  | `''`               | Canonical site URL used for deployment metadata                                                                                           |
| `base_path`              | `string`  | `''`               | URL base path; derived from `target_directory` when empty                                                                                 |
| `preview_root`           | `string`  | `pr-preview`       | Root directory (on the Pages branch) under which PR previews are published, as `<preview_root>/pr-<number>`                               |
| `preview_retention_days` | `number`  | `30`               | Days an _open_ PR's preview may remain before the janitor prunes it; closed-PR previews are always eligible for removal regardless of age |
| `managed_directories`    | `string`  | `''`               | Comma-separated directories preserved during root publication in directory mode (e.g. `pr-preview`)                                       |
| `generate_badges`        | `boolean` | `true`             | Whether to automatically generate SVG/JSON component and story count badges                                                               |
| `badges_directory`       | `string`  | `badges`           | Relative directory inside the static output where generated badges are hosted                                                             |
| `generate_stats_graph`   | `boolean` | `true`             | Whether to automatically generate hand-drawn growth chart (`history.svg`) and update metrics ledger (`history.json`)                      |
| `stats_directory`        | `string`  | `stats`            | Relative directory inside the static output where generated stats graph and history ledger are hosted                                     |

### Outputs

| Output          | Description                                               |
| --------------- | --------------------------------------------------------- |
| `page_url`      | The URL of the published GitHub Pages site                |
| `status`        | Status of the deployment (`success`, `skipped`, `failed`) |
| `deployment_id` | The GitHub Pages deployment ID                            |

---

## Dynamic SVG Badges & Endpoints

When `generate_badges` is enabled (default), `storybook-github-pages` analyzes your Storybook output (`index.json` / `stories.json`) and source tree to generate static SVG badges and Shields.io JSON endpoints into the `<badges_directory>/` subfolder on GitHub Pages:

- `badges/coverage.svg` / `badges/coverage.json` — Component coverage percentage and ratio (e.g. `coverage | 86% (6/7)` with dynamic green/yellow/red thresholds).
- `badges/stories.svg` / `badges/stories.json` — Story count badge (e.g. `stories | 26`).
- `badges/components.svg` / `badges/components.json` — Documented component count badge (e.g. `components | 6`).
- `badges/storybook.svg` / `badges/storybook.json` — Storybook version badge (e.g. `storybook | v8.6.0` or `v10.0.0`).
- `badges/status.svg` / `badges/status.json` — State-aware deployment status badge with commit SHA (e.g. `storybook | published • 8ba5315`, `storybook | building • 8ba5315` in yellow, or `storybook | failed • 8ba5315` in red).
- `badges/build.svg` / `badges/build.json` — Build status badge (`build | passed • 8ba5315`, `build | building`, `build | failed`).
- `badges/overview.json` — Comprehensive metadata endpoint aggregating story count, component count, total components, coverage percentage, build status, and commit details.

You can embed these badges directly into your `README.md`:

```markdown
[![Storybook](https://<owner>.github.io/<repo>/badges/storybook.svg)](https://<owner>.github.io/<repo>)
[![Coverage](https://<owner>.github.io/<repo>/badges/coverage.svg)](https://<owner>.github.io/<repo>)
[![Stories](https://<owner>.github.io/<repo>/badges/stories.svg)](https://<owner>.github.io/<repo>)
[![Components](https://<owner>.github.io/<repo>/badges/components.svg)](https://<owner>.github.io/<repo>)
[![Status](https://<owner>.github.io/<repo>/badges/status.svg)](https://<owner>.github.io/<repo>)
```

---

## 📈 Hand-Drawn Growth Chart & Metrics Ledger

When `generate_stats_graph` is enabled (default), `storybook-github-pages` generates a star-history styled hand-drawn SVG chart and keeps an incremental metrics ledger across deployments:

- `stats/history.svg` — Hand-drawn SVG growth chart showing historical component coverage, stories count, and components count trajectories over time. Supports dark-mode viewing with vintage hand-drawn styling and responsive layout.
- `stats/history.json` — Historical commit ledger appending metrics (`timestamp`, `commitSha`, `stories`, `components`, `totalComponents`, `coveragePercent`) on every deployment.

Embed the growth chart in your `README.md`:

```markdown
[![Storybook Growth History](https://<owner>.github.io/<repo>/stats/history.svg)](https://<owner>.github.io/<repo>)
```

---

## Bitovi Migration Guide

`storybook-github-pages` maintains input compatibility with `bitovi/github-actions-storybook-to-github-pages`:

| Bitovi Input      | `storybook-github-pages` Equivalent          | Notes                                  |
| ----------------- | -------------------------------------------- | -------------------------------------- |
| `path`            | `path`                                       | Identical default (`storybook-static`) |
| `checkout`        | `checkout`                                   | Identical boolean string behavior      |
| `install_command` | `install_command` / `custom_install_command` | Fully supported                        |
| `build_command`   | `build_command` / `custom_build_command`     | Fully supported                        |

**Migrating to `storybook-github-pages`:**
Simply replace `bitovi/github-actions-storybook-to-github-pages@v1.0.3` with `Archetipo95/storybook-github-pages@v1.0.0` in your workflow.

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

For artifact mode deployments, workflows require `contents: read`, `pages: write`, and `id-token: write`.

For branch-backed directory mode deployments, publication requires `contents: write` (to update the Pages branch) and `pages: write` (to request Pages rebuilds), but does **not** require `id-token: write`:

```yaml
permissions:
  contents: write
  pages: write
```

> **Platform Note on Reusable Workflows vs Directory Mode:**
> GitHub Actions compiles all jobs in a reusable workflow (`workflow_call`) before execution. Because the reusable workflow contains both artifact deployment (`id-token: write`) and directory deployment (`contents: write`) jobs, invoking it with only directory-level permissions triggers a GitHub Actions `startup_failure` (zero materialized jobs) due to caller permission validation. For branch-backed directory deployments in external repositories, always use the supported **Option 3** pipeline invoking `Archetipo95/storybook-github-pages/publisher@v1.0.1` directly in a dedicated publish job.

The PR preview lifecycle workflows declare their own job-scoped permissions and need no caller configuration: the untrusted build job uses `contents: read` only; the trusted publish job uses `contents: write`, `pages: write`, `pull-requests: write` (for the bot comment), and `actions: read` (to download the build artifact by run id); cleanup uses `contents: write` and `pages: write`; the janitor uses `contents: write`, `pages: write`, and `pull-requests: read`.

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

_Note: Explicit workflow inputs override file configuration, which in turn overrides default values._

For Bun projects, use the reusable workflow and set `package_manager: bun`. It provisions Bun in its read-only build job; the deploy-capable composite action intentionally rejects Bun so installation never runs in a job with Pages, OIDC, or write privileges. When omitted, the commands default to `bun install --frozen-lockfile` and `bun run build-storybook`:

```yaml
package_manager: bun
build:
  install_command: bun install --frozen-lockfile
  build_command: bun run build-storybook
```

### Trusted directory mode

Set `mode: directory` to publish to a shared Pages branch. The build job remains untrusted (`contents: read`) and transfers its validated output to a separate publisher job with `contents: write`. Writes are serialized per repository and branch, conflicts receive bounded fetch/rebase retries, and the configured target is staged and replaced atomically. A Pages rebuild is requested only after a successful push.

Use an empty `target_directory` for the production root and a name such as `staging` for a named environment; both can coexist. Targets must be relative and cannot traverse or address `.git` or `.github`. Unrelated directories are preserved. GitHub Pages has one site/custom-domain configuration, so named environments are URL subpaths (for example `/staging`) and publication is eventually visible after the rebuild.

---

## PR Preview Lifecycle

Four workflows implement a full pull-request preview lifecycle on top of directory mode: `.github/workflows/pr-preview-build.yml`, `pr-preview-publish.yml`, `pr-preview-cleanup.yml`, and `pr-preview-janitor.yml`. Together they publish one preview per pull request at `<preview_root>/pr-<number>` (default `pr-preview/pr-<number>`), post exactly one bot comment with the preview URL, and clean the directory up when the PR closes - all without ever running PR-controlled code in a privileged context.

### Security model

| Stage                                  | Trigger                                              | Trust level            | What it can do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build** (`pr-preview-build.yml`)     | `pull_request` (`opened`, `synchronize`, `reopened`) | Untrusted              | `contents: read` only. No secrets, no `pages`/`pull-requests` permission, no cache shared across builds. Builds and validates the PR's actual code (including forks), then uploads a single artifact bundling the static output with signed-shape metadata (repository, run id, PR number, base ref, head repository, head SHA, artifact name, schema version, and the computed preview target, or `null` for forks).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Publish** (`pr-preview-publish.yml`) | `workflow_run` on completion of the build workflow   | Trusted                | Never checks out PR content. The `gate` job (read-only) accepts a run only if it succeeded, was triggered by `pull_request`, belongs to this repository, and - critically - has a non-empty `workflow_run.pull_requests[]` array. GitHub only populates that array for **same-repository** pull requests, so forked PRs are excluded by construction before any privileged job runs. The `publish` job then downloads the artifact by run id, derives the trusted target directory `<preview_root>/pr-<number>` from base/default configuration (ignoring any target altered in the PR branch), re-validates every metadata field against this trusted context, re-fetches the PR's _current_ head SHA from the API, and only proceeds if it still matches the build's head SHA (an older completed run for an already-superseded commit is skipped, never published). Only then does it publish and post/update the PR comment. |
| **Cleanup** (`pr-preview-cleanup.yml`) | `pull_request_target` (`closed`)                     | Trusted, metadata-only | Uses `pull_request_target` for a write-capable token even on forked PR closures, but only ever reads structured event fields (PR number) - it never checks out the pull request's head ref/SHA or executes any code from it. It checks out the default branch to resolve the trusted base `.storybook-pages.yml` configuration (computing `<preview_root>/pr-<number>`), checks out the trusted Pages branch, removes the directory if present (a no-op otherwise), and requests a Pages rebuild after a successful removal.                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Janitor** (`pr-preview-janitor.yml`) | `workflow_dispatch` or daily `schedule`              | Trusted                | Lists live open PR numbers via the API and removes any `<preview_root>/pr-<number>` directory whose PR is no longer open, plus any still-open PR's preview older than `preview_retention_days`. Only entries matching the strict `pr-<number>` name are ever considered; everything else at the Pages branch root (production output, named environments, unrelated files) is left untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Fork PRs

A pull request is treated as a fork whenever its head repository differs from the base repository. Fork PRs:

- **do** get a real, isolated build (so contributors see build failures), with `contents: read` and no secrets;
- **never** reach the publish job - the `gate` job's `workflow_run.pull_requests[0] != null` condition is false for forks, so the entire trusted job is skipped, not merely denied inside;
- **never** get a PR comment, a Pages write, or any other privileged side effect from this platform.

### Stale-run protection

Because multiple build runs can complete out of order (retries, re-runs, or a fast follow-up push), the publisher always compares the artifact's `headSha` against the pull request's **current** head SHA fetched live from the API at publish time, not against a cached value. A run whose commit is no longer the PR's head SHA is skipped with an explicit `skip-stale` status; it can never overwrite a newer preview.

### The preview comment

The comment is idempotent: it is identified by a stable hidden marker (`<!-- storybook-pages-preview:pr-<number> -->`), created once, and updated in place on every subsequent successful publish - never duplicated. Updates are restricted to an existing comment authored by `github-actions[bot]` with GitHub's `Bot` user type; if a user comment claims the marker, the publisher fails closed without editing or creating a comment. Comment failures are reported independently of the publish step: if the directory push already succeeded but the comment API call fails (for example, a transient GitHub outage), the job fails visibly on the comment step without rolling back or hiding the successful publish.

The PR preview comment provides a rich overview for reviewers:

- **Live Badge Row**: Real-time badges for Coverage %, Stories count, Documented Components count, and Build Status.
- **Metrics & Coverage Comparison Table**: Compares Base branch vs PR Preview metrics with computed diff deltas (e.g., `+19%` 🟢 component coverage improvement, `+10` stories 📈).
- **Collapsible Growth Chart**: An expandable `<details>` section embedding the hand-drawn `stats/history.svg` growth graph.
- **Provenance Footer**: Built commit SHA, workflow run link, and clear update timestamping.

### Configuring the preview path and retention

Both are ordinary `.storybook-pages.yml` / workflow-input settings, validated the same way as `target_directory`:

```yaml
preview_root: pr-preview # default; set to '' in .storybook-pages.yml for repository-root layout (pr-<number>)
preview_retention_days: 30 # default; 0 disables age-based pruning (closed-PR previews are still removed)
```

#### Repository-Root Preview Layout (`preview_root: ''`)

When `preview_root` is set to `''` (empty string), previews are placed directly at the Pages branch root as `pr-<number>` (e.g. `pr-42`). The trusted publisher, cleanup, and janitor strictly target `pr-<number>` directories:

- **Cleanup**: Removes only the exact `pr-<closed-pr-number>` directory on PR close.
- **Janitor**: Scans the root and removes only entries matching `^pr-(\d+)$` whose PR is closed or exceeds retention; production root files (`index.html`, assets) and named environment directories (such as `staging/`) are never touched.

### Reusable Preview Lifecycle APIs

Consumers can invoke the preview publisher, cleanup, and janitor workflows and actions directly without checking out platform source or duplicating internal scripts:

#### 0. Reusable Untrusted PR Preview Bundle Action

The trusted publisher (below) expects a specific artifact contract: a workflow artifact named `storybook-preview-pr-<PR>-run-<run>` containing a `storybook/` directory (the static Storybook output) and a `preview-metadata.json` file with a SHA-256 digest binding the two together. The `preview-build` composite action produces that exact artifact from your **already-built** static Storybook output, so you never need to reimplement or copy the metadata-generation internals.

`preview-build` is intended **exclusively** for your unprivileged `pull_request` build job:

- it accepts your build output directory (`source_path`) and reads the pull request's event context (`pr_number`, `base_ref`, `head_sha`, `head_repository`) directly from `github.event.pull_request.*`, so nothing PR-controlled is ever interpolated into a shell command;
- it validates the output directory (non-empty static content, no nested `.git`, no path traversal, no symlink escapes) using the same `validate-artifact.js` module the main deploy action uses;
- it stages `preview-metadata.json` + `storybook/` and computes the content digest with the same `preview-metadata.js` module the trusted publisher independently re-validates against;
- it uploads the artifact under the deterministic name the publisher expects (or returns the name/bundle path as outputs if you set `upload: 'false'` to upload it yourself);
- it requires **no** `contents: write`, `pages`, `actions: read`, or `pull-requests: write` permission — the job that runs it needs only `contents: read` (the default for `pull_request`-triggered workflows) — and it never checks out or writes to the Pages branch, so it cannot be repurposed as a trusted publisher component even if misconfigured or run in a privileged context.
- every nested third-party action (`actions/upload-artifact`) is pinned to a full 40-character commit SHA.

A complete, secure pairing of the untrusted build job with the trusted `v1.2` publisher:

```yaml
# .github/workflows/pr-preview-build.yml (untrusted, runs for same-repo and fork PRs alike)
name: PR Preview Build

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read # the only permission this job ever needs

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false

      # Replace with your real install/build commands (or the main `Archetipo95/storybook-github-pages@v1.5.0`
      # composite action with `publish: 'false'`) so `storybook-static` contains your actual build output.
      - run: npm ci && npm run build-storybook

      - name: Package and upload preview bundle
        uses: Archetipo95/storybook-github-pages/preview-build@v1.5.0
        with:
          source_path: storybook-static # your built static Storybook output directory
```

```yaml
# .github/workflows/pr-preview-publish.yml (trusted, only runs after the build above completes)
name: PR Preview Publish

on:
  workflow_run:
    workflows: ['PR Preview Build']
    types: [completed]

permissions:
  contents: write
  pages: write
  pull-requests: write
  actions: read

jobs:
  publish:
    uses: Archetipo95/storybook-github-pages/.github/workflows/pr-preview-publish.yml@v1.5.0
    with:
      pages_branch: 'gh-pages'
```

Required inputs/outputs and the artifact contract at a glance:

| Input            | Required | Default      | Description                                                     |
| ---------------- | -------- | ------------ | --------------------------------------------------------------- |
| `source_path`    | Yes      | —            | Path to the already-built static Storybook output directory     |
| `preview_root`   | No       | `pr-preview` | Must match the trusted publisher's configured `preview_root`    |
| `upload`         | No       | `true`       | Set `'false'` to stage the bundle without uploading it yourself |
| `retention_days` | No       | `7`          | Artifact retention when `upload` is true                        |

| Output           | Description                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `artifact_name`  | The deterministic `storybook-preview-pr-<PR>-run-<run>` artifact name used; there is no input to override it |
| `bundle_dir`     | Path to the staged `storybook/` + `preview-metadata.json` bundle                                             |
| `content_digest` | SHA-256 digest binding `storybook/` to `preview-metadata.json`                                               |
| `is_fork`        | Whether the pull request head repository differs from the base repository                                    |

The artifact name is **not configurable**: it is always derived from the validated pull request number and run id available to the untrusted build job, so this action can never emit an artifact outside the exact `storybook-preview-pr-<PR>-run-<run>` namespace the trusted publisher expects, and cannot be used to redirect or spoof a different artifact name.

The action fails closed (non-zero exit, no artifact uploaded) if it is invoked outside a `pull_request`-triggered job (`github.event_name` is not `pull_request`, `github.event.pull_request.number` is empty, or the pull request number/run id are not positive integers), if `source_path` fails artifact validation, or if any event-context field is malformed - the same strict, shell/path-safe validation the trusted publisher itself relies on.

#### 1. Reusable Trusted PR Preview Publisher

Call the reusable publisher workflow on completion of your unprivileged PR build workflow (`workflow_run: types: [completed]`):

```yaml
name: PR Preview Publish

on:
  workflow_run:
    workflows: ['PR Preview Build']
    types: [completed]

permissions:
  contents: write
  pages: write
  pull-requests: write
  actions: read

jobs:
  publish:
    uses: Archetipo95/storybook-github-pages/.github/workflows/pr-preview-publish.yml@v1.5.0
    with:
      preview_root: '' # optional: override preview root; defaults to .storybook-pages.yml or 'pr-preview'
      pages_branch: 'gh-pages'
```

Or call the composite action `preview-publisher` in a custom `workflow_run` job:

```yaml
steps:
  - name: Fetch current PR head SHA
    id: current
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      REPOSITORY: ${{ github.repository }}
      PR_NUMBER: ${{ github.event.workflow_run.pull_requests[0].number }}
    run: |
      response=$(curl -sf -H "authorization: token $GITHUB_TOKEN" -H "accept: application/vnd.github+json" "https://api.github.com/repos/$REPOSITORY/pulls/$PR_NUMBER")
      sha=$(node -e 'console.log(JSON.parse(process.argv[1]).head.sha)' "$response")
      echo "head_sha=$sha" >> "$GITHUB_OUTPUT"

  - name: Download build artifact
    uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
    with:
      name: storybook-preview-pr-${{ github.event.workflow_run.pull_requests[0].number }}-run-${{ github.event.workflow_run.id }}
      run-id: ${{ github.event.workflow_run.id }}
      github-token: ${{ secrets.GITHUB_TOKEN }}
      path: ${{ runner.temp }}/preview-bundle

  - name: Checkout Pages branch
    uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      ref: gh-pages
      path: pages-repo
      fetch-depth: 0
      token: ${{ secrets.GITHUB_TOKEN }}

  - name: Validate provenance and publish preview
    uses: Archetipo95/storybook-github-pages/preview-publisher@v1.5.0
    with:
      bundle_dir: ${{ runner.temp }}/preview-bundle
      pages_repo: pages-repo
      pages_branch: gh-pages
      preview_root: ''
      trusted_repository: ${{ github.repository }}
      trusted_run_id: ${{ github.event.workflow_run.id }}
      trusted_pr_number: ${{ github.event.workflow_run.pull_requests[0].number }}
      trusted_head_sha: ${{ github.event.workflow_run.head_sha }}
      trusted_head_repository: ${{ github.event.workflow_run.head_repository.full_name }}
      trusted_base_ref: ${{ github.event.workflow_run.pull_requests[0].base.ref }}
      expected_artifact_name: storybook-preview-pr-${{ github.event.workflow_run.pull_requests[0].number }}-run-${{ github.event.workflow_run.id }}
      current_head_sha: ${{ steps.current.outputs.head_sha }}
```

#### 2. Reusable Closed-PR Preview Cleanup

Call the reusable workflow on PR closure (`pull_request_target: types: [closed]`):

```yaml
name: PR Preview Cleanup

on:
  pull_request_target:
    types: [closed]

permissions:
  contents: write
  pages: write

jobs:
  cleanup:
    uses: Archetipo95/storybook-github-pages/.github/workflows/pr-preview-cleanup.yml@v1.5.0
    with:
      preview_root: '' # optional: override preview root; defaults to .storybook-pages.yml or 'pr-preview'
      pages_branch: 'gh-pages'
```

Or call the composite action in a custom job:

```yaml
steps:
  - name: Checkout Pages branch
    uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
    with:
      ref: gh-pages
      path: pages-repo
      token: ${{ secrets.GITHUB_TOKEN }}
  - name: Remove preview directory
    uses: Archetipo95/storybook-github-pages/preview-cleanup@v1.5.0
    with:
      pages_repo: pages-repo
      pages_branch: gh-pages
      preview_root: ''
      pr_number: ${{ github.event.pull_request.number }}
```

#### 3. Reusable Stale-Preview Janitor

Call the reusable janitor workflow on schedule or dispatch:

```yaml
name: PR Preview Janitor

on:
  workflow_dispatch:
  schedule:
    - cron: '17 4 * * *'

permissions:
  contents: write
  pages: write
  pull-requests: read

jobs:
  janitor:
    uses: Archetipo95/storybook-github-pages/.github/workflows/pr-preview-janitor.yml@v1.5.0
    with:
      preview_root: ''
      pages_branch: 'gh-pages'
      retention_days: '30'
```

Or use the composite action directly:

```yaml
steps:
  - name: Checkout Pages branch
    uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
    with:
      ref: gh-pages
      path: pages-repo
      token: ${{ secrets.GITHUB_TOKEN }}
  - name: Prune stale previews
    uses: Archetipo95/storybook-github-pages/preview-janitor@v1.5.0
    with:
      pages_repo: pages-repo
      pages_branch: gh-pages
      preview_root: ''
      retention_days: '30'
```

### Adapting the templates to another repository

This repository ships the four workflows above as a working reference implementation using its own bundled `test/fixtures/sample-storybook` fixture as a stand-in Storybook build (it has no Storybook of its own). To adopt them in a repository that does build a real Storybook:

1. Copy the four `pr-preview-*.yml` workflows into your repository's `.github/workflows/`.
2. Replace the build step in `pr-preview-build.yml` with your real install/build commands (or the composite action with `path` set to your actual build output directory).
3. Ensure a `gh-pages` (or your configured `pages_branch`) branch exists; the publish/cleanup/janitor workflows all target it.
4. Optionally add `preview_root`/`preview_retention_days` to `.storybook-pages.yml`.

---

## Modern Bundlers (Vite / Rollup / Webpack) & Subdirectory Previews

When building Storybook with modern bundlers (such as `@storybook/vue3-vite`, `@storybook/react-vite`, `@storybook/svelte-vite`, or Webpack 5) for deployment to GitHub Pages root and PR preview subdirectories (`/pr-preview/pr-<number>/`), keep these two configurations in mind:

### 1. Relative Asset URLs (`base: './'`)

By default, Storybook builds might assume root-level serving (`/`). When publishing to a subdirectory on GitHub Pages (e.g. `https://<owner>.github.io/<repo>/pr-preview/pr-42/`), absolute asset paths like `/assets/...` will fail or point to the root domain.

To make your static Storybook build portable across both root production and PR preview subdirectories without needing different build commands, set `base: './'` in your Storybook configuration:

**For Vite frameworks (`.storybook/main.ts`):**

```typescript
import type { StorybookConfig } from '@storybook/vue3-vite'; // or @storybook/react-vite, @storybook/svelte-vite

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: {
    name: '@storybook/vue3-vite',
    options: {}
  },
  async viteFinal(config) {
    return {
      ...config,
      base: './' // Ensures relative asset resolution for scripts, styles, and iframe
    };
  }
};

export default config;
```

**For Webpack frameworks (`.storybook/main.ts`):**

```typescript
import type { StorybookConfig } from '@storybook/react-webpack5';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: '@storybook/react-webpack5',
  async webpackFinal(config) {
    config.output = {
      ...config.output,
      publicPath: './'
    };
    return config;
  }
};

export default config;
```

### 2. Automatic `.nojekyll` Handling

Vite and Rollup often generate vendor chunks with leading underscores (e.g. `_plugin-vue_export-helper.js` or `_commonjsHelpers.js`). GitHub Pages runs Jekyll by default, which ignores any file or folder starting with an underscore (`_`), causing HTTP 404 errors on dynamic imports.

`storybook-github-pages` **automatically** creates and preserves `.nojekyll` files at both the Pages root and inside artifact packages. You do not need to manually create `.nojekyll` in your source repository.

> 💡 **Live Reference Implementation:** See [Archetipo95/storybook-vue-demo](https://github.com/Archetipo95/storybook-vue-demo) for a complete working example with Vue 3.5, Storybook 10, Vite 8, and automated PR previews.

---

## Troubleshooting Guide

### 1. GitHub Pages Deployment 404

- **Symptom**: Deployment completes successfully, but accessing the site URL returns HTTP 404.
- **Causes & Solutions**:
  - **Build Directory**: Ensure your `path` input points to the directory containing the static output (e.g. `storybook-static` or `dist/storybook`). The output must contain an `index.html` file.
  - **GitHub Pages Source Setting**: Ensure repository settings have GitHub Pages enabled (`Settings > Pages > Source: GitHub Actions` for artifact mode, or `Deploy from a branch: gh-pages` for directory mode).
  - **Subpath / Base Path**: If publishing to a subpath (e.g., directory mode target `staging` or `pr-preview/pr-12`), ensure your Storybook build is configured with matching asset relative paths (`--base-path` or relative URL resolution).

### 2. Permission Denied Errors in GitHub Actions

- **Symptom**: Workflow fails with `403 Forbidden` or `Resource not accessible by integration`.
- **Causes & Solutions**:
  - **Artifact Mode**: The calling workflow job requires `pages: write` and `id-token: write` permissions.
  - **Directory Mode**: The calling workflow job requires `contents: write` and `pages: write` permissions.
  - **Repository Settings**: Verify `Settings > Actions > General > Workflow permissions` is configured to allow workflows to read/write as appropriate.

### 3. PR Preview Publish Gate Skipped for Fork PRs

- **Symptom**: `pr-preview-publish.yml` workflow run shows as skipped for a pull request from an external fork.
- **Explanation**: This is intentional security behavior. External forks execute build code in an unprivileged runner (`contents: read`). For security, the trusted `workflow_run` publisher gates on `workflow_run.pull_requests[0] != null`, which GitHub populates only for same-repository PRs. Fork PRs produce build artifacts but are never permitted to publish or comment.

### 4. Stale Run Skipped (`skip-stale`)

- **Symptom**: `pr-preview-publish.yml` outputs `status: skipped` with a stale run notice.
- **Explanation**: The publisher live-checks the pull request's current head SHA against the build artifact's head SHA. If a newer commit was pushed while an older run was building, the older run skips publishing to avoid overwriting newer code.

### 5. Artifact Validation Failures

- **Symptom**: `validate-artifact.js` fails with `Path escapes workspace root` or `No static content found`.
- **Causes & Solutions**:
  - **Path Escape**: Ensure `path` is relative to the workspace root and contains no `../` traversal or external symlinks.
  - **Empty Output**: Verify that your build command actually produced files in the specified `path` directory before validation runs.

### 6. Missing Pages Branch (`gh-pages`)

- **Symptom**: Directory mode or PR preview workflows fail when attempting to check out `gh-pages`.
- **Solution**: Create the `gh-pages` branch if it does not yet exist in your repository:
  ```bash
  git checkout --orphan gh-pages
  git rm -rf .
  echo "# GitHub Pages" > README.md
  git add README.md
  git commit -m "Initialize gh-pages branch"
  git push origin gh-pages
  git checkout main
  ```

### 7. Preview Artifact Download in Trusted Workflows (`fatal: not a git repository`)

- **Symptom**: In a trusted `workflow_run` preview publisher workflow that does not check out PR-controlled code, artifact download fails with `fatal: not a git repository`.
- **Causes & Solutions**:
  - **CLI Git Discovery**: When running `gh run download <run-id> --name <artifact>` in a runner environment without a Git checkout, `gh` defaults to querying local Git remotes in the working directory. Provide repository context via environment `env: GH_REPO: ${{ github.repository }}` (or `--repo ${{ github.repository }}`) and `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` so `gh` operates without requiring a local Git checkout.
  - **Actions download-artifact (Recommended)**: Use `actions/download-artifact@v4` with explicit `run-id: ${{ github.event.workflow_run.id }}` and `github-token: ${{ secrets.GITHUB_TOKEN }}`. This downloads the artifact directly via GitHub Actions APIs without executing untrusted code or requiring a local checkout.

### 8. Reusable Workflow Permissions & Concurrency Constraints

- **Symptom**: Workflow fails to trigger, encounters `403 Resource not accessible by integration`, or fails with workflow syntax errors when calling reusable workflows (`workflow_call`).
- **Causes & Solutions**:
  - **Top-Level Concurrency**: GitHub Actions rejects top-level `concurrency:` on reusable workflows (`workflow_call`). Concurrency is managed at the job level inside our reusable workflows. Caller workflows should not declare workflow-level concurrency on caller files that invoke `workflow_call`.
  - **Required Caller Permissions**: When invoking `pr-preview-publish.yml` via `workflow_call`, ensure your caller workflow grants the required permissions:
    ```yaml
    permissions:
      contents: write # to update gh-pages branch
      pages: write # to request GitHub Pages build triggers
      pull-requests: write # to post/update the preview comment
      actions: read # to download the untrusted build artifact
    ```
  - **Canonical Site URL Auto-Detection**: `site_url` is optional. If omitted in `.storybook-pages.yml` or workflow inputs, the action automatically derives the standard GitHub Pages URL `https://<owner>.github.io/<repo>` (or `https://<owner>.github.io` for user/organization pages repositories).

### 9. Vite/Rollup Underscore Assets 404 (Jekyll & .nojekyll)

- **Symptom**: In browser developer tools console, Storybook fails to render with `404 Not Found` for files like `assets/_plugin-vue_export-helper-*.js` or `TypeError: Failed to fetch dynamically imported module`.
- **Cause**: GitHub Pages uses Jekyll by default. Jekyll ignores files and folders prefixed with an underscore (`_`), which Vite and Rollup frequently produce for helper chunks.
- **Solution**:
  - `storybook-github-pages` automatically injects a `.nojekyll` file at the root of `gh-pages` and within build bundles.
  - If using a custom deployment workflow, ensure `.nojekyll` exists at the root of the `gh-pages` branch.
  - Ensure your `.storybook/main.ts` configures `base: './'` in `viteFinal` as described in the [Modern Bundlers guide](#modern-bundlers-vite--rollup--webpack--subdirectory-previews).

---

## License & Attribution

This project is licensed under the [MIT License](LICENSE).

Preserves interface compatibility with `bitovi/github-actions-storybook-to-github-pages` (Copyright (c) 2023 Bitovi, MIT License).
