# Changelog

All notable changes to `storybook-github-pages` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
