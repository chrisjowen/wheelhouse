---
id: service.wheelhouse
type: service
title: Wheelhouse web app
tags:
  - first-party
  - app
attributes:
  language: typescript
  lifecycle: active
links:
  - rel: depends_on
    target: library.node-pty
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/server/sessions/terminal.ts
        lines: 89-96
        symbol: nodePty
        note: Spawns session terminals through node-pty, imported on first use.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 56
        key: dependencies.node-pty
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.ws
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/server/sessions/terminal.ts
        lines: 3
        symbol: WebSocketServer
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: code
        path: src/lib/server/gateway/channels/discord.ts
        lines: 1
        symbol: WebSocket
        note: The Discord gateway channel connects with ws.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 57
        key: dependencies.ws
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.yaml
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/server/sessions/commands.ts
        lines: 3
        symbol: parse
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: code
        path: src/lib/server/passages/schema.ts
        lines: 1
        symbol: parseDocument
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 58
        key: dependencies.yaml
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.svelte
    attributes:
      runtime: true
    evidence:
      - source: config
        path: svelte.config.js
        lines: 1
        note: The app is configured as a Svelte project.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 88
        key: devDependencies.svelte
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.sveltekit
    attributes:
      runtime: true
    evidence:
      - source: config
        path: vite.config.ts
        lines: 2-29
        symbol: sveltekit()
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 67
        key: devDependencies.@sveltejs/kit
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.sveltekit-adapter-node
    attributes:
      runtime: false
    evidence:
      - source: config
        path: svelte.config.js
        lines: 1
        symbol: import adapter from '@sveltejs/adapter-node'
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 66
        key: devDependencies.@sveltejs/adapter-node
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.vite
    attributes:
      runtime: false
    evidence:
      - source: manifest
        path: package.json
        lines: 41-42
        key: scripts.dev, scripts.build
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 96
        key: devDependencies.vite
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.tailwindcss
    attributes:
      runtime: false
    evidence:
      - source: code
        path: src/app.css
        lines: 1
        symbol: "@import 'tailwindcss'"
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: config
        path: vite.config.ts
        lines: 1-29
        symbol: tailwindcss()
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 92
        key: devDependencies.tailwindcss
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.tailwind-merge
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/utils.ts
        lines: 1-2
        symbol: cn
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 90
        key: devDependencies.tailwind-merge
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.tailwind-variants
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/components/ui/button/button.svelte
        lines: 2
        symbol: tv
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 91
        key: devDependencies.tailwind-variants
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.tw-animate-css
    attributes:
      runtime: false
    evidence:
      - source: code
        path: src/app.css
        lines: 2
        symbol: "@import 'tw-animate-css'"
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 93
        key: devDependencies.tw-animate-css
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.shadcn-svelte
    evidence:
      - source: config
        path: components.json
        lines: 1-19
        note: 'shadcn-svelte configuration: components in $lib/components/ui, lucide icons.'
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 87
        key: devDependencies.shadcn-svelte
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.bits-ui
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/components/ui/tooltip/tooltip.svelte
        lines: 2
        symbol: TooltipPrimitive
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 74
        key: devDependencies.bits-ui
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.lucide-svelte
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/components/ui/dropdown-menu/dropdown-menu-checkbox-item.svelte
        lines: 3-4
        symbol: '@lucide/svelte/icons'
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 65
        key: devDependencies.@lucide/svelte
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.fontsource
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/app.css
        lines: 4-7
        symbol: '@fontsource-variable'
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 62
        key: devDependencies.@fontsource-variable/inter
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.xterm
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/components/firstmate/Terminal.svelte
        lines: 3-98
        symbol: import('@xterm/xterm')
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 73
        key: devDependencies.@xterm/xterm
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.xterm-addon-fit
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/components/firstmate/Terminal.svelte
        lines: 4-99
        symbol: import('@xterm/addon-fit')
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 72
        key: devDependencies.@xterm/addon-fit
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.marked
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/chat/markdown.ts
        lines: 2-19
        symbol: marked.parse
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 83
        key: devDependencies.marked
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.dompurify
    attributes:
      runtime: true
    evidence:
      - source: code
        path: src/lib/chat/markdown.ts
        lines: 1-19
        symbol: DOMPurify.sanitize
        note: Every Markdown render is sanitized by DOMPurify.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 76
        key: devDependencies.dompurify
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.typescript
    evidence:
      - source: manifest
        path: package.json
        lines: 47
        key: scripts.check
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 94
        key: devDependencies.typescript
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.svelte-check
    evidence:
      - source: manifest
        path: package.json
        lines: 47
        key: scripts.check
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 89
        key: devDependencies.svelte-check
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.vitest
    evidence:
      - source: config
        path: vite.config.ts
        lines: 6-57
        symbol: test.projects
        note: unit, dom and smoke projects.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 97
        key: devDependencies.vitest
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.happy-dom
    evidence:
      - source: config
        path: vite.config.ts
        lines: 49
        symbol: "environment: 'happy-dom'"
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 82
        key: devDependencies.happy-dom
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.eslint
    evidence:
      - source: config
        path: eslint.config.js
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 48
        key: scripts.lint
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 78
        key: devDependencies.eslint
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.prettier
    evidence:
      - source: manifest
        path: package.json
        lines: 48-49
        key: scripts.lint, scripts.format
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: package.json
        lines: 84
        key: devDependencies.prettier
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.plugin-github-issues
    evidence:
      - source: code
        path: src/lib/server/plugins/loader.ts
        lines: 58-62
        symbol: bundledPluginsDir
        note: Bundled plugins are loaded from plugins/ at startup through the installed-plugin loader.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: docs
        path: plugins/github-issues/README.md
        lines: 1-5
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.plugin-project-links
    evidence:
      - source: code
        path: src/lib/server/plugins/loader.ts
        lines: 58-62
        symbol: bundledPluginsDir
        note: Bundled plugins are loaded from plugins/ at startup through the installed-plugin loader.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: docs
        path: plugins/project-links/README.md
        lines: 1-5
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: library.plugin-vault
    evidence:
      - source: code
        path: src/lib/server/plugins/loader.ts
        lines: 58-62
        symbol: bundledPluginsDir
        note: Bundled plugins are loaded from plugins/ at startup through the installed-plugin loader.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: docs
        path: plugins/vault/README.md
        lines: 1-5
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: uses
    target: service.wh-vault
    evidence:
      - source: code
        path: src/lib/server/vault.ts
        lines: 14-17
        note: The vault API runs the bundled wh-vault.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
  - rel: depends_on
    target: library.wheelhouse-plugin-sdk
    evidence:
      - source: code
        path: src/lib/server/plugins/manifest.ts
        lines: 43
        note: The manifest fields the loader accepts are the ones the SDK publishes in plugin.schema.json.
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
      - source: manifest
        path: packages/plugin-sdk/package.json
        lines: 2
        key: name
        observedAt: '2026-10-31'
        observedBy: claude
        commit: a0a6c19
evidence:
  - source: manifest
    path: package.json
    lines: 2-4
    key: name, description
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: config
    path: svelte.config.js
    lines: 1
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
  - source: docs
    path: README.md
    lines: 1-40
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# Wheelhouse web app

The local web app for talking to Firstmate and watching its crew work: chat,
live task progress, previews, review, the Harbour of projects and session
terminals. A SvelteKit (Svelte 5) app built with Vite and adapter-node into a
Node server under `build/`, which the `wheelhouse` CLI starts on 127.0.0.1.
Server code lives in `src/lib/server`, UI in `src/lib/components` (shadcn-svelte
components on Bits UI and Tailwind), and it loads the in-repo plugins from
`plugins/` at startup.

Runtime dependencies (package.json `dependencies`): commander, node-pty, ws and
yaml. Everything else is bundled at build time from `devDependencies`.
