---
id: library.sveltekit-adapter-node
type: library
title: SvelteKit adapter-node
tags:
  - third-party
  - app-framework
attributes:
  language: typescript
  package: '@sveltejs/adapter-node'
links:
  - rel: depends_on
    target: library.sveltekit
    evidence:
      - source: config
        path: svelte.config.js
        lines: 1
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 66
    key: devDependencies.@sveltejs/adapter-node
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# SvelteKit adapter-node

App framework - a build-time (devDependencies) package of Wheelhouse.

Builds the app as a standalone Node server under build/, which the CLI runs.
