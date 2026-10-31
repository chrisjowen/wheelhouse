---
id: library.node-pty
type: library
title: node-pty
tags:
  - third-party
  - server-runtime
attributes:
  language: typescript
  package: node-pty
evidence:
  - source: manifest
    path: package.json
    lines: 56
    key: dependencies.node-pty
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# node-pty

Server runtime - a runtime dependency of Wheelhouse.

Pseudo-terminals for the session terminals the browser attaches to; loaded on first use so Wheelhouse still starts where it cannot load.
