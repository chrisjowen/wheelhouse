---
id: system.docket
type: system
title: Docket - local-first project knowledge
tags:
  - external-system
  - knowledge-management
attributes:
  category: other
  vendor: chrisjowen

evidence:
  - source: code
    path: src/lib/plugins/docket/plugin.server.ts
    lines: '119-125'
    symbol: readGraph function
    commit: 587886c
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/587886c/src/lib/plugins/docket/plugin.server.ts#L119-L125
    observedAt: '2026-10-11'
    observedBy: claude
    session: 5703edca-a69f-4805-b0ab-5496e3248e3d
    note: Wheelhouse plugin executes docket CLI with `docket graph --json` to read project knowledge.

  - source: docs
    path: README.md
    lines: '63-64'
    commit: 587886c
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/587886c/README.md#L63-L64
    observedAt: '2026-10-11'
    observedBy: claude
    session: 5703edca-a69f-4805-b0ab-5496e3248e3d
    note: README mentions docket as part of plugins and charting capabilities.

  - source: code
    path: src/lib/plugins/docket/plugin.test.ts
    lines: '10-11'
    symbol: ACME_FILE import
    commit: 587886c
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/587886c/src/lib/plugins/docket/plugin.test.ts#L10-L11
    observedAt: '2026-10-11'
    observedBy: claude
    session: 5703edca-a69f-4805-b0ab-5496e3248e3d
    note: Tests use docket-format JSON fixtures to verify plugin behavior.

provenance:
  capturedBy: claude
---

# Docket - local-first project knowledge

A system for capturing and organizing project knowledge as Markdown files 
under `.docket/`. Docket stores evidence-based descriptions of a project's 
services, datasources, systems, teams, environments, dependencies, constraints, 
decisions and compliance requirements, with metadata about where each piece of 
knowledge was observed and how confident it is.

Docket exposes a CLI (`docket` command) with subcommands including:

- `docket init`: set up a new docket in a project
- `docket graph --json`: output the project's resources and relationships as JSON
- `docket search`: find resources by keyword
- `docket remember`: capture new knowledge or update existing entries
- `docket open`: start an interactive viewer (runs on port 4380)

Wheelhouse's docket plugin uses `docket graph --json` to read the project graph 
and visualize it as an interactive chart, with optional support for reading a 
docket from a path other than the project clone (e.g., to use an example docket 
until a project adopts one).

See [chrisjowen/docket](https://github.com/chrisjowen/docket) for full documentation.
