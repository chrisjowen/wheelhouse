---
id: fix.captain-waits-partitioned
type: decision
title: Captain waits partitioned by validation phase

tags:
  - wheelhouse
  - insights
  - timing

links:
  - rel: resolves
    target: finding.captain-double-count
  - rel: resolves
    target: finding.overlapping-waits-summed

evidence:
  - source: code
    path: src/lib/server/insights/timing.ts
    lines: 73-180
    symbol: splitTime function
    commit: afc2e64
    observedAt: 2026-10-25
    observedBy: claude
    session: b11946b7-7f86-4760-b3bb-f2ac44261e96
    note: >
      Captain wait spans are now merged into their union before being measured, so
      concurrent questions count once. Waits are partitioned by phase: before
      validating reduce build, during [validating, reviewEnd) reduce review, and
      post-ok waits only count after checks pass. Spans are merged to prevent
      double-counting overlapping intervals across segments.
  
  - source: code
    path: src/lib/server/insights/timing.test.ts
    lines: 156-169
    symbol: "counts questions open at the same time once"
    commit: afc2e64
    observedAt: 2026-10-25
    observedBy: claude
    session: b11946b7-7f86-4760-b3bb-f2ac44261e96
    note: >
      Test verifies that two captain questions asked at 5 and 6 min, both
      answered at 15, validation at 20 results in build=10 min, captain=30 min,
      readyAfter=40 min (no overlap double-counting).

  - source: code
    path: src/lib/server/insights/timing.test.ts
    lines: 171-182
    symbol: "counts a review question and captain question together once"
    commit: afc2e64
    observedAt: 2026-10-25
    observedBy: claude
    session: b11946b7-7f86-4760-b3bb-f2ac44261e96
    note: >
      Test verifies that a Firstmate decision and a captain question open
      concurrently in review do not double-count from the review segment.

  - source: runtime
    observedAt: 2026-10-25
    observedBy: claude
    session: ac2a66e2-d79c-4230-8280-0e81660d875b
    note: "Live testing with fixture containing two overlapping captain questions (asked at 5 and 6 min, answered at 15, validation at 20): /api/insights confirmed time split adds up (9 min build = 20 - 11 min merged waits; 11 min captain wait; 2 min deciding; 25 min review; total 47 min matches elapsed). Task page time bar visualizes same split. Zero double-counting confirmed."

provenance:
  capturedBy: claude
---

# Captain waits partitioned by validation phase

The timing calculation for ship tasks now correctly handles captain (human) wait time across multiple scenarios:

1. **Overlapping spans**: When multiple questions are open concurrently (e.g., board-q1 asked at 5 min, board-q2 asked at 6 min, both answered at 15), their wait time is merged into a single union interval [5, 15]. This prevents the overlap from being double-counted.

2. **Phase-based partitioning**: Wait time is attributed to the appropriate phase:
   - Before validation starts: reduces build time
   - During validation [validating, reviewEnd): reduces review time  
   - After checks pass: stays in captain (not subtracted from other phases)

3. **Cross-series overlap**: When a Firstmate decision (a run-key wait) and a captain question are open at the same time during review, they are merged before subtraction so review time is not reduced twice.

The fix ensures every minute of elapsed time belongs to exactly one segment (build + review + deciding + CI + captain = total), and time spent waiting on the captain is never counted twice across segments.
