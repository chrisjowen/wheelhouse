---
id: library.plugin-vault
type: library
title: Vault plugin
tags:
  - first-party
  - plugin
attributes:
  language: javascript
links:
  - rel: depends_on
    target: library.wheelhouse-plugin-sdk
    evidence:
      - source: config
        path: plugins/vault/.wheelhouse-plugin/plugin.json
        lines: 2
        key: $schema
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: code
        path: plugins/vault/wheelhouse/server/index.js
        symbol: "@typedef import('@chrisjowen/wheelhouse-plugin-sdk')"
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: service.wh-vault
    evidence:
      - source: code
        path: plugins/vault/wheelhouse/server/index.js
        lines: 2-49
        note: Runs `wh-vault list --all --json` and `wh-vault audit --json`.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: config
    path: plugins/vault/.wheelhouse-plugin/plugin.json
    lines: 1-5
    key: name
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: docs
    path: plugins/vault/README.md
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# Vault plugin

An in-repo plugin bundled with Wheelhouse in the installed-plugin format (`plugins/vault/`): a `.wheelhouse-plugin/plugin.json` manifest and dependency-free ESM entries.

Shows what wh-vault holds, by name only: a Vault page, project Secrets tabs and task Secrets used tabs. On by default; read-only.
