---
id: pipeline.release
type: pipeline
title: Release workflow (npm publish)

attributes:
  provider: github
  path: .github/workflows/release.yml
  triggers:
    - push tag matching v[0-9]+.[0-9]+.[0-9]+*
    - GitHub release published

links:
  - rel: produces
    target: artifact.wheelhouse-npm
    evidence:
      - source: infrastructure
        path: .github/workflows/release.yml
        lines: '74-85'
        symbol: 'jobs.publish.steps[Publish]'
        observedAt: '2026-10-25'
        observedBy: claude
        session: dad277c6-9ab5-421d-8988-83aaf4b902b6
        note: Publishes @chrisjowen/wheelhouse to npm via `npm publish --provenance --access public`

  - rel: defined_in
    target: repository.wheelhouse
    evidence:
      - source: infrastructure
        path: .github/workflows/release.yml
        lines: '1-90'
        symbol: 'name: Release'
        commit: '1a2f1c0'
        observedAt: '2026-10-25'
        observedBy: claude
        session: dad277c6-9ab5-421d-8988-83aaf4b902b6
        note: Workflow that publishes @chrisjowen/wheelhouse to npm when vX.Y.Z tag is pushed or GitHub release is published

evidence:
  - source: infrastructure
    path: .github/workflows/release.yml
    lines: '1-90'
    symbol: 'on.push.tags,on.release.types'
    commit: '1a2f1c0'
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/1a2f1c0/.github/workflows/release.yml
    observedAt: '2026-10-25'
    observedBy: claude
    session: dad277c6-9ab5-421d-8988-83aaf4b902b6
    note: Triggers on version tag push (v[0-9]+.[0-9]+.[0-9]+*) or GitHub release published; uses npm trusted publishing (GitHub OIDC) with NPM_TOKEN fallback

  - source: infrastructure
    path: .github/workflows/release.yml
    lines: '45-60'
    symbol: 'jobs.publish.steps[Check the tag matches package.json]'
    commit: '1a2f1c0'
    observedAt: '2026-10-25'
    observedBy: claude
    session: dad277c6-9ab5-421d-8988-83aaf4b902b6
    note: Validates tag matches package.json version and checks if version already published to npm; skips publish if already on npm

  - source: infrastructure
    path: .github/workflows/release.yml
    lines: '39-41'
    symbol: 'jobs.publish.steps[Update npm]'
    commit: '1a2f1c0'
    observedAt: '2026-10-25'
    observedBy: claude
    session: dad277c6-9ab5-421d-8988-83aaf4b902b6
    note: Updates npm to ^11.5.1 for trusted publishing support (Node 22 ships npm 10)

  - source: conversation
    session: dad277c6-9ab5-421d-8988-83aaf4b902b6
    observedAt: '2026-10-25'
    observedBy: claude
    note: Session review found release workflow does not run smoke tests before publishing. A build that compiles but fails to start (e.g., bad external import in CLI bundle, or adapter-node not resolving runtime dependency) would ship to npm. Recommendation is to add smoke test step after `npm pack --dry-run` and before Publish.

provenance:
  capturedBy: claude
---

# Release workflow (npm publish)

GitHub Actions workflow (`.github/workflows/release.yml`, added in commit 1a2f1c0) that publishes `@chrisjowen/wheelhouse` to npm.

**Triggers:** On version tag push (matching `v[0-9]+.[0-9]+.[0-9]+*`) or GitHub release published.

**Steps:**
- Check that tag matches `package.json` version and verify if already on npm
- Type-check (`npm run check`)
- Lint (`npm run lint`)
- Unit tests (`npm run test:unit`)
- Publish to npm (with provenance, public access; pre-releases use `next` dist-tag)

**Authentication:** Uses npm trusted publishing via GitHub OIDC (forward-compatible); falls back to `NPM_TOKEN` secret if trusted publishing is not configured.

**Gap:** Does not run smoke tests before publishing. The smoke tests (`npm run test:smoke`) are the only tests that actually start the built CLI (`dist/cli.js` + `build/`) against a fake Firstmate home. A build that compiles but fails to start (e.g., bad external import in esbuild CLI bundle, or adapter-node not resolving a runtime dependency) would ship to npm without smoke tests catching it.
