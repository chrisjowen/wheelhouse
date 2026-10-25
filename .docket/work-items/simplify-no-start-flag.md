---
id: work_item.simplify-no-start-flag
type: work_item
title: Remove unused --no-start CLI flag

tags:
  - firstmate
  - cli
  - simplification

attributes:
  kind: chore
  status: done

links:
  - rel: part_of
    target: project.wh-firstmate-live-session
    evidence:
      - source: code
        path: cli/index.ts
        lines: 214
        symbol: WHEELHOUSE_FIRSTMATE_START
        observedAt: 2026-10-25
        observedBy: claude
        session: 14348614-0ff6-4f03-8831-897b7d50fb81
        note: Simplification identified during code review of commit d65ea71

evidence:
  - source: code
    path: cli/index.ts
    lines: 214
    symbol: "--no-start"
    observedAt: 2026-10-25
    observedBy: claude
    session: 14348614-0ff6-4f03-8831-897b7d50fb81
    note: Found during code review of commit d65ea71

  - source: code
    path: cli/index.ts
    lines: 207-220
    symbol: Removed --no-start option
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Fix applied - --no-start option removed from program definition

  - source: code
    path: cli/index.ts
    lines: 73-75
    symbol: Removed start field from OpenOptions
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Removed start: boolean field from OpenOptions interface

  - source: code
    path: cli/index.ts
    lines: 135
    symbol: Removed WHEELHOUSE_FIRSTMATE_START env var handling
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Removed line setting WHEELHOUSE_FIRSTMATE_START environment variable

  - source: code
    path: src/lib/server/runtime.ts
    lines: 144
    symbol: Unconditional startFirstmate call
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Changed from conditional check to unconditional startFirstmate() call

---

# Remove unused --no-start CLI flag

The `--no-start` option and associated `WHEELHOUSE_FIRSTMATE_START` environment variable plumbing represent a mode that no intent requirement actually asks for. The code paths are unused and the flag adds unnecessary complexity to the CLI.

## Scope

- Remove the `--no-start` flag from CLI option parser (cli/index.ts:214)
- Remove the `WHEELHOUSE_FIRSTMATE_START` environment variable handling
- Remove any conditional code paths that depend on this flag

## Severity

**simplification** - Dead code removal; no functional change expected.
