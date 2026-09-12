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

---

## License & Attribution

This project is licensed under the [MIT License](LICENSE).

Preserves interface compatibility with `bitovi/github-actions-storybook-to-github-pages` (Copyright (c) 2023 Bitovi, MIT License).
