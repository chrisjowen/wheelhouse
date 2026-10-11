---
id: library.plugin-system
type: library
title: Plugin slots, registry and blocks
tags:
- wheelhouse
- internal-module
attributes:
  language: typescript
links:
- rel: depends_on
  target: library.firstmate-adapter
  evidence:
  - source: code
    path: src/lib/server/plugins/registry.ts
    lines: '15'
    symbol: runBounded
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/plugins/registry.ts#L15
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Provider exec reuses the bounded runner.
evidence:
- source: code
  path: src/lib/server/plugins/registry.ts
  lines: '155'
  symbol: PluginRegistry
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/plugins/registry.ts#L155
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: code
  path: src/lib/server/plugins/types.ts
  lines: '13'
  symbol: PLUGIN_API_VERSION
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/plugins/types.ts#L13
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: docs
  path: README.md
  lines: 130-150
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L130-L150
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: 'Plugins section: slots, isolation, versions, enablement.'
provenance:
  capturedBy: claude
---

# Plugin slots, registry and blocks

Compiled-in "panels and providers" (`src/lib/plugins/` for the slot and
block contract and panels, `src/lib/server/plugins/` for the registry and
`plugins.json` enablement). Five fixed slots (`project.tab`, `harbour.card`,
`task.section`, `step.evidence`, `bridge.card`); versioned blocks (`text.v1` ...
`graph.v1`); contract `apiVersion` 1. Providers run with a timeout and TTL cache
and read only through a confined `readFile` and bounded `exec`. One plugin ships:
`project-links` (`BUILTIN_PLUGINS` in `src/lib/server/plugins/builtin.ts`), off
unless enabled in `plugins.json`.

Modelled as a `library` (internal module).
