---
id: library.sveltekit
type: library
title: SvelteKit
tags:
  - third-party
  - app-framework
attributes:
  language: typescript
  package: '@sveltejs/kit'
links:
  - rel: depends_on
    target: library.svelte
    evidence:
      - source: manifest
        path: package.json
        lines: 67-88
        key: devDependencies
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.vite
    evidence:
      - source: config
        path: vite.config.ts
        lines: 2-29
        symbol: sveltekit()
        note: SvelteKit runs as a Vite plugin.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 67
    key: devDependencies.@sveltejs/kit
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: manifest
    path: package.json
    lines: 68
    key: devDependencies.@sveltejs/vite-plugin-svelte
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# SvelteKit

App framework - a build-time (devDependencies) package of Wheelhouse.

The application framework: routes, server endpoints and the Vite plugin that builds the app.

Captured together with: `@sveltejs/vite-plugin-svelte`.
