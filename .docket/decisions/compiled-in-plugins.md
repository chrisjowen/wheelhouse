---
id: decision.compiled-in-plugins
type: decision
title: Plugins are compiled in, filling fixed slots
tags:
- plugins
- architecture
links:
- rel: uses
  target: library.plugin-system
  evidence:
  - source: code
    path: src/lib/server/plugins/builtin.ts
    lines: 4-5
    symbol: BUILTIN_PLUGINS
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/plugins/builtin.ts#L4-L5
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: docs
  path: README.md
  lines: '132'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L132
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: First-party code compiled in; no microfrontends, iframes or runtime-loaded bundles; plugins cannot
    add slots.
- source: docs
  path: README.md
  lines: '144'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L144
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Versioned apiVersion contract; loads current and previous only.
provenance:
  capturedBy: claude
---

# Plugins are compiled in, filling fixed slots

Plugins are "panels and providers": first-party code compiled into Wheelhouse
and registered in `BUILTIN_PLUGINS`. There are no microfrontends, iframes or
runtime-loaded bundles, and plugins cannot add slots - they contribute to five
fixed slots using versioned blocks or their own Svelte panel. Read-only is the
plugin's contract, reviewed in Wheelhouse's pull requests, not a sandbox.
