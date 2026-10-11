---
id: feature.bridge-focused
type: feature
title: Bridge focused on one thread at a time

tags:
- bridge
- ui
- focus

attributes:
  status: shipped

links:
- rel: uses
  target: service.wheelhouse
  evidence:
  - source: code
    path: src/routes/bridge/+page.svelte
    lines: 1-50
    symbol: Bridge page component
    commit: '6595c05'
    observedAt: '2026-10-11'
    observedBy: claude
    session: a03b19d8
    note: Bridge now focuses on a single thread, not showing all messages in one stream.

evidence:
- source: conversation
  observedAt: '2026-10-11'
  observedBy: claude
  session: a03b19d8
  note: User intent states Bridge should focus on current task, showing only what the captain is responding to, not all messages/replies in one stream.

- source: docs
  path: README.md
  lines: 41-50
  symbol: Bridge description
  commit: '6595c05'
  observedAt: '2026-10-11'
  observedBy: claude
  session: a03b19d8
  note: Bridge focuses on one thread at a time, shows decisions as questions.

provenance:
  capturedBy: claude
---

# Bridge focused on one thread at a time

The Bridge UI now focuses on viewing a single thread at a time rather than
showing all Wheelhouse messages, Firstmate replies, and reports in one long
stream. This addresses the user intent to reduce clutter and help the captain
see only what they are responding to.

When viewing a decision (a captain-held backlog task with a question and
options), the Bridge now shows the decision's question and options inline
rather than only as a card linking back to the overview.

The feature is validated by a smoke test that checks the Bridge serves the
focused task thread correctly.
