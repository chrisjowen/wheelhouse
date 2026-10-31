---
id: library.xterm-addon-fit
type: library
title: xterm.js fit addon
tags:
  - third-party
  - terminal-chat-rendering
attributes:
  language: typescript
  package: '@xterm/addon-fit'
links:
  - rel: depends_on
    target: library.xterm
    evidence:
      - source: code
        path: src/lib/components/firstmate/Terminal.svelte
        lines: 3-99
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 72
    key: devDependencies.@xterm/addon-fit
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# xterm.js fit addon

Terminal and chat rendering - a build-time (devDependencies) package of Wheelhouse.

Sizes the xterm.js terminal to its container.
