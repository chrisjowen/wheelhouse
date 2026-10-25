---
name: harbour-preview-implementation
description: Decision to implement preview iframe, screenshots and feedback in Harbour but defer sandbox/CLI preview requirement
metadata:
  type: decision
  status: in_progress
---

## Decision
Wheelhouse captain can now review worker prototypes directly in the Harbour view with:
1. Embedded iframe for preview URL
2. Screenshot thumbnails from worker's headless browser runs
3. Inline feedback box to send review comments to worker

## Rationale
This supports the captain's workflow of reviewing work without leaving the Harbour task list. The embedded preview (UI) and screenshots cover the primary request, while the sandbox (CLI) requirement from the earlier ask (2026-10-11) was deferred or absorbed differently.

## Gaps Identified in Review
- No handling of headless browser failures (missing reason display when screenshots unavailable)
- CLI sandbox preview requirement status unclear

## Related
- [[harbour-preview-view]] feature implementation
- User intent: fm/wh-preview-review branch, session 0669801c-833e-451b-979f-10346de9f101

---
source: conversation
observedBy: claude
observedAt: 2026-10-25
session: 0669801c-833e-451b-979f-10346de9f101
---
