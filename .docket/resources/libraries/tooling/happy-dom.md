---
id: library.happy-dom
type: library
title: happy-dom
tags:
  - third-party
  - tooling
attributes:
  language: typescript
  package: happy-dom
links:
  - rel: uses
    target: library.vitest
    evidence:
      - source: config
        path: vite.config.ts
        lines: 49
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 82
    key: devDependencies.happy-dom
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# happy-dom

Tooling - a build-time (devDependencies) package of Wheelhouse.

The DOM environment for the Vitest `dom` project.
