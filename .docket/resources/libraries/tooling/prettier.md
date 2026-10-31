---
id: library.prettier
type: library
title: Prettier
tags:
  - third-party
  - tooling
attributes:
  language: typescript
  package: prettier
evidence:
  - source: manifest
    path: package.json
    lines: 84
    key: devDependencies.prettier
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: manifest
    path: package.json
    lines: 85
    key: devDependencies.prettier-plugin-svelte
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: manifest
    path: package.json
    lines: 86
    key: devDependencies.prettier-plugin-tailwindcss
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# Prettier

Tooling - a build-time (devDependencies) package of Wheelhouse.

Formatting (`npm run format`, checked by `npm run lint`), with the Svelte and Tailwind plugins.

Captured together with: `prettier-plugin-svelte`, `prettier-plugin-tailwindcss`.
