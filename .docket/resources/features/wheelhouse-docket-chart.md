---
id: feature.wheelhouse-docket-chart
type: feature
title: Wheelhouse docket Chart - read-only per-project system map

tags:
  - wheelhouse
  - docket
  - plugin
  - visualization
  - system-map

attributes:
  status: in_progress
  scope_change: >
    2026-10-25: Trimmed Waters section (task page) and Hazards card (Harbour).
    Chart enhanced to full-width with details pane on right (Firstmate layout).
    Legacy tab redirect removed.

links:
  - rel: documented_in
    target: decision.docket-chart-design
    evidence:
      - source: conversation
        session: 1062f05c-b039-4dd1-a3e6-ba542cc58ca8
        observedAt: 2026-10-11
        observedBy: claude
        note: Feature implements approved design decisions for docket Chart integration

  - rel: implements
    target: api.wheelhouse-http
    evidence:
      - source: conversation
        session: 93ad43f0-a06e-4e65-a1db-14f26d5e45e3
        observedAt: 2026-10-11
        observedBy: claude
        note: Chart is a read-only tab in Wheelhouse per-project interface

  - rel: depends_on
    target: library.plugin-system
    evidence:
      - source: conversation
        session: 93ad43f0-a06e-4e65-a1db-14f26d5e45e3
        observedAt: 2026-10-11
        observedBy: claude
        note: Chart is implemented as a Wheelhouse plugin

  - rel: depends_on
    target: datasource.wheelhouse-message-store
    evidence:
      - source: conversation
        session: 93ad43f0-a06e-4e65-a1db-14f26d5e45e3
        observedAt: 2026-10-11
        observedBy: claude
        note: Chart reads in-flight task data to render as vessels on system map

evidence:
  - source: code
    path: src/lib/plugins/docket/Chart.svelte
    lines: 1-200
    symbol: Chart
    observedAt: 2026-10-11
    observedBy: claude
    session: 93ad43f0-a06e-4e65-a1db-14f26d5e45e3
    note: Main Chart component implementing nautical system map visualization with regions by owner, production harbour, constrained waters, and vessel overlays

  - source: code
    path: src/lib/plugins/docket/plugin.server.ts
    lines: 1-350
    symbol: vessels, hazards, readGraph
    observedAt: 2026-10-11
    observedBy: claude
    session: 93ad43f0-a06e-4e65-a1db-14f26d5e45e3
    note: >-
      Server-side providers for Chart data: vessel rendering (tasks),
      hazards detection (constrained exhibits touched by in-flight work),
      and docket graph integration

  - source: code
    path: src/lib/plugins/docket/fixtures/acme.ts
    lines: 1-20
    symbol: acme fixtures
    observedAt: 2026-10-11
    observedBy: claude
    session: 93ad43f0-a06e-4e65-a1db-14f26d5e45e3
    note: Fixture data from docket's examples/acme-platform used until projects adopt their own docket

  - source: conversation
    session: 93ad43f0-a06e-4e65-a1db-14f26d5e45e3
    observedAt: 2026-10-11
    observedBy: claude
    note: Feature approved to start automatically once plugin slots and docket graph --json support landed

  - source: conversation
    session: 02bd65f4-fe81-427b-8d88-e4fbef88f153
    observedAt: 2026-10-11
    observedBy: claude
    note: Code review on branch fm/wh-docket-chart; user approved implementation design decisions for docket binary setting, error state handling, fixture opt-in, and CLI command display

  - source: conversation
    session: 50df6487-6120-4d45-8d72-f5399a66fd11
    observedAt: 2026-10-25
    observedBy: claude
    note: >-
      No-mistakes review of fm/wh-docket-trim branch (target 05aa69c). User determined Waters section
      (task page) and Hazards card (Harbour) are display-only, add no value during build. Approved
      removal of both features. Chart to be enhanced to full-width with details on right (Firstmate
      layout). Legacy /harbour tab redirect removed per user intent.

  - source: conversation
    session: 0f320365-b59e-4b94-89dc-471c1a1d4043
    observedAt: 2026-10-25
    observedBy: claude
    note: >-
      Test phase verification of docket-chart-ui-trim changes (commit 05aa69c). Confirmed:
      Chart fills window with resizable details panel on right; legacy /harbour tab redirect removed;
      docket plugin contributes only Chart tab; Firstmate rail resizing works; focused unit tests
      for changed files pass. No layout regressions or integration issues observed.

provenance:
  capturedBy: claude
---

# Wheelhouse docket Chart

A read-only, per-project system map in Wheelhouse that visualizes a project's
docket graph using nautical metaphor: ownership regions, production as a
harbour, constraints as restricted waters, in-flight tasks as vessels, and
evidence confidence as line styling (solid/dashed/dotted).

## Design

The Chart displays:
- **Regions by owner**: geographic or organizational grouping of system components
- **Production as a harbour**: special visual treatment for production environments
- **Constraints as restricted waters**: dashed or dotted lines representing durable constraints
- **In-flight tasks as vessels**: task overlays showing which parts of the system a task touches
- **Evidence age stamps**: survey-date annotations indicating when evidence was collected
- **Link confidence styling**:
  - Solid lines: high-confidence relationships
  - Dashed "PA" lines: relationships from code-level evidence
  - Dotted "ED" lines: relationships from external documentation

## Features

1. **Full-width Chart**: Per-project system map with chart on left, detail inspector on right (Firstmate layout)
2. **Inspector**: Read-only exhibit and evidence inspector for exploring system data
3. **Linkout**: "Open in docket" link shows copyable `docket open --root <path>` command for deep exploration in docket's editor
4. **No editing**: Intentionally read-only inside Wheelhouse — editing happens in docket itself

## Removed features (2026-10-25)

- **Waters section**: "Waters this passage crosses" on task pages — determined to be display-only during build, no build-time value
- **Hazards card**: "Hazards ahead" Harbour card — display-only, no build-time value

## Data source

Uses `docket graph --json` to read project system topology. When no project docket exists,
fixture data from docket's examples/acme-platform is used until the project adopts a docket.

The docket binary is configured as a plugin setting with PATH as the default, and the Chart
displays "docket CLI too old for the Chart - update docket" when `graph --json` is unsupported.

## Status

Reviewed and approved design; implementation in progress on branch `fm/wh-docket-chart`.
