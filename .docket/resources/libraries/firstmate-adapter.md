---
id: library.firstmate-adapter
type: library
title: Firstmate script adapter
tags:
- wheelhouse
- internal-module
attributes:
  language: typescript
links:
- rel: uses
  target: api.firstmate-scripts
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
- rel: depends_on
  target: datasource.firstmate-home
  evidence:
  - source: code
    path: src/lib/server/firstmate/evidence.ts
    lines: 9-21
    symbol: EvidenceReader
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/evidence.ts#L9-L21
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Reads contributions.json, report.md and screenshots under data/<id>/.
  - source: code
    path: src/lib/server/firstmate/ledger.ts
    lines: 4-5
    symbol: LedgerReader
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/ledger.ts#L4-L5
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: code
  path: src/lib/server/firstmate/adapter.ts
  lines: 17-24
  symbol: createScriptAdapter
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/adapter.ts#L17-L24
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: One TypeScript interface over the supported scripts.
- source: code
  path: src/lib/server/firstmate/contracts.ts
  lines: 1-14
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/contracts.ts#L1-L14
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Typed contracts and strict schema-id parsers.
provenance:
  capturedBy: claude
---

# Firstmate script adapter

Everything under `src/lib/server/firstmate/`: `install.ts` resolves the
Firstmate checkout and home and checks each script's contract markers;
`exec.ts` (`runBounded`) runs commands as argument arrays with timeouts and
output caps; `adapter.ts` wraps `fm-fleet-snapshot.sh`, `fm-inbox.sh`
(ready/note/receipts) and `fm-peek.sh`; `contracts.ts` parses their versioned
JSON; `ledger.ts` tails the fleet ledger; `evidence.ts` assembles per-task
evidence (diffs, PR state, report, screenshots, CI readiness); `stages.ts` and
`model.ts` derive the passage stages shown in the UI.

Modelled as a `library` because the default ontology has no internal-module
type; it is not published separately.
