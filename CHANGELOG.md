# Changelog

All notable changes to `storybook-github-pages` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Reusable Untrusted PR Preview Bundle Action (`preview-build/action.yml`)**: Public, supported composite action for the unprivileged `pull_request` build job. Accepts an already-built static Storybook directory and the job's own pull request event context, validates the output with `validate-artifact.js`, and stages/uploads the deterministic `storybook-preview-pr-<PR>-run-<run>` artifact (`storybook/` + `preview-metadata.json` with SHA-256 digest binding) via `preview-metadata.js` - reusing the same internals the trusted publisher independently re-validates, so consumers never need to copy or reimplement metadata-generation logic. The artifact name is **not configurable**: it is always derived from the validated pull request number and run id, so this untrusted action can never emit outside the exact namespace the trusted publisher expects. Requires only the default `contents: read` build-job permission; never references secrets/tokens, never checks out or writes to the Pages branch, and cannot be repurposed as a trusted publisher component. All nested actions (`actions/upload-artifact`) are pinned to full commit SHAs. The repository's own reference `pr-preview-build.yml` workflow now dogfoods this action instead of calling `src/preview-metadata.js` inline.
- **Reusable Trusted PR Preview Publisher Workflow and Action (`.github/workflows/pr-preview-publish.yml` & `preview-publisher/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action (`preview-publisher`) for trusted `workflow_run` preview publishing with complete provenance validation (workflow identity, completed success event, repository, same-repo PR association, base ref, current live head SHA, artifact name/schema, metadata/digest binding, and trusted target resolution) without requiring consumers to check out PR-controlled source or duplicate internal publishing orchestration.
- **Bun Package-Manager Support**: The reusable deployment workflow accepts `package_manager: bun`, defaults to `bun install --frozen-lockfile` and `bun run build-storybook`, and provisions SHA-pinned `oven-sh/setup-bun` only in its read-only build job. The deploy-capable composite action intentionally excludes Bun.
- **Reusable PR Preview Cleanup Workflow and Action (`.github/workflows/pr-preview-cleanup.yml` & `preview-cleanup/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action for trusted closed-PR preview cleanup without requiring consumers to check out platform source or duplicate internal scripts.
- **Reusable Stale-Preview Janitor Workflow and Action (`.github/workflows/pr-preview-janitor.yml` & `preview-janitor/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action for scheduled and manual reconciliation of stale or orphaned PR previews according to retention configuration.
- **Repository-Root Preview Layout Support (`preview_root: ''`)**: Support empty string `preview_root` across configuration resolution, metadata validation, trusted publication, close cleanup, and janitor pruning, safely managing `pr-<number>` directories directly at the Pages branch root while strictly preserving production root assets and named environments.
- **External Consumer Lifecycle Regression Suite (`test/preview-consumer-lifecycle.test.js`)**: End-to-end regression tests verifying untrusted build artifact creation, trusted artifact transfer in non-git environments, provenance validation, idempotent bot comments, stale-run skipping, PR close cleanup, and root layout lifecycle.

### Fixed
- **PR Preview Artifact Download Without Git Checkout**: Clarified and documented artifact download requirements for trusted `workflow_run` preview publishers. When downloading untrusted build artifacts without a local Git checkout (to preserve security invariants), `actions/download-artifact@v4` with `run-id` and `github-token` or `gh run download` with `GH_REPO` / `--repo` prevents `fatal: not a git repository` errors.
- **PR Preview Cleanup Missing Branch Graceful Skip**: When a repository has not initialized or configured a Pages branch, PR preview close cleanup (`pr-preview-cleanup.yml`) safely and noiselessly skips without failing the workflow.

### Documentation
- **Directory Mode Integration via Dedicated Publisher Action**: Investigated generic `startup_failure` runs when external consumers invoke multi-job reusable workflows in directory mode (#24). Documented the GitHub Actions platform limitation where caller permission validation evaluates all jobs in a reusable workflow graph at startup, causing runs to be rejected when callers only grant mode-specific permissions (`contents: write`, `pages: write`). Clarified and documented the supported two-job architecture for directory deployments using `publisher@v1.0.1` directly.
---

## [1.0.0] - 2026-09-12

### Added
- **Reusable Workflow (`.github/workflows/deploy-storybook.yml`)**: Turnkey pipeline for building, validating, and deploying static Storybook builds to GitHub Pages with minimal caller setup.
- **Composite Action (`action.yml`)**: Flexible composite action for existing CI/CD workflows, fully supporting artifact deployment and validation.
- **Trusted Directory Mode (`mode: directory`)**: Atomically updates specific directories on a branch-backed GitHub Pages repository (e.g., `gh-pages`) with locking, retry logic, and preserved sibling directories.
- **PR Preview Lifecycle**:
  - `pr-preview-build.yml`: Unprivileged PR build workflow (`contents: read` only, no secrets) supporting fork PRs safely.
  - `pr-preview-publish.yml`: Privileged `workflow_run` publisher enforcing strict provenance checks, same-repository validation, and stale-run protection before publishing to `<preview_root>/pr-<number>`.
  - `pr-preview-cleanup.yml`: Metadata-only PR closure cleanup workflow (`pull_request_target`) that removes PR preview directories without checking out PR code.
  - `pr-preview-janitor.yml`: Scheduled and manual workflow for pruning abandoned or aged PR previews according to `preview_retention_days`.
  - **Idempotent Bot Comment**: Single, updated-in-place PR preview comment authored by `github-actions[bot]` identified by a stable hidden HTML marker.
- **Artifact Validation Safeguards**: Built-in verification (`src/validate-artifact.js`) ensuring target directories exist, contain non-empty static assets (`index.html` or `.html`/`.js`), contain no nested `.git` repositories, and do not escape workspace boundaries via symlinks or relative path traversal.
- **Bitovi Compatibility**: 100% input parameter parity with `bitovi/github-actions-storybook-to-github-pages` (`path`, `checkout`, `install_command`, `build_command`, `custom_install_command`, `custom_build_command`).
- **Configuration File Support (`.storybook-pages.yml`)**: Centralized YAML configuration for project-wide deployment settings.
- **Security Hardening**:
  - Full 40-character commit SHA pins for all third-party GitHub Actions.
  - Job-scoped minimal permissions (`contents: read`, `pages: write`, `id-token: write`).
  - Strict isolation for fork pull requests and unprivileged builds.
  - Zero runtime npm dependencies and zero external telemetry or tracking.
