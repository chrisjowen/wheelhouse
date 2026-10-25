---
id: requirement.harbour-thumbnail-constraint
type: requirement
title: Harbour screenshot thumbnails must have constrained size
tags:
  - harbour
  - thumbnails
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
      User (captain) stated requirement: "constrain the size of the thumbnails" for harbour design.
      Applies to screenshot thumbnails both on harbour cards (fleet overview) and on task pages.
      Stated while reviewing task page redesign changes on branch fm/wh-task-layout-left.

provenance:
  capturedBy: claude
---

# Harbour screenshot thumbnails must have constrained size

Requirement from the captain: screenshot evidence thumbnails in the Harbour design should be
displayed at a fixed, constrained size rather than expanding based on image dimensions or viewport.

Applies to:
- Harbour cards (fleet overview page)
- Task page screenshot evidence display

Stated during code-review of task page redesign changes on branch fm/wh-task-layout-left.
