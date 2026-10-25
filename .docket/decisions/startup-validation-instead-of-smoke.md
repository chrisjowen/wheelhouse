---
name: startup-validation-instead-of-smoke
id: decision.startup-validation-instead-of-smoke
type: decision
title: Validate package startup in CI/Release instead of running smoke tests

status: accepted

links:
  - rel: affects
    target: pipeline.ci
  - rel: affects
    target: pipeline.release
  - rel: mitigates
    target: test_suite.smoke

evidence:
  - source: conversation
    session: 323d6e3b-9ff0-49ca-bc37-e286e5ebcd9f
    observedAt: '2026-10-25'
    observedBy: claude
    note: >-
      Code review finding: smoke tests assume tmux and Claude Code are installed,
      and fail 4 of 21 tests on stock node:22 Linux image even with tmux installed
      (verified in container). Risk: a package that compiles but fails to start (bad
      external import in esbuild bundle, runtime dependency issue) would ship to npm.
      Resolution: instead of adding npm run test:smoke to workflows, add "Install
      the package and start the CLI" step to both CI and Release workflows. This
      validates the built artifact starts without requiring the full browser-based
      smoke test environment.

provenance:
  capturedBy: claude
---

# Validate Package Startup Instead of Running Smoke Tests

## Problem

The smoke tests (`npm run test:smoke`) require tmux and Claude Code to be installed. When tested on a stock `node:22` Linux image with tmux available, 4 of 21 tests still fail. This makes the smoke tests unsuitable for CI/Release pipelines.

However, there is a real risk: a package that compiles successfully but fails to start (due to bad external imports in the esbuild CLI bundle or missing runtime dependencies) could ship to npm undetected.

## Solution

Rather than running the full smoke test suite in CI and Release workflows, add a lighter-weight validation step that:

1. Packs the package locally with `npm pack --pack-destination`
2. Installs the packed tarball globally into a temporary prefix with `npm install -g --prefix`
3. Runs the installed CLI with `wheelhouse --help` and `wheelhouse --version`

## Implementation

This step is now present in both `.github/workflows/ci.yml` (lines 43-49) and `.github/workflows/release.yml` (lines 74-81), running after the package is built but before merge (CI) or publish (Release).

## Rationale

- **Catches build failures**: Detects bad imports, missing runtime dependencies, and other startup issues
- **No external dependencies**: Doesn't require tmux, Claude Code, or browser automation
- **Fast**: Runs in seconds on any environment
- **Validates the shipped artifact**: Tests the actual tar.gz that will be published, not the source code
