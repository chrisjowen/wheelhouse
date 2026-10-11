---
id: library.commander
type: library
title: Commander
tags:
- cli
attributes:
  language: javascript
  package: commander
evidence:
- source: manifest
  path: package.json
  lines: 31-33
  key: dependencies.commander
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L31-L33
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: The only runtime dependency, ^14.0.0.
- source: code
  path: cli/index.ts
  lines: 158-165
  symbol: command('open')
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/cli/index.ts#L158-L165
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# Commander

Argument parsing for the `wheelhouse` CLI (`cli/index.ts`, bundled by esbuild
into `dist/cli.js`). It is the package's only runtime `dependency`; everything
else is a devDependency bundled at build time.
