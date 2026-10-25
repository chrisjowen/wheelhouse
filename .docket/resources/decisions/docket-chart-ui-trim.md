---
id: decision.docket-chart-ui-trim
type: decision
title: Trim Docket Chart UI - remove display-only panels

tags:
  - docket
  - chart
  - ui
  - performance
  - simplification

links:
  - rel: uses
    target: feature.wheelhouse-docket-chart
    evidence:
      - source: conversation
        session: 50df6487-6120-4d45-8d72-f5399a66fd11
        observedAt: 2026-10-25
        observedBy: claude
        note: Decision to trim Waters section and Hazards card from Chart feature

evidence:
  - source: conversation
    session: 50df6487-6120-4d45-8d72-f5399a66fd11
    observedAt: 2026-10-25
    observedBy: claude
    note: >-
      No-mistakes review of fm/wh-docket-trim branch. User and Firstmate evaluated
      whether Waters panel (task page) and Hazards card (Harbour) provide value during
      build. Concluded both are display-only, add no build-time value, and consume UI
      real estate. Approved removal. Chart to be enhanced to full-width with details
      pane on right, similar to Firstmate chat layout. Branch 05aa69c1.

  - source: conversation
    session: 0f320365-b59e-4b94-89dc-471c1a1d4043
    observedAt: 2026-10-25
    observedBy: claude
    note: >-
      Test phase (no-mistakes gate-step) verified decision implementation on commit 05aa69c.
      Tested Wheelhouse server with local Firstmate environment using browser. Confirmed:
      Chart displays full-width with details inspector on right; Hazards section properly
      removed; legacy /harbour?tab= redirect removed; plugin correctly contributes only Chart tab.
      Unit and smoke tests all pass. Firstmate rail resize functionality intact.

provenance:
  capturedBy: claude
---

# Trim Docket Chart UI

## Decision

Remove the "Waters this passage crosses" panel from task pages and the "Hazards ahead" 
card from Harbour. Both features are display-only and do not inform the build process.

Enhance the Chart itself to display full-width with the detail inspector positioned
on the right side, similar to the Firstmate chat layout, making better use of screen 
real estate and improving readability.

## Rationale

- **Waters section**: Appears on task pages after the Building step; purely informational, 
  shows which system components a task touches but does not drive build decisions
- **Hazards card**: Appears on Harbour only when in-flight tasks touch constrained exhibits; 
  alerts teams but does not provide actionable guidance during the build
- **Value assessment**: Both panels add visual complexity without providing build-time value
- **Performance**: Removing them simplifies the Harbour and task page interfaces

## Removed 2026-10-25

- Waters section from task pages (display-only informational)
- Hazards card from Harbour (display-only alerting)

## Changes

- Chart enhanced to full-width layout with inspector details pane on right
- Chart made more prominent and easier to read
- Legacy `/harbour?tab=...` tab redirect removed
