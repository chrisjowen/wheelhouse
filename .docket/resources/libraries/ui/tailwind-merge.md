---
id: library.tailwind-merge
type: library
title: tailwind-merge
tags:
  - third-party
  - ui
attributes:
  language: typescript
  package: tailwind-merge
evidence:
  - source: manifest
    path: package.json
    lines: 90
    key: devDependencies.tailwind-merge
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: manifest
    path: package.json
    lines: 75
    key: devDependencies.clsx
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# tailwind-merge

UI - a build-time (devDependencies) package of Wheelhouse.

Merges conflicting Tailwind classes; with clsx it forms the `cn()` helper in src/lib/utils.ts.

Captured together with: `clsx`.
