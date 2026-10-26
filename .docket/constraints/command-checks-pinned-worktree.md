---
id: constraint.command-checks-pinned-worktree
type: constraint
title: Command checks run in temporary worktrees at pinned commits
tags:
- command-checks
- passages
- security
- isolation

links:
- rel: governs
  target: service.wheelhouse-passages
  evidence:
  - source: conversation
    session: bbfea3ac-fdcf-492b-ac26-33e91a99f67b
    observedAt: '2026-10-26'
    observedBy: claude
    note: Review phase decision to run command checks in pinned worktrees

evidence:
- source: conversation
  session: bbfea3ac-fdcf-492b-ac26-33e91a99f67b
  observedAt: '2026-10-26'
  observedBy: claude
  note: |
    Code review finding review-1 from fm/wh-passage-editor branch (commits
    b24e464→923c61f). Command checks must not run in the clone's working tree
    (which may have stale or unrelated code), but in a temporary git worktree
    checked out at the pinned commit.
    
    For ref: merge.commit, use the task's merge commit.
    For ref: pr.head, use the pull request head.
    Otherwise, use the default-branch tip (clone's defaultRef, e.g. origin/main).
    
    Worktree path must be deterministic per run (e.g., named from task id,
    check id, and commit). The worktree must be removed afterwards with
    `git worktree remove --force <path>`, including when the command fails
    or times out. Never use rm with globs or variables for cleanup.
- source: conversation
  session: 67b3fd14-06ad-45cd-95d3-e4318ec9b1f8
  observedAt: '2026-10-26'
  observedBy: claude
  note: |
    Code review of commits bd45744→943cc81 confirmed implementation follows
    constraint: worktree creation at line 654-657, removal at 653 and 704
    (forced removal in both cases), path deterministic from context fields,
    finally block ensures cleanup even on failure. Test and live runs use
    separate checkouts via purpose parameter (constraint.command-checks-separate-test-live).

provenance:
  capturedBy: claude
---

# Command checks run in temporary worktrees at pinned commits

Command checks for passage stages must execute in isolated, temporary git
worktrees checked out at a specific, deterministic commit, never in the
Firstmate project clone's working tree.

## Rationale

The Firstmate project clone's working tree may contain stale, unrelated, or
uncommitted code. If command checks run there, a task's 'Deployed' or other
passages can pass after deploying code that is not the task's merge commit,
and scripts that change through merged PRs can run under earlier consent.

## Implementation

- Create a temporary worktree from the project clone, checked out (detached)
  at the pinned commit: the task's merge commit for `ref: merge.commit`,
  the pull request head for `ref: pr.head`, or the default-branch tip
  (`clone.defaultRef`, e.g. `origin/main`) otherwise.

- Resolve the working directory inside that worktree with the same path
  boundary enforcement (paths that escape the worktree are rejected).

- Pass `WHEELHOUSE_COMMIT` as the commit actually checked out, and verify
  it matches.

- Worktree path must be deterministic per run (e.g., under Wheelhouse's
  state directory or the OS temp directory, named from task id, check id,
  and commit).

- Remove the worktree afterwards with `git worktree remove --force <exact path>`
  (no `rm` with globs or variables), including when the command fails, times out,
  or the commit cannot be checked out.

- Test dry-runs (`service.dryRun`) must use the same pinned checkout.

- If the commit cannot be checked out, the check reports that outcome with
  an explanation.

## Testing

- Command runs in a worktree at the pinned commit, not in the clone's
  working tree (which has different content).
- The worktree is removed afterwards, including after a failure.
- `WHEELHOUSE_COMMIT` matches the commit checked out.
