---
id: api.firstmate-scripts
type: api
title: Firstmate integration scripts
tags:
- firstmate
- contract
attributes:
  protocol: other
  version: fm-fleet-snapshot.v1, fm-primary-ready.v1, fm-inbox-note.v1, fm-inbox-receipts.v1
links:
- rel: defined_in
  target: system.firstmate
  evidence:
  - source: code
    path: src/lib/server/firstmate/install.ts
    lines: 59-60
    symbol: scriptPath
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/install.ts#L59-L60
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Scripts live under <firstmate>/bin/.
evidence:
- source: code
  path: src/lib/server/firstmate/install.ts
  lines: 30-57
  symbol: SUPPORTED_SCRIPTS
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/install.ts#L30-L57
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Contract markers checked per script.
- source: code
  path: src/lib/server/firstmate/contracts.ts
  lines: 11-14
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/contracts.ts#L11-L14
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Schema ids Wheelhouse parses.
- source: docs
  path: README.md
  lines: 86-95
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L86-L95
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# Firstmate integration scripts

The command-line contract Wheelhouse consumes from a Firstmate checkout's
`bin/`: `fm-fleet-snapshot.sh --json` (fleet and task state),
`fm-inbox.sh ready` (supervisor readiness), `fm-inbox.sh note --request-id
<id> --json -` (send a message; the only write), `fm-inbox.sh receipts
[--after <cursor>]` (acks and replies) and `fm-peek.sh <task> <lines>` (worker
terminal output, at most 200 lines). Outputs are versioned JSON schemas;
Wheelhouse checks marker strings in each script at startup and reports
incompatibility in `/api/health` rather than refusing to start.

Owned by Firstmate, not this repository; known here only from Wheelhouse's
side of the contract.
