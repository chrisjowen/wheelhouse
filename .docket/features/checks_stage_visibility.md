---
name: checks_stage_visibility
description: Feature to display checks/validation stage visibility in Wheelhouse, showing validation steps and progress on cards and task pages
metadata:
  type: feature
  status: in_progress
  createdAt: "2026-10-25"
---

# Checks Stage Visibility Feature

This feature adds comprehensive visibility of the "checks stage" of the no-mistakes pipeline in the Wheelhouse UI.

## Requirements Met

From user intent stated in session:
- Show checks strip on home page's rail cards with status and duration
- Display each validation step on Harbour cards 
- Show validation steps on task page
- Display timeline of what each stage found or changed
- Show CI results once PR is up
- Display review questions and fix application status
- Support tracking of fix rounds

## Implementation Components

### Frontend
- ChecksStrip component: Slim step strip showing validation status with duration
- ChecksTimeline component: Timeline view of stage changes
- Updated Rail and TaskCard components

### Backend
- Enhanced nmstatus model for pipeline status
- Evidence collection for validation steps
- Updated model and collector services

## Branch & Changes

- **Branch**: fm/wh-checks-visibility
- **Commits**: cab7210..8a91116
- **Files Changed**: 17
- **Insertions**: 1553
- **Deletions**: 55

## Evidence

- **Session**: 0d480bfa-88e0-49f6-a67d-2be65d30fe4a
- **Observed At**: 2026-10-25
- **Source**: conversation
- **Note**: Feature under review in no-mistakes gate-step phase. Intent explicitly requires tracking of validation steps and CI status visibility.
