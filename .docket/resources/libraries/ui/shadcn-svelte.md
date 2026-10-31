---
id: library.shadcn-svelte
type: library
title: shadcn-svelte
tags:
  - third-party
  - ui
attributes:
  language: typescript
  package: shadcn-svelte
links:
  - rel: uses
    target: library.bits-ui
    evidence:
      - source: code
        path: src/lib/components/ui/tooltip/tooltip.svelte
        lines: 2
        note: The generated shadcn-svelte components are built on Bits UI.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.tailwind-variants
    evidence:
      - source: code
        path: src/lib/components/ui/button/button.svelte
        lines: 2
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.lucide-svelte
    evidence:
      - source: config
        path: components.json
        lines: 15
        key: iconLibrary
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.tailwindcss
    evidence:
      - source: config
        path: components.json
        lines: 3-6
        key: tailwind
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 87
    key: devDependencies.shadcn-svelte
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# shadcn-svelte

UI - a build-time (devDependencies) package of Wheelhouse.

The component registry and CLI that generated src/lib/components/ui (configured by components.json).
