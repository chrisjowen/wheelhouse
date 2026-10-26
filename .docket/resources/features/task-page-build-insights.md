---
id: feature.task-page-build-insights
type: feature
title: Build insights on task page (conversation, checks, docs)

status: shipped

tags:
  - task-page
  - build
  - ui
  - wheelhouse
  - review-phase

links:
  - rel: part_of
    target: project.wh-build-insight
    evidence:
      - source: conversation
        session: 54991214-0be1-4605-986b-df9cde72921e
        observedAt: 2026-10-26
        observedBy: claude
        note: Code review phase for fm/wh-build-insight branch

evidence:
  - source: conversation
    session: 54991214-0be1-4605-986b-df9cde72921e
    observedAt: 2026-10-26
    observedBy: claude
    note: >
      Branch fm/wh-build-insight implements feature to show Firstmate conversation Q&A,
      check results (passed/failed), and referenced documentation on the task page during
      build execution. Complements task-page-left-layout by adding build-phase visibility.

provenance:
  capturedBy: claude
---

# Build insights on task page

Displays conversation between Firstmate and workers, test/check outcomes, and referenced
documentation directly on the task page during build execution. This allows builders to see
the flow of decisions and results without switching contexts.

Committed in branch fm/wh-build-insight with optimizations for worker transcript reading
(reading only appended portions for performance) and UX refinements (one meaning per count,
plain failure names, Checks stage fallback to latest report).

Builds on task-page-left-layout feature to extend task page information architecture.
