---
id: system.firstmate
type: system
title: Firstmate
tags:
- firstmate
- orchestrator
attributes:
  category: other
evidence:
- source: docs
  path: README.md
  lines: '3'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L3
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Wheelhouse is a companion to github.com/kunchenguid/firstmate.
- source: docs
  path: README.md
  lines: 7-11
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L7-L11
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Needs a Firstmate checkout and operational home (state/ and data/).
- source: code
  path: src/lib/server/firstmate/install.ts
  lines: 71-73
  symbol: looksLikeFirstmate
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/install.ts#L71-L73
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# Firstmate

The agent-fleet orchestrator Wheelhouse watches and talks to
(<https://github.com/kunchenguid/firstmate>). Wheelhouse needs a Firstmate
checkout (for its `bin/fm-*` scripts) and its operational home (`state/`,
`data/`), resolved from `--firstmate`/`--home`, `$FM_HOME`, or the checkout it
is run inside. Wheelhouse never starts, stops or reconfigures Firstmate.
