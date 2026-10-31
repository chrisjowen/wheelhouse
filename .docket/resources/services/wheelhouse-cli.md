---
id: service.wheelhouse-cli
type: service
title: wheelhouse CLI
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
        path: cli/index.ts
        lines: 8
        symbol: import { Command } from 'commander'
        note: The wheelhouse command, with its plugin, gateway and upgrade subcommands, is a commander program.
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
  - rel: uses
    target: service.wheelhouse
    evidence:
      - source: code
        path: cli/index.ts
        lines: 165-172
        symbol: fork(cli, ['__server', ...])
        note: The CLI supervises the web server as a forked child and restarts it.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: service.wh-vault
    evidence:
      - source: manifest
        path: package.json
        lines: 24-27
        key: bin
        note: Both commands ship in the same package.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 24-27
    key: bin.wheelhouse
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: code
    path: cli/index.ts
    lines: 1-20
    note: Entry point; registers plugin, gateway and upgrade subcommands.
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# wheelhouse CLI

The `wheelhouse` command (`cli/index.ts`, bundled by esbuild to `dist/cli.js`).
It resolves the Firstmate install, sets the state, config and plugin
directories (including `WHEELHOUSE_BUNDLED_PLUGINS_DIR` for the in-repo
plugins), then forks and supervises the web server. Subcommands: `plugin`,
`gateway` and `upgrade`.
