---
id: project.wh-build-insight
type: project
title: Build Insight Dashboard

kind: milestone
status: active

tags:
  - wheelhouse
  - build
  - ui

attributes:
  key: fm/wh-build-insight

links: []

evidence:
  - source: conversation
    session: 54991214-0be1-4605-986b-df9cde72921e
    observedAt: 2026-10-26
    observedBy: claude
    note: User intent for build insight phase includes visibility into Firstmate Q&A, test outputs, ADR/docs, spec doc editor, and .wheelhouse config editing

provenance:
  capturedBy: claude
---

# Build Insight Dashboard

Multi-feature milestone to bring build-time information into Wheelhouse during the review and test phases. User wants visibility into conversations between Firstmate and workers, test pass/fail outcomes, documentation references, and configuration management during builds.

## Committed features (fm/wh-build-insight branch)

- Show conversation, checks, and docs from build tasks on the task page
- Read-only worker transcript buffering for performance
- UX refinements: one meaning per count, plain failure names, Checks stage fallback

## Planned features (not yet in branch)

- Spec doc builder tab for pre-Firstmate specification writing
- ADR and documentation reference visibility in Harbor
- .wheelhouse config editor for adding/editing build stages
- Local Kubernetes deployment stage for casebook project
