---
id: constraint.docket-viewer-port-stability
type: constraint
title: Docket viewer port assignments are not stable across project changes

tags:
  - docket
  - plugins
  - wheelhouse
  - service-health

links:
  - rel: governs
    target: service.wheelhouse
    evidence:
      - source: code
        path: src/lib/plugins/docket/plugin.server.ts
        lines: 83-100
        symbol: viewerPort
        observedAt: '2026-10-26'
        observedBy: claude
        session: c550251b-4029-420e-98e3-f044b40c70af
        note: viewerPort function assigns ports based on ctx.projects, which changes when docket is enabled/disabled

evidence:
  - source: code
    path: src/lib/plugins/docket/plugin.server.ts
    lines: 83-100
    symbol: viewerPort
    observedAt: '2026-10-26'
    observedBy: claude
    session: c550251b-4029-420e-98e3-f044b40c70af
    note: viewerPort assigns ports by walking ctx.projects, which registry.service fills with only docket-enabled projects sorted by id

  - source: code
    path: src/lib/server/plugins/registry.ts
    lines: 305-310
    symbol: registry.service
    observedAt: '2026-10-26'
    observedBy: claude
    session: c550251b-4029-420e-98e3-f044b40c70af
    note: registry.service filters projects to only those with docket enabled

  - source: conversation
    session: c550251b-4029-420e-98e3-f044b40c70af
    observedAt: '2026-10-26'
    observedBy: claude
    note: Review found that ports shift when project set changes, allowing wrong-viewer scenarios where stale viewers answer health checks for other projects

provenance:
  capturedBy: claude
---

# Docket viewer port assignments are not stable across project changes

When the set of docket-enabled projects in Wheelhouse changes, docket viewer port assignments can shift. This creates a constraint on how port health checks are validated.

## Constraint

The `viewerPort` function in `src/lib/plugins/docket/plugin.server.ts` assigns ports by walking `ctx.projects`, which `registry.service` fills with only the docket-enabled projects at the time of assignment, sorted by id. Each project's port therefore depends on which other projects currently have docket enabled.

When a project's docket status changes (enabled or disabled), when a project is added or removed, or when port configuration changes, the port order may shift, causing previously-allocated ports to move to different projects.

## Failure scenario

Projects `p65` and `p100` hash to the same port `H`:
1. Only `p65` has docket enabled, so `p65` gets port `H` and its viewer is started there
2. User enables docket for `p100`
3. `p100` sorts before `p65` alphabetically, so `p100` now takes port `H` and `p65` moves to `H+1`
4. When `p100`'s viewer service health-checks port `H`, it finds `p65`'s still-running viewer answering `2xx` on `/api/adapters`
5. `p100`'s health check reports "running" but opens `p65`'s docket viewer instead (wrong viewer)
6. Meanwhile `p65` incorrectly reads as "stopped" even though its viewer is running on `H+1`

The same port reshuffling occurs when docket is disabled for a project or a `ports` configuration setting changes.

## Mitigation

A full fix requires either:
- **Stable port assignments**: Store port allocations durably so they do not change when the project set changes
- **Identity confirmation**: Check the viewer's identity (e.g., its root document) in health checks rather than just checking for a `2xx` response

The current implementation (as of 2026-10-26) health-checks for `2xx` responses and validates status codes, but does not address the underlying port assignment instability.

## Status

Identified during review of Wheelhouse service health checks. Acknowledged as beyond the scope of the current fix round but needing resolution for robust operation.
