---
id: document.docket-index
type: document
title: Docket Evidence Index

tags:
  - index
  - docket

attributes:
  kind: other

links: []

evidence:
  - source: conversation
    observedAt: '2026-10-11'
    observedBy: claude
    session: a03b19d8
    note: Docket index for session a03b19d8 evidence

  - source: conversation
    observedAt: '2026-10-25'
    observedBy: claude
    session: ac2a66e2-d79c-4230-8280-0e81660d875b
    note: Session captured evidence from comprehensive live testing of insights features, API endpoints, and three verified fixes for captain-wait timing, decision ID uniqueness, and draft handling for retired tasks.

provenance:
  capturedBy: claude
---

# Docket Evidence Index

Collected evidence from session transcripts and project observations.

- [Bridge focused on one thread at a time](resources/features/bridge-focused.md) — Bridge UI focuses single thread, shows decisions inline
- [Captain sessions running in browser](resources/features/web-sessions.md) — WebSocket PTY sessions in browser instead of terminal
- [Insights dashboard](resources/features/insights-dashboard.md) — Real-time analytics for work time, code-review decisions, and Claude API headroom
- [WebSocket close reason truncated by UTF-8 bytes](resources/decisions/terminal-close-reason-utf8.md) — RFC 6455 compliance fix for pty error messages
- [Wheelhouse sessions API](resources/apis/wheelhouse-sessions.md) — REST API for managing browser-based captain sessions
- [Wheelhouse docket Chart](resources/features/wheelhouse-docket-chart.md) — Read-only per-project system map visualization with nautical metaphor
- [Docket Chart UI trim](resources/decisions/docket-chart-ui-trim.md) — Remove display-only Waters and Hazards panels, enhance Chart full-width
- [Captain waits partitioned by phase](fixes/captain-waits-partitioned.md) — Time segments no longer double-count captain waits; spans merged for concurrent questions
- [Decision IDs unique per question](fixes/decision-id-unique.md) — DecisionView.id now includes askedAt timestamp to prevent collisions across review rounds
- [Draft handling for unknown tasks](fixes/unknown-task-draft.md) — Disagree/chat actions work for decisions on tasks no longer in fleet
