---
id: library.docket-plugin
type: library
title: Docket plugin for Wheelhouse
tags:
  - wheelhouse
  - plugins
  - visualization
attributes:
  language: typescript
  package: '@wheelhouse/docket-plugin'
links:
  - rel: depends_on
    target: library.plugin-system
    evidence:
      - source: code
        path: src/lib/plugins/docket/plugin.server.ts
        lines: 7
        symbol: ProviderContext, WheelhousePlugin
        observedAt: '2026-10-11'
        observedBy: claude
        session: 5703edca-a69f-4805-b0ab-5496e3248e3d
        note: Imports plugin types and context from plugin system.

  - rel: depends_on
    target: system.docket
    evidence:
      - source: code
        path: src/lib/plugins/docket/plugin.server.ts
        lines: '119-125'
        symbol: readGraph
        observedAt: '2026-10-11'
        observedBy: claude
        session: 5703edca-a69f-4805-b0ab-5496e3248e3d
        note: Executes docket CLI to read project graph via `docket graph --json`.


evidence:
  - source: code
    path: src/lib/plugins/docket/plugin.server.ts
    lines: '1-26'
    symbol: module header and exports
    commit: 587886c
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/587886c/src/lib/plugins/docket/plugin.server.ts#L1-L26
    observedAt: '2026-10-11'
    observedBy: claude
    session: 5703edca-a69f-4805-b0ab-5496e3248e3d
    note: Plugin that reads docket graphs and provides three providers for visualization.

  - source: code
    path: src/lib/plugins/docket/Chart.svelte
    lines: '11-15'
    symbol: component documentation
    commit: 587886c
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/587886c/src/lib/plugins/docket/Chart.svelte#L11-L15
    observedAt: '2026-10-11'
    observedBy: claude
    session: 5703edca-a69f-4805-b0ab-5496e3248e3d
    note: Chart component provides read-only map, inspector and key for docket visualization.

  - source: code
    path: src/lib/plugins/docket/plugin.test.ts
    lines: '14-19'
    symbol: module header
    commit: 587886c
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/587886c/src/lib/plugins/docket/plugin.test.ts#L14-L19
    observedAt: '2026-10-11'
    observedBy: claude
    session: 5703edca-a69f-4805-b0ab-5496e3248e3d
    note: Tests verify plugin registry integration with fake docket commands.

  - source: docs
    path: README.md
    lines: '63-64'
    commit: 587886c
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/587886c/README.md#L63-L64
    observedAt: '2026-10-11'
    observedBy: claude
    session: 5703edca-a69f-4805-b0ab-5496e3248e3d
    note: Plugins section describes how plugins add to fixed places on pages.

provenance:
  capturedBy: claude
---

# Docket plugin for Wheelhouse

A Wheelhouse plugin that visualizes a project's docket — a local-first system 
of Markdown files under `.docket/` describing the system's services, data, 
owners and constraints — as an interactive chart.

The plugin reads the docket's graph via the docket CLI (`docket graph --json`), 
caches it for a few seconds, and matches files changed in running tasks against 
the docket's exhibits to show what each task touches and what restricted waters 
it crosses.

## Three providers and UI components

- **Chart** (`project.tab`): A read-only map of the system showing all landmarks 
  (services, datasources, systems, teams, environments), the routes between them 
  (dependencies, ownership, deployment), and vessels (tasks under way). An 
  inspector side panel shows details about selected landmarks. A key explains the 
  confidence levels (charted, approximate, doubtful) and unsurveyed landmarks.

- **Waters this passage crosses** (`task.section`): Shows what docket exhibits 
  the task's changed files touch, which of those are in restricted waters 
  (governed by constraints), and links to the full chart with the task highlighted.

- **Hazards ahead** (`harbour.card`): Lists tasks under way that are in 
  restricted waters, what they touch, and what constraints apply, so the captain 
  can see compliance risks at a glance.

## Configuration

Settings in `plugins.json`, all optional:

- `bin`: absolute path of the docket CLI (default: `docket` on PATH)
- `roots`: a map of `{ "<project id>": "<absolute dir>" }` to read that 
  project's docket instead of its clone's, for example to use an example docket 
  until a project keeps one
- `timeoutMs`: how long `docket graph` may take (default 8000, max 9500)

The plugin is enabled only for projects that have a `.docket.yaml` marker file.

## Not observable

The plugin reads only; it never writes to the docket. Edits happen via the 
docket's own UI or by running `docket remember` from a terminal.
