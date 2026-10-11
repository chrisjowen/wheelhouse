---
id: system.github
type: system
title: GitHub (via gh CLI)
tags:
- forge
attributes:
  category: source_control
  vendor: GitHub
evidence:
- source: code
  path: src/lib/server/firstmate/evidence.ts
  lines: 539-545
  symbol: readGhPr
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/evidence.ts#L539-L545
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: gh pr view --json number,state,isDraft,reviewDecision,statusCheckRollup.
- source: docs
  path: README.md
  lines: '12'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L12
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# GitHub (via gh CLI)

Read only as a fallback: when Firstmate has no cached PR observation
(`data/<id>/contributions.json`), Wheelhouse runs `gh pr view <url> --json ...`
with prompts disabled and a 10 s timeout. Optional - without `gh` the PR
evidence says it is unavailable. The `project-links` plugin also builds GitHub
links from repository metadata, without calling GitHub.
