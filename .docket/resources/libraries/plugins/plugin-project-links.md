---
id: library.plugin-project-links
type: library
title: Project links plugin
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
        path: plugins/project-links/.wheelhouse-plugin/plugin.json
        lines: 2
        key: $schema
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: code
        path: plugins/project-links/wheelhouse/server/index.js
        symbol: "@typedef import('@chrisjowen/wheelhouse-plugin-sdk')"
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: config
    path: plugins/project-links/.wheelhouse-plugin/plugin.json
    lines: 1-5
    key: name
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: docs
    path: plugins/project-links/README.md
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# Project links plugin

An in-repo plugin bundled with Wheelhouse in the installed-plugin format (`plugins/project-links/`): a `.wheelhouse-plugin/plugin.json` manifest and dependency-free ESM entries.

Fills a project tab, a Harbour card, task sections and a Bridge card from the clone's origin remote, README and the fleet. Off unless plugins.json enables it.
