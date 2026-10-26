---
id: feature.harbour-layouts
type: feature
title: Harbour layout modes (large, compact, list)
tags:
  - harbour
  - ui
  - views
  - layouts

attributes:
  status: shipped

links:
  - rel: depends_on
    target: feature.task-page-left-layout
    evidence:
      - source: code
        path: src/lib/views.ts
        observedAt: '2026-10-26'
        observedBy: claude
        session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
        note: Views module builds on task layout foundations to provide layout switching

evidence:
  - source: code
    path: src/lib/views.ts
    symbol: BoardView
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      View type for Harbour board layouts. Defines three modes: 'large' (with pictures
      and full story), 'compact' (condensed card format), and 'list' (one row per task).
      BOARD_VIEWS constant exports all available modes.

  - source: code
    path: src/lib/views.ts
    symbol: VIEW_COOKIE
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Cookie key wh-harbour-view persists user's chosen Harbour layout preference
      across sessions. Allows users to set their preferred view and have it remembered.

  - source: code
    path: src/lib/components/wh/views/ViewToggle.svelte
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      UI component that lets users switch between the three Harbour view modes.
      Integrates with view preferences to update display dynamically.

  - source: code
    path: src/lib/components/wh/views/CompactCard.svelte
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Compact card layout for Harbour. Shows condensed task information for
      browsing many tasks at once without full detail.

  - source: code
    path: src/lib/views.test.ts
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Test suite for view logic including view selection, sorting, and filtering.
      Tests cover: viewOf (selecting/validating layout), nextSort (column header click
      behavior with toggle and initial direction), waitingOn (categorizing task status),
      updatedAt (finding most recent activity), sortTasks (by status, waiting-on,
      project, update time, or passage stage), and projectStats (counting work metrics).

  - source: code
    path: src/lib/views.ts
    symbol: sortTasks
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Task sorting logic. Supports sorting by: task name, status (pressing first),
      waiting-on (you, firstmate, crew, queue, nobody), project, update time
      (newest first), and passage stage (how far along). Status order prioritizes
      review/decision > blocked > unknown > firstmate > working > queued > done.

  - source: code
    path: src/lib/views.ts
    symbol: projectStats
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Computes project-level statistics. Counts: work under way (working or
      with-firstmate), what needs the user (needs-review or needs-decision),
      what landed this week (by mergedAt timestamp). Also tracks most recent
      activity timestamp across all project tasks.

  - source: code
    path: src/lib/views.ts
    symbol: nextSort
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Sorting behavior when user clicks column headers. Same column toggles
      between asc/desc. New column starts at a configurable natural direction
      (e.g., desc for 'updated', asc for 'task name').

  - source: infrastructure
    path: .git
    symbol: "068bfaf"
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Commit implementing Harbour layouts (large, compact, list) feature.
      Commit message: "feat: Harbour layouts (large, compact, list) and a Projects page
      listing every project"

  - source: docs
    path: docs/guide.md
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Guide documentation describes Harbour layouts (Large, Compact, List) on line 47.
      Large shows full cards above; Compact keeps only title, project tag, status,
      passage strip and question count; List puts one row per task with project,
      current step, status, waiting-on, and last moved time, with sortable columns.

provenance:
  capturedBy: claude
---

# Harbour layout modes (large, compact, list)

Users can switch between three different layouts for viewing Harbour tasks:

- **Large**: Full cards with pictures and complete task information
- **Compact**: Condensed cards for browsing many tasks
- **List**: One row per task for table-like scanning

The user's preferred layout is remembered in the `wh-harbour-view` cookie per session.
