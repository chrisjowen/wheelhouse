---
id: project.wh-task-layout-left
type: project
title: Wheelhouse task page left-column redesign
tags:
  - wheelhouse
  - task-page
  - layout
  - ui

kind: milestone
status: done

attributes:
  key: fm/wh-task-layout-left

links:
  - rel: implements
    target: feature.task-page-left-layout
    evidence:
      - source: conversation
        session: f16023ee-41df-4660-a0e8-4285cc3f4e4e
        observedAt: '2026-10-25'
        observedBy: claude
  - rel: implements
    target: feature.harbor-constrained-thumbnails
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
      Code review phase of no-mistakes pipeline reviewed changes on branch fm/wh-task-layout-left
      (commits 6b394a0...0465c92). Requirements: move live terminal and time information to left
      column with task overview; constrain harbour screenshot thumbnail sizes. Related to PR #21
      (merged) which introduced left-pinned overview column and right-side tabs.

provenance:
  capturedBy: claude
---

# Wheelhouse task page left-column redesign

Redesign of the task page layout following the completion of PR #21 (full-width page with
left-pinned task overview and right-side tabs). This phase moves the live terminal view and
time/elapsed information from right-hand tabs into the left column alongside the overview.
Also constrains harbour screenshot thumbnail sizes to fixed dimensions.

Reviewed in code-review phase (no-mistakes gate-step) for branch `fm/wh-task-layout-left` on
2026-10-25. The change set spans commits 6b394a0...0465c92.
