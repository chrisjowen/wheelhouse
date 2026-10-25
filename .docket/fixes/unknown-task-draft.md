---
id: fix.unknown-task-draft
type: decision
title: Draft handling for decisions on no-longer-listed tasks

tags:
  - wheelhouse
  - decisions
  - ui-flow

links:
  - rel: resolves
    target: finding.draft-dropped-unknown-task

evidence:
  - source: code
    path: src/routes/+page.svelte
    lines: 45-70
    symbol: page effect and draft handling
    commit: afc2e64
    observedAt: 2026-10-25
    observedBy: claude
    session: b11946b7-7f86-4760-b3bb-f2ac44261e96
    note: >
      When a decision task is no longer in the fleet, the page now passes the
      draft to the composer without a chip (showing plain-text task title or
      description instead). Chat and draft URL parameters are cleared once the
      fleet has loaded, allowing the disagree/chat buttons to work for old
      decisions on removed tasks.

  - source: code
    path: src/routes/+page.svelte
    lines: 55-60
    commit: afc2e64
    observedAt: 2026-10-25
    observedBy: claude
    session: b11946b7-7f86-4760-b3bb-f2ac44261e96
    note: Page no longer returns early when (id && !t). Instead, it passes the draft even when the task is not found, with graceful fallback to plain text.

  - source: runtime
    observedAt: 2026-10-25
    observedBy: claude
    session: ac2a66e2-d79c-4230-8280-0e81660d875b
    note: "Live test: clicked 'I'd decide differently' on retired task 'Retired cache layer' (not in fleet). Composer received draft text with no chip; URL (http://127.0.0.1:59564/) shows no chat or draft params. Verified link for live task includes chip plus draft. Both scenarios work correctly."

provenance:
  capturedBy: claude
---

# Draft handling for decisions on no-longer-listed tasks

When a user clicks "I'd decide differently" or "Chat about this" on a decision made for a task that is no longer listed by Firstmate (e.g., an old decision from a prior run), the decision page links to `/?chat=<taskId>&draft=…`. If the task has been removed from the fleet, the page would return early without passing the draft to the composer, silently failing the user's action.

The fix ensures that even when a task is not found in the fleet, the draft is still passed to the composer. The task identification gracefully falls back to plain text (the task title or ID) instead of a clickable chip, and the URL parameters are cleared once the fleet has loaded.

This preserves the user's ability to revisit and discuss old decisions, even after tasks have left the visible fleet.
