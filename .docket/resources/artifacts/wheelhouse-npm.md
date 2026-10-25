---
name: wheelhouse-npm
id: artifact.wheelhouse-npm-package
type: artifact
title: Wheelhouse npm Package

attributes:
  kind: package
  registry: npmjs.org
  name: '@chrisjowen/wheelhouse'

links:
  - rel: built_from
    target: repository.wheelhouse
  - rel: built_from
    target: service.wheelhouse

evidence:
  - source: manifest
    path: package.json
    lines: '1-5'
    key: name, version
    observedAt: '2026-10-25'
    observedBy: claude
    session: 323d6e3b-9ff0-49ca-bc37-e286e5ebcd9f
    note: Package published to npm as @chrisjowen/wheelhouse

  - source: infrastructure
    path: .github/workflows/release.yml
    lines: '1-99'
    observedAt: '2026-10-25'
    observedBy: claude
    session: 323d6e3b-9ff0-49ca-bc37-e286e5ebcd9f
    note: Release workflow publishes package to npm with semantic versioning, pre-releases to "next" tag

provenance:
  capturedBy: claude
---

# Wheelhouse npm Package

The CLI tool and service distributed to npm as `@chrisjowen/wheelhouse`.

## Publishing

Published via the Release workflow when a vX.Y.Z tag is pushed or a GitHub release is published. Uses npm trusted publishing via GitHub OIDC (with npm token fallback).

- Pre-releases (e.g., 1.2.0-beta.1) → "next" dist-tag
- Full releases → "latest" dist-tag

All releases include provenance metadata.

## Installation and Startup

The CI and Release workflows validate the package by installing and running the CLI before merge/publish:

```bash
npm pack --pack-destination "$tmp"
npm install -g --prefix "$tmp/prefix" "$tmp"/*.tgz
"$tmp/prefix/bin/wheelhouse" --help
"$tmp/prefix/bin/wheelhouse" --version
```

This catches build failures (bad imports, missing runtime dependencies) that would otherwise ship.
