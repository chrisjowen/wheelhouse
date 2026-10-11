---
id: repository.wheelhouse
type: repository
title: Wheelhouse repository
tags:
- wheelhouse
- firstmate
attributes:
  url: https://github.com/chrisjowen/wheelhouse
  defaultBranch: main
links:
- rel: contains
  target: service.wheelhouse
  evidence:
  - source: manifest
    path: package.json
    lines: 8-10
    key: bin.wheelhouse
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L8-L10
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: The package publishes the wheelhouse CLI from dist/cli.js.
- rel: contains
  target: library.firstmate-adapter
  evidence:
  - source: code
    path: src/lib/server/firstmate/adapter.ts
    lines: 17-24
    symbol: createScriptAdapter
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/adapter.ts#L17-L24
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: contains
  target: library.collector
  evidence:
  - source: code
    path: src/lib/server/collector/collector.ts
    lines: 16-29
    symbol: Collector
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/collector/collector.ts#L16-L29
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: contains
  target: library.message-store
  evidence:
  - source: code
    path: src/lib/server/store/store.ts
    lines: 7-18
    symbol: MessageStore
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/store/store.ts#L7-L18
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: contains
  target: library.plugin-system
  evidence:
  - source: code
    path: src/lib/server/plugins/builtin.ts
    lines: 1-5
    symbol: BUILTIN_PLUGINS
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/plugins/builtin.ts#L1-L5
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: contains
  target: test_suite.unit
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
- rel: contains
  target: test_suite.smoke
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
- rel: contains
  target: document.mvp-spec
  evidence:
  - source: docs
    path: docs/spec.md
    lines: 1-3
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/docs/spec.md#L1-L3
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: The MVP spec lives in the repository at docs/spec.md.
evidence:
- source: manifest
  path: package.json
  lines: 1-5
  key: name
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L1-L5
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Package @chrisjowen/wheelhouse 0.1.0, private, "A local companion to Firstmate".
- source: docs
  path: README.md
  lines: 1-3
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L1-L3
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: README introduces Wheelhouse and its clone URL.
provenance:
  capturedBy: claude
---

# Wheelhouse repository

The source repository for Wheelhouse, a local web UI and CLI companion to
Firstmate (`chrisjowen/wheelhouse`, default branch `main`). It holds one
deliverable - the `wheelhouse` service (SvelteKit app plus Commander CLI) - its
internal server modules, unit and smoke test suites, and the MVP spec under
`docs/spec.md`. The package is private and not published to npm; README says to
install from a clone with `npm ci && npm run build && npm link`.

No CI workflow is checked in (there is no `.github/` directory at this commit).
