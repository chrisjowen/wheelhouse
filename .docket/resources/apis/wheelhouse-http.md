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
- source: api
  endpoint: POST /api/specs
  observedAt: '2026-10-26'
  observedBy: claude
  session: de0b6853-9625-4e33-b558-9e8a32a47046
  note: Create a new spec draft.
- source: api
  endpoint: GET /api/specs/:id
  observedAt: '2026-10-26'
  observedBy: claude
  session: de0b6853-9625-4e33-b558-9e8a32a47046
  note: Retrieve a spec draft in JSON format.
- source: api
  endpoint: PUT /api/specs/:id
  observedAt: '2026-10-26'
  observedBy: claude
  session: de0b6853-9625-4e33-b558-9e8a32a47046
  note: Update a spec draft; autosave path.
- source: api
  endpoint: GET /api/specs/:id/images/:name
  observedAt: '2026-10-26'
  observedBy: claude
  session: de0b6853-9625-4e33-b558-9e8a32a47046
  note: Serve uploaded spec images; path included in sent message.
- source: api
  endpoint: POST /api/specs/:id/sent
  observedAt: '2026-10-26'
  observedBy: claude
  session: de0b6853-9625-4e33-b558-9e8a32a47046
  note: >-
    Mark a spec as sent (sets sentAt only). PUT /api/specs/:id/sent returns
    405. POST returns 413 (Payload Too Large) if spec exceeds 16 KiB.
    Sending delivers spec to Firstmate and records when sent; edits made after
    Send was clicked are preserved.
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
- source: api
  endpoint: GET /api/tasks/:id
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Returns task with build.conversation (worker questions and Firstmate answers),
    build.checks (test results with pass/fail counts and output), and build.docs
    (list of decision records and docs read/changed in the session, filtered to
    exclude node_modules and other branches).
- source: api
  endpoint: GET /tasks/:id/doc
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Doc reader with query param path=<path>. Returns document content with truncated
    flag for large docs read through git show. Validates path against task's doc list
    and refuses paths outside it (../secret.md, /etc/passwd, docs from other branches,
    node_modules).
- source: api
  endpoint: GET /tasks/:id?tab=<tab>
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Tab routing parameter; tabs include conversation, checks, docs. Page loads with
    tab selected without scrolling page down on narrow screens.
- source: api
  endpoint: GET /harbour
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Fleet overview page. Harbour cards show 'N docs referenced · M changed' hint
    that links to task's Docs tab (/tasks/<id>?tab=docs).
provenance:
  capturedBy: claude
---

# Wheelhouse HTTP API

The loopback-only JSON API the Wheelhouse pages use (routes under
`src/routes/api/`): `GET /api/health`, `/api/fleet`, `/api/tasks/:id`,
`/api/tasks/:id/output`, `/api/tasks/:id/artifacts/...`, `GET`/`POST
/api/firstmate/messages` (POST takes an `Idempotency-Key`), `/api/events`
(server-sent events: `fleet`, `health`, `messages`), `/api/plugins` and
`/api/slots`. Specs: `POST /api/specs` (create), `GET /api/specs/:id`
(retrieve draft), `PUT /api/specs/:id` (update), `GET
/api/specs/:id/images/:name` (serve uploaded images), `POST
/api/specs/:id/sent` (mark sent—sets sentAt only, does not overwrite
edits). Mutating requests are guarded as described in
[[constraint.loopback-only-with-origin-token]]. Not versioned.
