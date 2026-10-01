# Bundle size and Lighthouse audits

Both audits are opt-in and run in the read-only build job, after Storybook is
built and before badges, stats, or the passcode gate are added, so they measure
your Storybook output only. Results are appended to `$GITHUB_STEP_SUMMARY` and
written to `audit/` inside the static output.

| Input                  | Type      | Default | Description                                                                 |
| ---------------------- | --------- | ------- | --------------------------------------------------------------------------- |
| `audit_bundle_size`    | `boolean` | `false` | Audit static asset sizes and add a bundle size scorecard to the job summary |
| `bundle_size_max_mb`   | `string`  | `''`    | Optional total output budget in MB; the build fails when it is exceeded     |
| `audit_lighthouse`     | `boolean` | `false` | Run Lighthouse against the built Storybook and report its category scores   |
| `lighthouse_min_score` | `string`  | `''`    | Optional minimum score (0-100) for every category; the build fails below it |

The inputs are accepted by the reusable workflow, the composite action, the
`preview-build` action, and `.storybook-pages.yml`.

```yaml
jobs:
  storybook:
    uses: Archetipo95/storybook-github-pages/.github/workflows/deploy-storybook.yml@v1
    with:
      audit_bundle_size: true
      bundle_size_max_mb: '25'
      audit_lighthouse: true
      lighthouse_min_score: '80'
```

## Bundle size

`src/audit-static.js` walks the static output with no extra dependencies and
reports:

- total size and an estimated gzip transfer size (already-compressed images and
  `woff`/`woff2` fonts are counted as-is);
- a breakdown by JavaScript, CSS, fonts, images, HTML, JSON, source maps and
  other files;
- the 10 largest assets.

The report is saved to `audit/bundle-size.json`. Because the production deploy
publishes that file, PR preview comments can compare a pull request against the
base branch's last deployed report.

## Lighthouse

`src/audit-lighthouse.js` serves the static output on `127.0.0.1` with the same
loopback server as the smoke test and runs a pinned
`lighthouse@13.5.0` through `npx` against `index.html` in headless Chrome. It
records Performance, Accessibility, Best Practices and SEO scores in
`audit/lighthouse.json`. GitHub-hosted Ubuntu runners include Chrome; on
self-hosted runners, install Chrome or set `CHROME_PATH`.

Lighthouse scores for a static file server on a shared CI runner vary from run
to run, so set `lighthouse_min_score` with some headroom.

## PR preview comments

When the untrusted build enables `audit_bundle_size` (through `preview-build`),
the trusted publisher adds a **Bundle Size** table to the preview comment. The
publisher does not trust the sizes in the artifact: the artifact's
`audit/bundle-size.json` only signals that auditing is on, and the publisher
recomputes the sizes from the digest-verified content. It also compares them
with the base branch's `audit/bundle-size.json` on the Pages branch when that
file exists.

Lighthouse scores can't be recomputed without a browser, so the publisher takes
them from the artifact's `audit/lighthouse.json`. It accepts only integer scores
from 0 to 100 for the four known categories, and the comment labels them as
reported by the pull request build. Asset names are sanitized before they are
rendered in the comment.
