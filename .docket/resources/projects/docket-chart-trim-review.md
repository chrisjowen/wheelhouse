---
id: project.docket-chart-trim-review
type: project
title: Docket Chart Trim Code Review and Verification
description: Code review and verification of fm/wh-docket-trim branch trimming docket plugin to chart-only full-width layout

tags:
  - docket
  - wheelhouse
  - review
  - verification

attributes:
  kind: project
  status: done
---

# Docket Chart Trim Review Session

Review phase of no-mistakes run targeting the `fm/wh-docket-trim` branch (cab7210 → ffad8ae).

## Intent

User intent drove trimming the Docket plugin's display:
- Remove "waters" panel from task page (display-only, not valuable during build)
- Remove "Hazards ahead" Harbour card (display-only, not valuable during build)
- Keep the Chart and make it reachable from each project's page
- Redesign as full-width layout with details on the right (similar to Firstmate chat)

## Review Context

- Base commit: cab7210714c2c88ecdbb87d7d5440f9b901b0bff
- Target commit: ffad8ae75a5d36edbb828ccdee04a088a8934a9d
- Branch: fm/wh-docket-trim
- Related PR: #14 "feat(docket): trim the plugin to the Chart and give it its own full-width page"

## Earlier Review Findings

Review rounds 1-2 and test round 1 identified:

1. **Legacy /harbour tab redirect**: Redirect for old `/harbour?project=<id>&tab=<plugin>/<contribution>` URLs was flagged as unnecessary scope creep (not required by intent). User declined to fix in round 2.

2. **Docket file changes**: Background docket hook from different session modified .docket/ files during testing (modified MEMORY.md, created docket-chart-ui-trim.md). User declined to decide in test round 1.

## Evidence

- Source: conversation
- Session: ede92b0a-f8c4-4663-a702-2fd49b01ad40
- Observed: 2026-10-25

## Verification Phase

Session fae33653-b5d4-4629-b892-6ddd48c8a059 (2026-10-25) verified UI implementation:

### Chart and Details Panel
- Confirmed full-width layout with details panel on the right works as designed
- Verified details panel resizing with keyboard input (dashes/resize handle)
- Confirmed details panel width is persisted across sessions
- Verified landmark selection in inspector shows exhibit data correctly

### Task Page
- Confirmed "Waters" section removed from task pages as intended
- No regressions observed in task view

### Home Page Refactoring
- Verified ResizableRail component functionality for home page rail
- Confirmed ResizableRail properly resizes and persists width
- Home page regression checks passed

### Testing
- Unit tests for changed modules (Chart, ResizableRail, docket plugin) passed
- Smoke tests passed
- Created test fixtures with docket and verified plugin integration
