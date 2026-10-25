---
id: requirement.task-terminal-left
type: requirement
title: Task page live terminal and time in left column
tags:
  - task-page
  - terminal
  - layout
  - wheelhouse

priority: must

attributes:
  source: user intent - task page redesign phase

links:
  - rel: part_of
    target: project.wh-task-layout-left
    evidence:
      - source: conversation
        session: f16023ee-41df-4660-a0e8-4285cc3f4e4e
        observedAt: '2026-10-25'
        observedBy: claude

evidence:
  - source: conversation
    session: f16023ee-41df-4660-a0e8-4285cc3f4e4e
    observedAt: '2026-10-25'
    observedBy: claude
    note: >
      User (captain) stated requirement during task page redesign review: "live terminal and time
      should be on left". Context: redesigning task page following PR #21 which introduced
      left-pinned overview column. Time information includes elapsed time and breakdown of where
      time was spent on the task.

provenance:
  capturedBy: claude
---

# Task page live terminal and time in left column

Requirement from the captain: the live terminal view and time information (elapsed / where time went)
should be displayed in the left column of the task page alongside the task overview, not in
right-hand tabs.

Stated during code-review of branch fm/wh-task-layout-left, which implements this requirement by
moving the live terminal output and time metrics from behind tab controls on the right to the
left-column layout shared with the task overview.
