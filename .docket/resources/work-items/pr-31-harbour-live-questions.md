---
id: work-item.pr-31-harbour-live-questions
type: work_item
title: "feat(harbour): show the review's questions for Firstmate on the card and in the conversation"
attributes:
  kind: story
  status: in_progress
  key: PR #31
  url: https://github.com/chrisjowen/wheelhouse/pull/31
links:
- rel: implements
  target: feature.harbour-live-questions
  evidence:
  - source: docs
    url: https://github.com/chrisjowen/wheelhouse/pull/31
    observedAt: '2026-10-26'
    observedBy: claude
    session: a16b86df-e2e6-4663-b5ef-b57a7cc06b67
evidence:
- source: conversation
  observedAt: '2026-10-26'
  observedBy: claude
  session: a16b86df-e2e6-4663-b5ef-b57a7cc06b67
  note: >-
    PR branch fm/wh-live-questions being processed in no-mistakes CI phase. User intent:
    show Firstmate's review questions on Harbour card and in conversation for live
    visibility of question rounds and resolutions. Currently "3 questions for Firstmate"
    is shown on card but questions and answers are not visible from Harbour UI. Approved
    fixes for three code review findings (F1, F2, F3) related to decision round pairing
    and documentation sync.
- source: docs
  path: src/lib/server/insights/decisions.ts
  observedAt: '2026-10-26'
  observedBy: claude
  session: a16b86df-e2e6-4663-b5ef-b57a7cc06b67
  note: >-
    Changes decision round pairing logic (pairRounds) to handle non-answer resolved
    lines consistently with conversation.ts, ensuring later needs-decision on same
    key opens new round instead of being skipped. Tightens callsFor regex to avoid
    matching finding IDs within ordinary English words.
- source: docs
  path: docs/guide.md
  observedAt: '2026-10-26'
  observedBy: claude
  session: a16b86df-e2e6-4663-b5ef-b57a7cc06b67
  note: >-
    Updates Decided-for-you section filter list to include "No change" verdict,
    aligning documentation with code.
provenance:
  capturedBy: claude
---

# PR #31: Harbour Live Questions

GitHub pull request adding Firstmate review questions visibility to the Harbour card
and Conversation tab.

**User Intent**: Enable watching live questions and their resolutions from the Harbour
card view, showing exactly how Firstmate decides on each question raised during builds.

**Status**: In progress, resolving merge conflicts with main branch (f8ea95f).
**Branch**: fm/wh-live-questions
**Related**: PR #28 (Conversation tab with back-and-forth history)
