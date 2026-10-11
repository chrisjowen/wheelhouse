---
id: constraint.read-only-toward-firstmate
type: constraint
title: Read-only toward Firstmate; all messages go to Firstmate
tags:
- firstmate
- safety
links:
- rel: governs
  target: service.wheelhouse
  evidence:
  - source: docs
    path: README.md
    lines: '62'
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L62
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: The only write Wheelhouse makes to Firstmate is fm-inbox.sh note.
- rel: governs
  target: library.plugin-system
  evidence:
  - source: docs
    path: README.md
    lines: '142'
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L142
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Plugins cannot write, message Firstmate or control workers.
evidence:
- source: docs
  path: README.md
  lines: '62'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L62
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: docs
  path: docs/spec.md
  lines: '49'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/docs/spec.md#L49
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: No direct worker messaging or lifecycle controls.
- source: docs
  path: docs/spec.md
  lines: 112-123
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/docs/spec.md#L112-L123
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Out of scope and acceptance criteria.
provenance:
  capturedBy: claude
---

# Read-only toward Firstmate; all messages go to Firstmate

Wheelhouse attaches without changing Firstmate's configuration and never
starts, stops or controls Firstmate or its workers. Its only write is
`fm-inbox.sh note`; every message goes to Firstmate, never directly to a
worker; worker output is inspectable but cannot accept input; and closing
Wheelhouse must not interrupt work. Plugins inherit the same limit.
