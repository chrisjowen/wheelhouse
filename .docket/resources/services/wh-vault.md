---
id: service.wh-vault
type: service
title: wh-vault CLI
tags:
  - first-party
  - cli
attributes:
  language: typescript
  lifecycle: active
links:
  - rel: depends_on
    target: library.commander
    attributes:
      runtime: true
    evidence:
      - source: code
        path: cli/vault/program.ts
        lines: 4
        symbol: import { Command } from 'commander'
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 55
        key: dependencies.commander
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.esbuild
    attributes:
      runtime: false
    evidence:
      - source: manifest
        path: package.json
        lines: 43
        key: scripts.build:cli
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 77
        key: devDependencies.esbuild
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 24-27
    key: bin.wh-vault
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: code
    path: cli/vault/index.ts
    lines: 1-15
    symbol: vaultProgram
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# wh-vault CLI

The `wh-vault` secrets command (`cli/vault/`, bundled to `dist/wh-vault.js`):
set, grant, revoke, list, audit and run with secrets kept in the OS keychain.
Wheelhouse's vault API and the Vault plugin both run it. See docs/vault.md.
