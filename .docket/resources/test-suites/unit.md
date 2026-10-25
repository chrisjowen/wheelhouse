---
id: test_suite.unit
type: test_suite
title: Unit tests
tags:
- tests
attributes:
  framework: vitest
  kind: unit
  path: src/**/*.test.ts
links:
- rel: tests
  target: service.wheelhouse
  evidence:
  - source: config
    path: vite.config.ts
    lines: 11-18
    symbol: test.projects[unit]
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/vite.config.ts#L11-L18
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: defined_in
  target: repository.wheelhouse
  evidence:
  - source: manifest
    path: package.json
    lines: '28'
    key: scripts.test:unit
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L28
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: config
  path: vite.config.ts
  lines: 11-18
  symbol: test.projects[unit]
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/vite.config.ts#L11-L18
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: docs
  path: README.md
  lines: '204'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L204
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: conversation
  observedAt: '2026-10-11'
  observedBy: claude
  session: 45c548d4-7d40-4263-831f-f992844901a5
  note: "Unit tests: 340 of 340 tests passing after rebase onto 4fea579 and conflict resolution"

- source: conversation
  observedAt: '2026-10-11'
  observedBy: claude
  session: 8351d016-e8c7-446a-8237-a9dab55a7367
  note: "All 340 unit tests passing after rebase and merge conflict resolution in no-mistakes CI phase"

- source: conversation
  session: 0f320365-b59e-4b94-89dc-471c1a1d4043
  observedAt: '2026-10-25'
  observedBy: claude
  note: >-
    Test phase (no-mistakes gate-step) ran focused unit tests for files changed in
    commit 05aa69c (docket-chart-ui-trim). Verified docket plugin changes
    (plugin.server.ts, plugin.test.ts), Chart component tests, and FirstMate rail
    integration tests. All focused tests pass.

- source: runtime
  session: ac2a66e2-d79c-4230-8280-0e81660d875b
  observedAt: '2026-10-25'
  observedBy: claude
  note: "Insights unit tests run via `npx vitest run --project unit src/lib/server/insights src/lib/insights.test.ts`: 70 tests passed. Covers timing calculation with overlapping waits, decision ID uniqueness per review round, and disagree-draft handling for missing tasks."

provenance:
  capturedBy: claude
---

# Unit tests

Vitest project `unit` (`npm run test:unit`): colocated `*.test.ts` files under
`src/` and `cli/`, covering the adapter, store, messenger, security hooks,
collector and plugins.
