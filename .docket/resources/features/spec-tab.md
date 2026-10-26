---
id: feature.spec-tab
type: feature
title: Spec tab—guided spec drafting and sending
tags:
- specs
- ui
- firstmate
attributes:
  status: shipped
links:
- rel: implements
  target: api.wheelhouse-http
  evidence:
  - source: api
    endpoint: POST /api/specs
    observedAt: '2026-10-26'
    observedBy: claude
    session: de0b6853-9625-4e33-b558-9e8a32a47046
  - source: api
    endpoint: PUT /api/specs/:id
    observedAt: '2026-10-26'
    observedBy: claude
    session: de0b6853-9625-4e33-b558-9e8a32a47046
  - source: api
    endpoint: POST /api/specs/:id/sent
    observedAt: '2026-10-26'
    observedBy: claude
    session: de0b6853-9625-4e33-b558-9e8a32a47046
  - source: api
    endpoint: GET /api/specs/:id/images/:name
    observedAt: '2026-10-26'
    observedBy: claude
    session: de0b6853-9625-4e33-b558-9e8a32a47046
- rel: constrained_by
  target: constraint.spec-16kib-message-limit
  evidence:
  - source: conversation
    observedAt: '2026-10-26'
    observedBy: claude
    session: de0b6853-9625-4e33-b558-9e8a32a47046
- rel: tests
  target: test_suite.smoke
  evidence:
  - source: code
    path: tests/smoke/server.test.ts
    observedAt: '2026-10-26'
    observedBy: claude
    session: de0b6853-9625-4e33-b558-9e8a32a47046
    note: Spec smoke test includes 10 scenarios covering UI, API, and edge cases.
- rel: tests
  target: test_suite.unit
  evidence:
  - source: code
    path: src/lib/server/specs/store.test.ts
    observedAt: '2026-10-26'
    observedBy: claude
    session: de0b6853-9625-4e33-b558-9e8a32a47046
    note: 18 unit tests for spec store, state management, and sentAt semantics.
evidence:
- source: conversation
  observedAt: '2026-10-26'
  observedBy: claude
  session: de0b6853-9625-4e33-b558-9e8a32a47046
  note: >-
    Spec tab (accessed from the header) provides a guided 9-section form for
    drafting specs: Project, Problem, Goal, Requirements, Solution, UI notes,
    Success, Risks, and Timeline. Sections autosave as edited. Requirements
    become checkboxes in the preview. Captain can upload screenshots to UI notes;
    images are stored and served from /api/specs/<id>/images/<name>. The As sent
    view shows the exact formatted message. Send button disabled until title
    present or if spec exceeds 16 KiB. Sending delivers the spec as one message
    to Firstmate, records sentAt, and preserves edits made after Send was
    clicked. UI is responsive at 390px (sections become a step picker). 20
    concurrent save/upload operations tested; both picture and text always kept.
    Guarded by session token.
provenance:
  capturedBy: claude
---

# Spec tab—guided spec drafting and sending

Captain opens the Spec tab from the header to draft a guided spec with nine
sections (Project, Problem, Goal, Requirements, Solution, UI notes, Success,
Risks, Timeline). Sections autosave as edited. Requirements list items render
as checkboxes in a live preview. Captain can upload screenshots to UI notes;
they are served from `/api/specs/:id/images/:name`. The As sent view shows
what the formatted message will look like.

Send button: disabled until the spec has a title (Project, Problem, or Goal
required); disabled with a plain message if the serialized spec exceeds 16 KiB.

Sending delivers the spec to Firstmate as one message, records when it was
sent, and allows further edits. Autosaves racing concurrent picture uploads
keep both the picture and text. Narrow layout at 390px folds specs list and
sections become a step picker. Guarded by session token.
