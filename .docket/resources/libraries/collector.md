---
id: library.collector
type: library
title: Fleet collector (polling and SSE)
tags:
- wheelhouse
- internal-module
attributes:
  language: typescript
links:
- rel: depends_on
  target: library.firstmate-adapter
  evidence:
  - source: code
    path: src/lib/server/collector/collector.ts
    lines: 1-5
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/collector/collector.ts#L1-L5
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: depends_on
  target: library.message-store
  evidence:
  - source: code
    path: src/lib/server/collector/collector.ts
    lines: '13'
    symbol: Messenger
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/collector/collector.ts#L13
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Each round reconciles messages through the Messenger.
evidence:
- source: code
  path: src/lib/server/collector/collector.ts
  lines: 16-29
  symbol: Collector
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/collector/collector.ts#L16-L29
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: One shared collector polling readiness/ledger ~5s and the snapshot adaptively, pushing to SSE.
provenance:
  capturedBy: claude
---

# Fleet collector (polling and SSE)

The single shared collector (`src/lib/server/collector/collector.ts`). Every
~5 s it reads Firstmate readiness and new fleet-ledger lines; the full fleet
snapshot runs on an adaptive cadence between 5 and 30 s. Results are cached in
memory and pushed to the browser over server-sent events (`/api/events`). A
failed read keeps the last good view but marks it stale. Each round also
reconciles messages sent to Firstmate.

Modelled as a `library` (internal module); see [[library.firstmate-adapter]].
