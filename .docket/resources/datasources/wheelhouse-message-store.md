---
id: datasource.wheelhouse-message-store
type: datasource
title: Wheelhouse state directory (message store)
tags:
- wheelhouse
- state
attributes:
  zone: private
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
- source: code
  path: src/lib/server/store/store.ts
  lines: 18-20
  symbol: STORE_SCHEMA
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/store/store.ts#L18-L20
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: wheelhouse-message-store.v1, at most 500 messages.
- source: docs
  path: README.md
  lines: '50'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L50
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# Wheelhouse state directory (message store)

Wheelhouse's only persistent state: a `wheelhouse-message-store.v1` JSON file
per Firstmate home holding sent messages, delivery outcomes, receipts and the
receipts cursor (at most 500 messages). Directory: `--state-dir`, else
`$WHEELHOUSE_STATE_DIR`, else `$XDG_STATE_HOME/wheelhouse`, else
`~/.local/state/wheelhouse`; it must be outside the Firstmate home. Plugin
enablement lives separately in `plugins.json` in the config directory.
