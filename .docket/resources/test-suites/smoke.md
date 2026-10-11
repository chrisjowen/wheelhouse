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
provenance:
  capturedBy: claude
---

# Smoke tests

Vitest project `smoke` (`npm run test:smoke`, which builds first): starts the
built CLI and server against a fake Firstmate home from
`tests/helpers/fake-firstmate.ts`, with 60 s timeouts.
