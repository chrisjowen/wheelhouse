---
id: library.plugin-github-issues
type: library
title: GitHub issues plugin
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
        path: plugins/github-issues/.wheelhouse-plugin/plugin.json
        lines: 2
        key: $schema
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: code
        path: plugins/github-issues/wheelhouse/server/index.js
        symbol: "@typedef import('@chrisjowen/wheelhouse-plugin-sdk')"
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: config
    path: plugins/github-issues/.wheelhouse-plugin/plugin.json
    lines: 1-5
    key: name
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: docs
    path: plugins/github-issues/README.md
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# GitHub issues plugin

An in-repo plugin bundled with Wheelhouse in the installed-plugin format (`plugins/github-issues/`): a `.wheelhouse-plugin/plugin.json` manifest and dependency-free ESM entries.

Lists open GitHub issues matching the watch rule per project, with a Hand to Firstmate link. Off unless plugins.json enables it.
