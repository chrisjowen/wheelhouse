---
id: constraint.bounded-argv-script-execution
type: constraint
title: External commands run as bounded argument arrays, never via a shell
tags:
- security
- firstmate
links:
- rel: governs
  target: library.firstmate-adapter
  evidence:
  - source: code
    path: src/lib/server/firstmate/exec.ts
    lines: 67-70
    symbol: runBounded
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/exec.ts#L67-L70
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: docs
  path: README.md
  lines: '86'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L86
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Argument arrays, bounded output and timeouts, stdin closed except the note body (max 16 KiB).
- source: docs
  path: docs/spec.md
  lines: '63'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/docs/spec.md#L63
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Execute scripts using argument arrays and bounded stdin, never interpolated shell commands.
provenance:
  capturedBy: claude
---

# External commands run as bounded argument arrays, never via a shell

Firstmate scripts, `git` and `gh` run through `runBounded`
(`src/lib/server/firstmate/exec.ts`): argument arrays, timeouts, output caps,
their own process group, and closed stdin except the message body written to
`fm-inbox.sh note` (at most 16 KiB). Plugin `exec` goes through the same runner
with a minimal environment.
