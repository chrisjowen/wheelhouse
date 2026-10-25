---
id: feature.checks-stage-visibility
type: feature
title: Checks stage visibility in Wheelhouse
tags:
- wheelhouse
- validation
- ui
attributes:
  status: in_progress
links:
- rel: implements
  target: service.wheelhouse
evidence:
- source: conversation
  observedAt: '2026-10-25'
  observedBy: claude
  session: 0d480bfa-88e0-49f6-a67d-2be65d30fe4a
  note: >
    Branch fm/wh-checks-visibility (commits cab7210..8a91116, 17 files, 1553 insertions).
    Adds visibility of the checks/validation stage in the no-mistakes pipeline within Wheelhouse UI.
    Shows validation steps and progress on rail cards (ChecksStrip), harbour cards, and task pages
    (ChecksTimeline). Displays what each stage found or changed, fix application status, and CI
    results once PR is up. Implementation spans frontend components, backend evidence collection,
    and enhanced nmstatus model. Code review phase under no-mistakes gate completed 2026-10-25.
provenance:
  capturedBy: claude
---

# Checks stage visibility

Feature to display comprehensive visibility of the "checks" (validation) stage of the no-mistakes
CI/CD pipeline in the Wheelhouse UI. The feature shows validation steps, pipeline progress,
and stage changes on both cards and task detail pages.

## Components Implemented

- **ChecksStrip**: Slim step strip showing validation status with duration on cards
- **ChecksTimeline**: Timeline view of stage changes on task pages
- **Enhanced Evidence Collection**: Updated evidence reader to track validation steps
- **NMStatus Model**: Pipeline status model updated to expose checks stage information
- **Rail and TaskCard Components**: Updated to display checks information

## User Intent Requirements

- Show checks strip on home page's rail cards with status and duration
- Display each validation step on Harbour fleet board cards
- Show validation steps on individual task pages  
- Display timeline of what each stage found or changed
- Show CI results once PR is uploaded
- Track review questions answered and fix application rounds
