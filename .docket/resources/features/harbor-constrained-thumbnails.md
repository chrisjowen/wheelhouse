---
id: feature.harbor-constrained-thumbnails
type: feature
title: Harbor design thumbnail size constraints
tags:
  - harbor
  - thumbnails
  - ui
  - layout
  - wheelhouse

status: shipped

attributes: {}

links:
  - rel: part_of
    target: project.wh-task-layout-left
    evidence:
      - source: conversation
        session: f16023ee-41df-4660-a0e8-4285cc3f4e4e
        observedAt: '2026-10-25'
        observedBy: claude
        note: Code review phase requirement for harbor screenshot thumbnails sizing

evidence:
  - source: conversation
    session: f16023ee-41df-4660-a0e8-4285cc3f4e4e
    observedAt: '2026-10-25'
    observedBy: claude
    note: >
      User intent specifies thumbnail sizes in Harbour design (cards and task page) should be
      constrained to a fixed size rather than variable. Reviewed as part of task page redesign
      changes on branch fm/wh-task-layout-left. Harbour is the fleet overview page showing task
      cards with screenshot evidence.

provenance:
  capturedBy: claude
---

# Harbor design thumbnail size constraints

Part of the task page redesign effort. The captain requested that screenshot thumbnails displayed
in the Harbour design (both on the fleet overview cards and on task pages) be held to a constrained,
fixed size rather than expanding based on content.

Requirement captured during code-review phase of no-mistakes gate for branch `fm/wh-task-layout-left`
on 2026-10-25. This is a UI design constraint affecting the Harbour (fleet overview) page and task
page screenshot evidence display.
