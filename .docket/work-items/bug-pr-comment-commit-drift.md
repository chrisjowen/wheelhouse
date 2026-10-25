---
id: work_item.bug-pr-comment-commit-drift
type: work_item
title: PR comment commit drift causes indefinite "Addressing review" status

tags:
  - firstmate
  - pr-feedback
  - bug

attributes:
  kind: bug
  status: fixed

links:
  - rel: uses
    target: library.firstmate-adapter
    evidence:
      - source: code
        path: src/lib/server/firstmate/evidence.ts
        lines: 807
        symbol: parsePrFeedback
        observedAt: 2026-10-25
        observedBy: claude
        session: 14348614-0ff6-4f03-8831-897b7d50fb81
        note: parsePrFeedback reads review comment's commit_id, causing drift when GitHub updates the field

evidence:
  - source: code
    path: src/lib/server/firstmate/evidence.ts
    lines: 807
    symbol: parsePrFeedback
    observedAt: 2026-10-25
    observedBy: claude
    session: 14348614-0ff6-4f03-8831-897b7d50fb81
    note: Found during code review of commit d65ea71

  - source: code
    path: src/lib/server/firstmate/model.ts
    lines: 160
    symbol: last.commitId === f.head.sha
    observedAt: 2026-10-25
    observedBy: claude
    session: 14348614-0ff6-4f03-8831-897b7d50fb81
    note: Status check that is broken due to GitHub's commit_id field movement

  - source: code
    path: src/lib/server/firstmate/evidence.ts
    lines: 806
    symbol: str(c.original_commit_id) ?? str(c.commit_id)
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Fix applied - comment commitId now reads original_commit_id (with fallback to commit_id) to avoid drift when GitHub moves commit_id forward

  - source: code
    path: src/lib/server/firstmate/evidence.test.ts
    lines: 401-411
    symbol: Test for commit drift handling
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Test added - dates a comment by the commit it was left on (original_commit_id), not the one GitHub moved it to

---

# PR comment commit drift

When captain comments on a PR line at head A, and the worker fixes something elsewhere and pushes B (reporting ready), GitHub updates that comment's `commit_id` field to B even though the commented line was unchanged. This causes the check `last.commitId === f.head.sha` to incorrectly show "Addressing your review" indefinitely, instead of returning to "Waiting on captain" after a newer ready report for a newer head.

## Root cause

`parsePrFeedback` in evidence.ts reads the comment's `commit_id` field, which GitHub moves forward to the current head on unrelated pushes. Review comments use `commit_id` correctly (the reviewed commit), but regular PR comments do not.

## Fix

Read `original_commit_id` (falling back to `commit_id`) for comments, and add a test case where the comment's original commit differs from its current commit.

## Severity

**warning** - Status feedback handling broken until fixed.
