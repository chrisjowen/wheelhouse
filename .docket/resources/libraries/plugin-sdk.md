---
id: library.wheelhouse-plugin-sdk
type: library
title: Wheelhouse plugin SDK
tags:
  - first-party
  - plugin
attributes:
  language: javascript
  package: '@chrisjowen/wheelhouse-plugin-sdk'
  license: MIT
evidence:
  - source: manifest
    path: packages/plugin-sdk/package.json
    lines: 2-5
    key: name, description
    observedAt: '2026-10-31'
    observedBy: claude
    commit: a0a6c19
provenance:
  capturedBy: claude
---

# Wheelhouse plugin SDK

`packages/plugin-sdk`: types, block builders and the manifest JSON schema
(`plugin.schema.json`) for Wheelhouse plugins. The in-repo plugins reference
its schema and types.
