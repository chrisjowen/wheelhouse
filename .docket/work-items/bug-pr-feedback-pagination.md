---
id: work_item.bug-pr-feedback-pagination
type: work_item
title: PR reviews and comments fetched without pagination

tags:
  - firstmate
  - pr-feedback
  - github-api
  - bug

attributes:
  kind: bug
  status: fixed

links:
  - rel: uses
    target: system.github
    evidence:
      - source: code
        path: src/lib/server/firstmate/evidence.ts
        lines: 832
        symbol: per_page=100
        observedAt: 2026-10-25
        observedBy: claude
        session: 14348614-0ff6-4f03-8831-897b7d50fb81
        note: GitHub API called with per_page=100 and no pagination loop

evidence:
  - source: code
    path: src/lib/server/firstmate/evidence.ts
    lines: 832
    symbol: per_page=100
    observedAt: 2026-10-25
    observedBy: claude
    session: 14348614-0ff6-4f03-8831-897b7d50fb81
    note: Found during code review of commit d65ea71

  - source: code
    path: src/lib/server/firstmate/evidence.ts
    lines: 842-843
    symbol: get() calls with --paginate --slurp
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Fix applied - gh api calls now use --paginate --slurp flags to fetch all pages and combine results

---

# PR reviews and comments pagination

Reviews and comments are fetched from the GitHub API with `per_page=100` and no pagination loop. GitHub returns them oldest first, so on a PR with more than 100 review comments or reviews, the most recent feedback is silently dropped, breaking the captain/worker feedback loop.

## Root cause

The GitHub API fetch call sets `per_page=100` but does not iterate through pagination links when the result set is larger.

## Fix

Implement pagination loop to fetch all reviews and comments, not just the first 100. May need to handle oldest-first ordering and/or a cutoff for very old PRs.

## Severity

**warning** - Recent feedback lost on PRs with >100 comments; breaks intent detection on mature discussions.
