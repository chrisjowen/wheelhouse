---
id: system.no-mistakes
type: system
title: no-mistakes
tags:
- validation
- ci
attributes:
  category: ci_cd
evidence:
- source: code
  path: src/lib/server/firstmate/evidence.ts
  lines: 9-21
  symbol: EvidenceReader
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/evidence.ts#L9-L21
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Reads no-mistakes evidence folders and ci.log for CI readiness.
- source: code
  path: src/lib/server/firstmate/evidence.ts
  lines: 119-127
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/evidence.ts#L119-L127
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Defaults ~/.no-mistakes/evidence and ~/.no-mistakes/logs.
- source: docs
  path: README.md
  lines: '99'
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L99
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
provenance:
  capturedBy: claude
---

# no-mistakes

The validation pipeline Firstmate's workers can ship through. Wheelhouse reads
its local files only: screenshots from `~/.no-mistakes/evidence/<run>/` and the
latest checks marker in `~/.no-mistakes/logs/<run>/ci.log`, to tell when a PR's
CI is green while the monitor is still running. No network or daemon calls are
made from Wheelhouse.
