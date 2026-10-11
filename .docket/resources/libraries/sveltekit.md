---
id: library.sveltekit
type: library
title: SvelteKit 2
tags:
- framework
attributes:
  language: typescript
  package: '@sveltejs/kit'
  license: MIT
evidence:
- source: manifest
  path: package.json
  lines: 39-40
  key: devDependencies.@sveltejs/kit
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L39-L40
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: ^2.70.3, with @sveltejs/adapter-node ^5.5.7.
- source: config
  path: svelte.config.js
  lines: 1-12
  symbol: kit.adapter
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/svelte.config.js#L1-L12
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# SvelteKit 2

The web framework for Wheelhouse's UI and server API (`@sveltejs/kit` ^2.70.3,
Svelte 5, Vite 7, adapter-node). Pinned to major version 2 on purpose; see
[[decision.pin-sveltekit-2]]. License recorded from the upstream project, not
read from this repository.
