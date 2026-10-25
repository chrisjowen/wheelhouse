---
id: pipeline.ci
type: pipeline
title: CI workflow

attributes:
  provider: github
  path: .github/workflows/ci.yml
  triggers:
    - pull_request
    - push to main

links:
  - rel: defined_in
    target: repository.wheelhouse
    evidence:
      - source: infrastructure
        path: .github/workflows/ci.yml
        lines: '1-42'
        symbol: 'jobs.check'
        commit: '1a2f1c0'
        observedAt: '2026-10-25'
        observedBy: claude
        session: dad277c6-9ab5-421d-8988-83aaf4b902b6
        note: GitHub Actions workflow that runs type-check, lint, unit tests and package contents checks

evidence:
  - source: infrastructure
    path: .github/workflows/ci.yml
    lines: '1-42'
    symbol: 'on.pull_request,on.push.branches'
    commit: '1a2f1c0'
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/1a2f1c0/.github/workflows/ci.yml
    observedAt: '2026-10-25'
    observedBy: claude
    session: dad277c6-9ab5-421d-8988-83aaf4b902b6
    note: CI runs on pull requests and pushes to main; includes type-check, lint, unit tests, and npm pack --dry-run

  - source: conversation
    session: dad277c6-9ab5-421d-8988-83aaf4b902b6
    observedAt: '2026-10-25'
    observedBy: claude
    note: Session review found CI does not run smoke tests (test:smoke), which are the only tests that start the built CLI against a fake Firstmate home

provenance:
  capturedBy: claude
---

# CI workflow

GitHub Actions workflow (`.github/workflows/ci.yml`) that runs on every pull request and push to main.

**Steps:**
- Type-check (`npm run check`)
- Lint (`npm run lint`)
- Unit tests (`npm run test:unit`)
- Package contents (`npm pack --dry-run` – this builds the app and CLI as a side effect)

**Gap:** Does not run smoke tests (`npm run test:smoke`), the only tests that actually start the built CLI (`dist/cli.js` + `build/`) against a fake Firstmate home.
