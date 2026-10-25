---
id: feature.task-page-left-layout
type: feature
title: Task page left-column layout with overview, terminal, and time
tags:
  - task-page
  - layout
  - terminal
  - ui
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
        note: Code review phase for task page layout redesign branch fm/wh-task-layout-left
  - rel: implements
    target: requirement.task-terminal-left
    evidence:
      - source: conversation
        session: f16023ee-41df-4660-a0e8-4285cc3f4e4e
        observedAt: '2026-10-25'
        observedBy: claude
        note: User intent required live terminal and time to be displayed in left column alongside task overview

evidence:
  - source: conversation
    session: f16023ee-41df-4660-a0e8-4285cc3f4e4e
    observedAt: '2026-10-25'
    observedBy: claude
    note: >
      Branch fm/wh-task-layout-left reviewed in no-mistakes code-review phase. Changes implement
      task page redesign moving live terminal view and time information (elapsed / where time went)
      from right-hand tabs into left column pinned with task overview. Builds on PR #21 which
      introduced left-pinned overview and right-side tabs (Stages, Live preview, log).

provenance:
  capturedBy: claude
---

# Task page left-column layout with overview, terminal, and time

Part of the ongoing Wheelhouse task page redesign. The captain wants the live terminal view and
elapsed time / time distribution information displayed in the left column alongside the task overview,
rather than hidden behind right-hand tabs. This reorganizes the task page information hierarchy,
putting operational information (live terminal output, time spent) and task context (overview) together
on the left, with action-oriented tabs (Stages, Live preview, log) on the right.

Reviewed in code-review phase of no-mistakes gate for branch `fm/wh-task-layout-left` (commits
between 6b394a0...0465c92) on 2026-10-25. The feature consolidates terminal-in-browser capability
(web-sessions feature) with task page layout enhancements.
