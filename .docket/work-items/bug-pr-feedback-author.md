---
id: work_item.bug-pr-feedback-author
type: work_item
title: PR feedback counted from any author, not just captain

tags:
  - firstmate
  - pr-feedback
  - bug

attributes:
  kind: bug
  status: open

links:
  - rel: uses
    target: library.firstmate-adapter
    evidence:
      - source: code
        path: src/lib/server/firstmate/model.ts
        lines: 153
        symbol: feedback count
        observedAt: 2026-10-25
        observedBy: claude
        session: 14348614-0ff6-4f03-8831-897b7d50fb81
        note: Feedback counted from every author, not filtered to captain

evidence:
  - source: code
    path: src/lib/server/firstmate/model.ts
    lines: 153
    symbol: feedback
    observedAt: 2026-10-25
    observedBy: claude
    session: 14348614-0ff6-4f03-8831-897b7d50fb81
    note: Found during code review of commit d65ea71

  - source: code
    path: src/lib/server/firstmate/evidence.ts
    lines: 832
    symbol: parsePrFeedback
    observedAt: 2026-10-25
    observedBy: claude
    session: 14348614-0ff6-4f03-8831-897b7d50fb81
    note: Every reply to a review thread is its own COMMENTED review and pull comment on GitHub

---

# PR feedback author filter

Feedback is currently counted no matter who wrote it. Every reply to a review thread is its own COMMENTED review and pull comment on GitHub. This means replies from workers (self-corrections, clarifications) are treated as captain feedback, which breaks the signal that the captain is waiting on the worker.

## Root cause

Feedback collection and counting does not filter by author. All COMMENTED reviews and pull comments are counted equally, regardless of who wrote them.

## Fix

Filter feedback to only count reviews/comments from the captain (PR author or designated reviewer), not from all participants.

## Severity

**warning** - Feedback loop distorted; workers' own comments are counted as captain requests.
