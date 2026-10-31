---
id: library.typescript
type: library
title: TypeScript
tags:
  - third-party
  - tooling
attributes:
  language: typescript
  package: typescript
evidence:
  - source: manifest
    path: package.json
    lines: 94
    key: devDependencies.typescript
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# TypeScript

Tooling - a build-time (devDependencies) package of Wheelhouse.

The language of the server, CLI and components; `npm run check` type-checks the CLI with tsc.
