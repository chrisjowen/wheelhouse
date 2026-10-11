---
id: datasource.firstmate-home
type: datasource
title: Firstmate operational home
tags:
- firstmate
attributes:
  zone: private
links:
- rel: hosted_on
  target: system.firstmate
  evidence:
  - source: docs
    path: README.md
    lines: '10'
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L10
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: The operational home is the Firstmate directory with state/ and data/.
evidence:
- source: docs
  path: README.md
  lines: 88-100
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L88-L100
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: fleet-ledger.jsonl, contributions.json, report.md, screenshots, projects.md.
- source: code
  path: src/lib/server/runtime.ts
  lines: 80-82
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/runtime.ts#L80-L82
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
- source: code
  path: src/lib/server/firstmate/ledger.ts
  lines: 4-5
  symbol: LedgerReader
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/ledger.ts#L4-L5
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# Firstmate operational home

Firstmate's state directory tree, read directly (never written) by Wheelhouse:
`state/fleet-ledger.jsonl` (tailed, when the ledger is on), `data/projects.md`
(project descriptions), and per task `data/<id>/contributions.json`,
`data/<id>/report.md` and screenshots. Task diffs come from `git diff` in the
worktree Firstmate recorded. Located by `--home`, else `$FM_HOME`, else the
Firstmate checkout.
