---
id: artifact.wheelhouse-npm
type: artifact
title: '@chrisjowen/wheelhouse npm package'

attributes:
  kind: package
  registry: npm
  name: '@chrisjowen/wheelhouse'

links:
  - rel: built_from
    target: repository.wheelhouse
    evidence:
      - source: manifest
        path: package.json
        lines: '1-5'
        key: 'name,version,description'
        commit: '1a2f1c0'
        observedAt: '2026-10-25'
        observedBy: claude
        session: dad277c6-9ab5-421d-8988-83aaf4b902b6
        note: Package published from wheelhouse repository

evidence:
  - source: manifest
    path: package.json
    lines: '1-5'
    key: 'name,version'
    commit: '1a2f1c0'
    urls:
      - https://www.npmjs.com/package/@chrisjowen/wheelhouse
    observedAt: '2026-10-25'
    observedBy: claude
    session: dad277c6-9ab5-421d-8988-83aaf4b902b6
    note: 'Package @chrisjowen/wheelhouse version 0.1.0 published to npm registry'

  - source: infrastructure
    path: .github/workflows/release.yml
    lines: '74-85'
    symbol: 'jobs.publish.steps[Publish]'
    commit: '1a2f1c0'
    observedAt: '2026-10-25'
    observedBy: claude
    session: dad277c6-9ab5-421d-8988-83aaf4b902b6
    note: Release workflow publishes with `npm publish --provenance --access public` (or --tag next for pre-releases)

provenance:
  capturedBy: claude
---

# @chrisjowen/wheelhouse npm package

Published npm package at `@chrisjowen/wheelhouse` (version 0.1.0). Published via the release workflow when a version tag (`vX.Y.Z`) is pushed or a GitHub release is published.

**Publication details:**
- Public access
- Includes provenance (npm trusted publishing with GitHub OIDC)
- Pre-releases (e.g., 1.2.0-beta.1) published to the `next` dist-tag instead of `latest`
