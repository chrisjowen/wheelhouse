---
id: decision.wheelhouse-firstmate-session-always-starts
type: decision
title: Wheelhouse open always starts the Firstmate session

tags:
  - wheelhouse
  - firstmate
  - cli

attributes: {}

links:
  - rel: documented_in
    target: document.mvp-spec
    evidence:
      - source: conversation
        session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
        observedAt: 2026-10-25
        observedBy: claude
        note: Decision approved during Firstmate chat prototype review and documented in MVP spec

  - rel: uses
    target: service.wheelhouse
    evidence:
      - source: conversation
        session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
        observedAt: 2026-10-25
        observedBy: claude
        note: Decision governs how wheelhouse CLI open command behaves

evidence:
  - source: conversation
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    observedAt: 2026-10-25
    observedBy: claude
    note: Approved during code review of commit a62e3a6; user instruction confirmed the direction. Fixed in cli/index.ts (removed --no-start flag), src/lib/server/runtime.ts (unconditional startFirstmate call), and README.md (updated documentation)

  - source: code
    path: cli/index.ts
    lines: 208-214
    symbol: program().option() --no-start removal
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: --no-start flag removed; wheelhouse open now always starts the session

  - source: code
    path: src/lib/server/runtime.ts
    lines: 144
    symbol: startFirstmate() call
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: startFirstmate() called unconditionally; WHEELHOUSE_FIRSTMATE_START env var no longer checked

  - source: code
    path: README.md
    lines: 71-74
    symbol: One session only documentation
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Documentation updated to reflect that wheelhouse open always starts (or shows) the Firstmate session

provenance:
  capturedBy: claude
---

# Wheelhouse open always starts the Firstmate session

## Decision

`wheelhouse open` always starts (or, if one is already running, attaches to) the single Firstmate session, running as an ordinary interactive `claude --dangerously-skip-permissions` inside a tmux session that Wheelhouse owns. The `--no-start` flag and `WHEELHOUSE_FIRSTMATE_START` environment variable are removed as unnecessary complexity.

## Why this matters

The agreed direction for the Firstmate chat prototype is that there is only ever one Firstmate session visible in Wheelhouse, accessed through the chat pane. Multiplying sessions confuses the user and violates the design principle of a single pane of glass.

When `wheelhouse open` is invoked:
- If Firstmate's session lock shows another session is running (e.g., Firstmate in a terminal), Wheelhouse displays that session read-only and sends messages via inbox
- If no session is running, Wheelhouse starts one automatically
- The Start button on the home page becomes a fallback to retry starting if the initial attempt fails

The removal of `--no-start` simplifies the CLI and aligns with the product direction that starting Firstmate is the default, not optional.

## Implementation

Fixed in:
- `cli/index.ts`: Removed `--no-start` option from the program definition and removed the `start: boolean` field from `OpenOptions`
- `src/lib/server/runtime.ts`: Changed `if (env.WHEELHOUSE_FIRSTMATE_START === '1')` to unconditional `void startFirstmate(firstmate)`
- `README.md`: Updated documentation to reflect the new behavior (removed reference to `--no-start`, clarified that "Start Firstmate here" is a fallback)
