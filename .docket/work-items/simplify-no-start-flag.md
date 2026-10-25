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
  status: open

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

---

# Remove unused --no-start CLI flag

The `--no-start` option and associated `WHEELHOUSE_FIRSTMATE_START` environment variable plumbing represent a mode that no intent requirement actually asks for. The code paths are unused and the flag adds unnecessary complexity to the CLI.

## Scope

- Remove the `--no-start` flag from CLI option parser (cli/index.ts:214)
- Remove the `WHEELHOUSE_FIRSTMATE_START` environment variable handling
- Remove any conditional code paths that depend on this flag

## Severity

**simplification** - Dead code removal; no functional change expected.
