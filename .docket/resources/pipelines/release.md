---
name: release
id: pipeline.release
type: pipeline
title: Release Workflow

attributes:
  provider: GitHub Actions
  path: .github/workflows/release.yml
  triggers:
    - vX.Y.Z tag push
    - GitHub release published

links:
  - rel: defined_in
    target: repository.wheelhouse
  - rel: tests
    target: test_suite.unit
  - rel: produces
    target: artifact.wheelhouse-npm-package
  - rel: depends_on
    target: system.npm

evidence:
  - source: infrastructure
    path: .github/workflows/release.yml
    observedAt: '2026-10-25'
    observedBy: claude
    session: 323d6e3b-9ff0-49ca-bc37-e286e5ebcd9f
    note: Release workflow publishes to npm when vX.Y.Z tag is pushed or release published; includes install-and-run validation step before publish

provenance:
  capturedBy: claude
---

# Release Workflow

Publishes @chrisjowen/wheelhouse to npm when a version tag (vX.Y.Z) is pushed or a GitHub release is published.

## Triggers

- Push of tags matching `v[0-9]+.[0-9]+.[0-9]+*` pattern
- GitHub release published

## Authentication

Uses npm trusted publishing via GitHub OIDC; npm token in repository secrets as fallback.

## Steps

1. Checkout code
2. Setup Node 22 with npm cache and npm registry auth
3. Update npm to 11.5.1+ (required for trusted publishing)
4. Install dependencies (`npm ci`)
5. Check tag matches package.json version
   - Skips all subsequent steps if version already published
6. Type-check (`npm run check`) - if unpublished
7. Lint (`npm run lint`) - if unpublished
8. Unit tests (`npm run test:unit`) - if unpublished
9. Install the package and start the CLI - if unpublished
   - Creates temp directory
   - Packs the package to temp
   - Installs globally into temp prefix
   - Runs `wheelhouse --help` and `wheelhouse --version` to verify startup
10. Publish to npm
    - Pre-releases go to "next" dist-tag
    - Full releases go to "latest" dist-tag
    - Publishes with provenance
11. Skip notice if already published

## Rationale for Install-and-Run Step

Validates that the built artifact starts correctly before publishing, catching build failures that would otherwise ship to npm without running the built CLI.
