---
id: library.eslint
type: library
title: ESLint
tags:
  - third-party
  - tooling
attributes:
  language: typescript
  package: eslint
evidence:
  - source: manifest
    path: package.json
    lines: 78
    key: devDependencies.eslint
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: manifest
    path: package.json
    lines: 61
    key: devDependencies.@eslint/js
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: manifest
    path: package.json
    lines: 95
    key: devDependencies.typescript-eslint
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: manifest
    path: package.json
    lines: 80
    key: devDependencies.eslint-plugin-svelte
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: manifest
    path: package.json
    lines: 79
    key: devDependencies.eslint-config-prettier
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# ESLint

Tooling - a build-time (devDependencies) package of Wheelhouse.

Linting (`npm run lint`), with typescript-eslint, eslint-plugin-svelte and eslint-config-prettier.

Captured together with: `@eslint/js`, `typescript-eslint`, `eslint-plugin-svelte`, `eslint-config-prettier`.
