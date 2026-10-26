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

- source: conversation
  session: de0b6853-9625-4e33-b558-9e8a32a47046
  observedAt: '2026-10-26'
  observedBy: claude
  note: >-
    Smoke test with specs: against the built CLI with a fake Firstmate home. Spec
    smoke test passed. Ten spec UI/API scenarios verified: opening Spec tab,
    starting and filling sections with autosave, uploading screenshots, Send button
    guard (disabled until title present), 16 KiB size limit enforcement with plain
    message, sending to Firstmate inbox, marking sent with sentAt-only semantics,
    concurrent save/upload race conditions (20 rounds), session-token guard, and
    narrow layout responsiveness at 390px.

- source: runtime
  endpoint: 127.0.0.1:4310
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Built app tested with Playwright browser automation against test fixture. Fixture:
    two tasks with real git worktrees, fleet ledger (needs-decision and resolved lines),
    handled inbox .msg, run with intent/rebase/review/test logs (vitest: 14 passed, 1 failed),
    and transcripts with Read/Edit operations on ADR, README, and guide. Test verified seven
    build-insight feature scenarios, all passed: Conversation tab (answered + open questions),
    Checks tab (test summary 1 of 15 failed with output), Docs tab (filtered ADR/README/guide,
    no node_modules or other-branch noise), Harbour card (3 docs referenced · 1 changed link),
    large doc via git show (real heading, truncated text not 'not on this machine'),
    reader path validation (refused ../secret.md, /etc/passwd, other-branch docs, node_modules),
    narrow screen tab loading (page at scrollY 0, tab row scrollLeft 91).

provenance:
  capturedBy: claude
---

# Smoke tests

Vitest project `smoke` (`npm run test:smoke`, which builds first): starts the
built CLI and server against a fake Firstmate home from
`tests/helpers/fake-firstmate.ts`, with 60 s timeouts.
