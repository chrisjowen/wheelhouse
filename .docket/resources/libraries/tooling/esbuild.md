---
id: library.esbuild
type: library
title: esbuild
tags:
  - third-party
  - tooling
attributes:
  language: typescript
  package: esbuild
evidence:
  - source: manifest
    path: package.json
    lines: 77
    key: devDependencies.esbuild
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# esbuild

Tooling - a build-time (devDependencies) package of Wheelhouse.

Bundles cli/index.ts and cli/vault/index.ts into dist/cli.js and dist/wh-vault.js.
