---
id: constraint.loopback-only-with-origin-token
type: constraint
title: Loopback only; mutations need same Origin and session token
tags:
- security
links:
- rel: governs
  target: api.wheelhouse-http
  evidence:
  - source: code
    path: src/hooks.server.ts
    lines: 10-27
    symbol: handle
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/hooks.server.ts#L10-L27
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: governs
  target: service.wheelhouse
  evidence:
  - source: code
    path: cli/index.ts
    lines: '22'
    symbol: HOST
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/cli/index.ts#L22
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: docs
  path: README.md
  lines: '52'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L52
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: 127.0.0.1 only; foreign Host gets 421; mutations without matching Origin and session token get
    403.
- source: code
  path: src/lib/server/session.ts
  lines: 3-12
  symbol: refuseMutation
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/session.ts#L3-L12
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: docs
  path: docs/spec.md
  lines: '87'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/docs/spec.md#L87
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# Loopback only; mutations need same Origin and session token

Wheelhouse listens on `127.0.0.1` only and answers only `Host` values
`127.0.0.1`, `localhost` or `[::1]` (anything else gets 421, blocking DNS
rebinding). Every mutating request must carry an `Origin` equal to the served
`http://<host>` and echo the per-launch session token (header
`x-wheelhouse-session`), which is random per process and never written to disk;
otherwise 403.
