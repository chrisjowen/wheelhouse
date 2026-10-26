---
id: feature.projects-page
type: feature
title: Projects page listing all projects
tags:
  - projects
  - ui
  - navigation
  - overview

attributes:
  status: shipped

links:
  - rel: implements
    target: api.wheelhouse-http
    evidence:
      - source: code
        path: src/routes/projects/+page.server.ts
        observedAt: '2026-10-26'
        observedBy: claude
        session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
        note: Server-side endpoint for projects page loading and filtering

evidence:
  - source: code
    path: src/routes/projects/+page.svelte
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      New page route for listing all projects. Serves as a dashboard showing every
      project with its metadata and current status statistics.

  - source: code
    path: src/routes/projects/+page.server.ts
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Server loader for projects page. Fetches all projects from the project registry
      and computes statistics for each project (tasks under way, waiting on user, landed this week).

  - source: code
    path: src/lib/components/wh/views/ProjectCard.svelte
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Card component for displaying a single project in card view on the Projects page.
      Shows project name, description, work statistics (under way, needs you, landed this week),
      and linked resources. Each card links to the Harbour page for that project.

  - source: code
    path: src/lib/components/wh/views/ProjectTable.svelte
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Table component for displaying projects in list/table view on the Projects page.
      Shows sortable columns for project metadata and statistics. Clicking a row
      navigates to that project's Harbour.

  - source: code
    path: src/lib/views.ts
    symbol: ProjectsView
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      View type for Projects page layouts. Defines 'cards' and 'list' view modes.
      PROJECTS_VIEWS constant exports all available modes. Projects page layout
      preference is stored in wh-projects-view cookie.

  - source: code
    path: src/lib/views.test.ts
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Test suite includes tests for ProjectsView logic, ProjectStats calculation,
      ProjectLink resolution, and view switching between cards and list modes.
      Tests verify projectStats counts work under way, needs you, landed this week,
      and lastActivity. Tests for sortProjects verify sorting by any stat metric
      with name as tiebreaker.

  - source: code
    path: src/lib/views.ts
    symbol: sortProjects
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Project sorting logic. Supports sorting by: project name (alphabetical),
      underWay (number of working tasks), needsYou (awaiting review/decision),
      landed (merged this week), or queued (waiting to start). Name acts as
      tiebreaker for stat-based sorting.

  - source: code
    path: src/lib/views.ts
    symbol: postureWords
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Interprets project posture string and produces human-readable descriptions
      of how changes ship and who merges. Handles modes like no-mistakes-prod-only,
      direct-PR, local-only with optional flags. Generates both detailed text and
      a short one-liner for display.

  - source: code
    path: src/lib/client/view.ts
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Client-side view utilities for managing and persisting view preferences using cookies.
      Provides functions for reading/writing view state in localStorage or cookies.

  - source: infrastructure
    path: .git
    symbol: "068bfaf"
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Commit implementing Projects page feature. Commit message: "feat: Harbour layouts
      (large, compact, list) and a Projects page listing every project"

  - source: docs
    path: docs/guide.md
    observedAt: '2026-10-26'
    observedBy: claude
    session: 879387e7-eee3-452f-8786-8b0c2c3b6e3e
    note: >-
      Guide documentation describes Projects page on line 48. Projects are displayed
      as cards showing description, task counts (under way, needs you, landed this week),
      dots for each open task, delivery posture, last activity time, and links to Harbour,
      passage, editor, plugin tabs and repository. Cards | List toggle allows switching
      between card and sortable row views, with preference remembered in browser.

provenance:
  capturedBy: claude
---

# Projects page listing all projects

A new top-level page at `/projects` that shows every project in the Wheelhouse workspace.
The page displays project cards or a table view (user selectable), each showing:

- Project name and description
- Work statistics: tasks under way, waiting on the user, landed this week
- Related resources and external links
- Navigation to the project's Harbour for detailed task management

The user's preferred layout (cards or list) is remembered in the `wh-projects-view` cookie.
