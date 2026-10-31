---
id: repository.wheelhouse
type: repository
title: wheelhouse repository
attributes:
  url: https://github.com/chrisjowen/wheelhouse
  defaultBranch: main
links:
  - rel: contains
    target: service.wheelhouse
    evidence:
      - source: manifest
        path: package.json
        lines: 2
        key: name
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: contains
    target: service.wheelhouse-cli
    evidence:
      - source: code
        path: cli/index.ts
        lines: 1
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: contains
    target: service.wh-vault
    evidence:
      - source: code
        path: cli/vault/index.ts
        lines: 1
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: contains
    target: library.wheelhouse-plugin-sdk
    evidence:
      - source: manifest
        path: packages/plugin-sdk/package.json
        lines: 2
        key: name
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: contains
    target: library.plugin-github-issues
    evidence:
      - source: config
        path: plugins/github-issues/.wheelhouse-plugin/plugin.json
        lines: 3
        key: name
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: contains
    target: library.plugin-project-links
    evidence:
      - source: config
        path: plugins/project-links/.wheelhouse-plugin/plugin.json
        lines: 3
        key: name
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: contains
    target: library.plugin-vault
    evidence:
      - source: config
        path: plugins/vault/.wheelhouse-plugin/plugin.json
        lines: 3
        key: name
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 6-9
    key: repository
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# wheelhouse repository

One npm package, `@chrisjowen/wheelhouse`, holding the SvelteKit web app
(`src/`), the `wheelhouse` and `wh-vault` commands (`cli/`), the bundled plugins
(`plugins/`) and the plugin SDK (`packages/plugin-sdk`).
