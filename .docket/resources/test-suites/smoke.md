---
id: test_suite.smoke
type: test_suite
title: Smoke tests
tags:
- tests
attributes:
  framework: vitest
  kind: integration
  path: tests/smoke
links:
- rel: tests
  target: service.wheelhouse
  evidence:
  - source: code
    path: tests/smoke/server.test.ts
    lines: '104'
    symbol: describe('wheelhouse open')
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/tests/smoke/server.test.ts#L104
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Starts the built CLI against a fake Firstmate home.
  - source: code
    path: tests/smoke/server.test.ts
    symbol: 'check the Bridge serves the focused task thread'
    commit: '6595c05'
    observedAt: '2026-10-11'
    observedBy: claude
    session: a03b19d8
    note: Test validates Bridge focuses on one thread at a time, showing decisions as questions.
- rel: defined_in
  target: repository.wheelhouse
  evidence:
  - source: manifest
    path: package.json
    lines: '29'
    key: scripts.test:smoke
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L29
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: config
  path: vite.config.ts
  lines: 19-28
  symbol: test.projects[smoke]
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/vite.config.ts#L19-L28
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: code
  path: tests/helpers/fake-firstmate.ts
  lines: '190'
  symbol: FakeFirstmate
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/tests/helpers/fake-firstmate.ts#L190
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1

- source: conversation
  session: 0f320365-b59e-4b94-89dc-471c1a1d4043
  observedAt: '2026-10-25'
  observedBy: claude
  note: >-
    Test phase (no-mistakes gate-step) verified smoke tests pass against commit 05aa69c
    (docket-chart-ui-trim). Tested Wheelhouse server with fake Firstmate home. All
    scenarios pass, including Chart full-width layout, details panel resize, and
    Firstmate rail resize functionality.

- source: runtime
  session: ac2a66e2-d79c-4230-8280-0e81660d875b
  observedAt: '2026-10-25'
  observedBy: claude
  note: "Full smoke test run via `npx vitest run --project smoke` on this commit (insights fixes) and on base commit 8b758fc (for comparison). New test 'renders the insight pages, reading no real usage or limits' passes. Two older tests fail on both commits (waitFor race on 'Firstmate as running elsewhere' and plugins slot rendering), confirming they are pre-existing."

provenance:
  capturedBy: claude
---

# Smoke tests

Vitest project `smoke` (`npm run test:smoke`, which builds first): starts the
built CLI and server against a fake Firstmate home from
`tests/helpers/fake-firstmate.ts`, with 60 s timeouts.
