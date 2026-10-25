---
name: ci
id: pipeline.ci
type: pipeline
title: CI Workflow

attributes:
  provider: GitHub Actions
  path: .github/workflows/ci.yml
  triggers:
    - pull_request
    - push to main

links:
  - rel: defined_in
    target: repository.wheelhouse
  - rel: tests
    target: test_suite.unit
  - rel: tests
    target: test_suite.smoke

evidence:
  - source: infrastructure
    path: .github/workflows/ci.yml
    observedAt: '2026-10-25'
    observedBy: claude
    session: 323d6e3b-9ff0-49ca-bc37-e286e5ebcd9f
    note: CI workflow runs on pull_request and push to main; checks, lints, unit tests, builds package, then installs and starts the CLI

provenance:
  capturedBy: claude
---

# CI Workflow

Runs on pull requests and pushes to main. Performs type checking, linting, unit tests, packaging, and validates the package by installing and running the CLI.

## Steps

1. Checkout code
2. Setup Node 22 with npm caching
3. Install dependencies (`npm ci`)
4. Type-check (`npm run check`)
5. Lint (`npm run lint`)
6. Unit tests (`npm run test:unit`)
7. Package contents with `npm pack --dry-run` (validates build)
8. Install the package and start the CLI (validates built artifact starts correctly)
   - Creates temp directory
   - Packs the package to temp
   - Installs globally into temp prefix
   - Runs `wheelhouse --help` and `wheelhouse --version` to verify startup

## Rationale

The "Install the package and start the CLI" step added in this session validates that the built artifact is functional and starts correctly, catching build failures (bad external imports in the esbuild bundle, runtime dependency issues) that would otherwise ship to npm.
