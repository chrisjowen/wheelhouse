---
id: api.wheelhouse-http
type: api
title: Wheelhouse HTTP API
tags:
- api
- sse
attributes:
  protocol: rest
links:
- rel: defined_in
  target: repository.wheelhouse
  evidence:
  - source: code
    path: src/routes/api/fleet/+server.ts
    lines: '5'
    symbol: GET
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/routes/api/fleet/+server.ts#L5
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: docs
  path: README.md
  lines: 115-128
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L115-L128
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: 'Endpoint table: health, fleet, tasks, output, artifacts, messages, events, plugins, slots.'
- source: docs
  path: docs/spec.md
  lines: 67-78
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/docs/spec.md#L67-L78
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: MVP API table.

- source: api
  endpoint: GET /api/insights
  observedAt: 2026-10-25
  observedBy: claude
  session: ac2a66e2-d79c-4230-8280-0e81660d875b
  note: Returns time segments (build/review/deciding/ci/captain), decision entries with IDs, confidence levels, and quota allowance/atRisk status for the captain's task tracking and Claude API headroom awareness.
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
  note: Loopback Host check and Origin+session-token check on mutating requests.
provenance:
  capturedBy: claude
---

# Wheelhouse HTTP API

The loopback-only JSON API the Wheelhouse pages use (routes under
`src/routes/api/`): `GET /api/health`, `/api/fleet`, `/api/tasks/:id`,
`/api/tasks/:id/output`, `/api/tasks/:id/artifacts/...`, `GET`/`POST
/api/firstmate/messages` (POST takes an `Idempotency-Key`), `/api/events`
(server-sent events: `fleet`, `health`, `messages`), `/api/plugins` and
`/api/slots`. Mutating requests are guarded as described in
[[constraint.loopback-only-with-origin-token]]. Not versioned.
