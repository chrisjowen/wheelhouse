---
id: library.message-store
type: library
title: Message store and messenger
tags:
- wheelhouse
- internal-module
attributes:
  language: typescript
links:
- rel: depends_on
  target: datasource.wheelhouse-message-store
  evidence:
  - source: code
    path: src/lib/server/store/store.ts
    lines: 47-51
    symbol: defaultStateDir
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/store/store.ts#L47-L51
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: depends_on
  target: library.firstmate-adapter
  evidence:
  - source: code
    path: src/lib/server/store/messenger.ts
    lines: '1'
    symbol: FirstmateAdapter
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/store/messenger.ts#L1
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: code
  path: src/lib/server/store/store.ts
  lines: 7-18
  symbol: MessageStore
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/store/store.ts#L7-L18
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Atomic-rename JSON record of sent messages, one file per Firstmate home.
- source: code
  path: src/lib/server/store/messenger.ts
  lines: 6-20
  symbol: Messenger
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/store/messenger.ts#L6-L20
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Request-id idempotent sends, separate delivery and acknowledgement.
provenance:
  capturedBy: claude
---

# Message store and messenger

`src/lib/server/store/`: `store.ts` persists Wheelhouse's own record of
messages it sent (request id, body, delivery outcome, receipts, cursor) under
the Wheelhouse state directory, never inside the Firstmate home, writing via a
temp file renamed over the old one. `messenger.ts` sends through `fm-inbox.sh
note` with a stable request id and re-issues uncertain or unannounced sends on
a 15 s-to-5 min backoff.

Modelled as a `library` (internal module).
