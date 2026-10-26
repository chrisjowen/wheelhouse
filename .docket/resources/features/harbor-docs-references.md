---
id: feature.harbor-docs-references
type: feature
title: ADR and documentation references visible in Harbor

status: planned

tags:
  - harbor
  - adr
  - documentation
  - ui
  - wheelhouse

links:
  - rel: part_of
    target: project.wh-build-insight
    evidence:
      - source: conversation
        session: 54991214-0be1-4605-986b-df9cde72921e
        observedAt: 2026-10-26
        observedBy: claude
        note: User intent requires visibility of ADR and docs that build sessions reference

evidence:
  - source: conversation
    session: 54991214-0be1-4605-986b-df9cde72921e
    observedAt: 2026-10-26
    observedBy: claude
    note: >
      User intent: "we should be able to see all ADR or docs the sessions reference in the
      harbor". Harbor (fleet overview) should display architecture decision records and
      documentation that are referenced by build sessions/tasks.

provenance:
  capturedBy: claude
---

# ADR and documentation references visible in Harbor

Extend the Harbor (fleet/project overview) to display all architecture decision records and
documentation that are referenced during build sessions. This provides overview-level context
of the documentation landscape being used in build tasks.

Status: Planned, not yet implemented in fm/wh-build-insight branch.
