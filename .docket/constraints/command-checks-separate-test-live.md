---
id: constraint.command-checks-separate-test-live
type: constraint
title: Command checks use separate test and live checkouts
tags:
- command-checks
- passages
- testing
- isolation

links:
- rel: governs
  target: feature.passage-command-checks
  evidence:
  - source: conversation
    session: 67b3fd14-06ad-45cd-95d3-e4318ec9b1f8
    observedAt: '2026-10-26'
    observedBy: claude
    note: Code review confirmed test/live checkout separation implementation

evidence:
- source: code
  path: src/lib/server/passages/checks.ts
  symbol: CheckContext
  range: [59, 59]
  session: 67b3fd14-06ad-45cd-95d3-e4318ec9b1f8
  observedAt: '2026-10-26'
  observedBy: claude
  note: CheckContext interface includes purpose?: 'test' | 'live' field
- source: code
  path: src/lib/server/passages/checks.ts
  symbol: commandCheck
  range: [647, 647]
  session: 67b3fd14-06ad-45cd-95d3-e4318ec9b1f8
  observedAt: '2026-10-26'
  observedBy: claude
  note: Checkout path construction includes purpose in name, defaults to 'live'
- source: code
  path: src/lib/server/passages/checks.ts
  symbol: commandCheck
  range: [649, 650]
  session: 67b3fd14-06ad-45cd-95d3-e4318ec9b1f8
  observedAt: '2026-10-26'
  observedBy: claude
  note: checkoutsInUse set prevents concurrent runs of same check on same checkout

provenance:
  capturedBy: claude
---

# Command checks use separate test and live checkouts

Passage test runs and live task checks use separate, isolated worktrees to
ensure that testing command checks does not affect the active checkout used
for live tasks, and vice versa.

## Rationale

When a passage editor runs a test (`purpose: 'test'`), it should not interfere
with ongoing task checks (`purpose: 'live'`). Separate worktrees ensure
concurrent operations remain isolated and prevent a test from blocking a live
check or leaving stale state.

## Implementation

- CheckContext includes `purpose?: 'test' | 'live'` parameter.
- Checkout path construction includes purpose in the path name:
  `wheelhouse-{purpose}-{projectId}-{taskId}-{checkId}-{sha}`,
  defaulting to `'live'` when not specified.
- The `checkoutsInUse` Set tracks active checkouts globally within the process.
- If a checkout is already in use (same combination of purpose, project, task,
  check, and commit), the check is refused with: `'the same check is already
  running on this commit; it was not started again'`.
- This prevents double-booking of worktrees while allowing independent
  test and live runs to proceed in parallel.

## Testing

- Passage test and live task checks use different checkout directories.
- A second invocation of the same check on the same commit is refused.
- Cleanup (worktree removal) occurs correctly even when concurrent with
  other checks.
