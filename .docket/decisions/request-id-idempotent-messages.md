---
id: decision.request-id-idempotent-messages
type: decision
title: Messages carry a stable request id for idempotent delivery
tags:
- messaging
links:
- rel: uses
  target: library.message-store
  evidence:
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
evidence:
- source: docs
  path: README.md
  lines: 104-109
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L104-L109
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: docs
  path: docs/spec.md
  lines: '37'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/docs/spec.md#L37
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Use stable request IDs to prevent duplicate submissions.
provenance:
  capturedBy: claude
---

# Messages carry a stable request id for idempotent delivery

Every message gets a request id in the browser, sent as `Idempotency-Key` and
recorded by Wheelhouse before it runs `fm-inbox.sh note --request-id <id>`.
Retries, double clicks and reconciliation reuse it; Firstmate returns the
original note for a repeated id, so no duplicate is ever created. Delivery and
acknowledgement are tracked as separate states.
