---
id: decision.pin-sveltekit-2
type: decision
title: Pin SvelteKit 2 rather than SvelteKit 3
tags:
- stack
links:
- rel: uses
  target: library.sveltekit
  evidence:
  - source: manifest
    path: package.json
    lines: '40'
    key: devDependencies.@sveltejs/kit
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L40
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: docs
  path: README.md
  lines: 210-212
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L210-L212
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: 'Stack choice: SvelteKit 2 works with shadcn-svelte as generated; SvelteKit 3 needed workarounds.'
provenance:
  capturedBy: claude
---

# Pin SvelteKit 2 rather than SvelteKit 3

Wheelhouse uses SvelteKit 2 with Svelte 5, Vite 7, Tailwind 4 and
shadcn-svelte. The UI prototype ran on SvelteKit 3 but needed workarounds for
shadcn-svelte (`#lib` aliases, a crash on `extends: "$app/tsconfig"`, patched
component state attributes). SvelteKit 2 works with standard `$lib` aliases and
generated components, so this build pins it. Moving to SvelteKit 3 is a later,
separate change once shadcn-svelte supports it cleanly.
