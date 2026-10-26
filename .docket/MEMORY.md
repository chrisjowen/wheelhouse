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

provenance:
  capturedBy: claude
---

# Docket Evidence Index

Collected evidence from session transcripts and project observations.

- [Spec tab](resources/features/spec-tab.md) — Guided 9-section spec drafting and sending to Firstmate
- [Specs limited to 16 KiB](constraints/spec-16kib-message-limit.md) — Message size constraint for Firstmate
- [Bridge focused on one thread at a time](resources/features/bridge-focused.md) — Bridge UI focuses single thread, shows decisions inline
- [Captain sessions running in browser](resources/features/web-sessions.md) — WebSocket PTY sessions in browser instead of terminal
- [WebSocket close reason truncated by UTF-8 bytes](resources/decisions/terminal-close-reason-utf8.md) — RFC 6455 compliance fix for pty error messages
- [Wheelhouse sessions API](resources/apis/wheelhouse-sessions.md) — REST API for managing browser-based captain sessions
- [Wheelhouse docket Chart](resources/features/wheelhouse-docket-chart.md) — Read-only per-project system map visualization with nautical metaphor
- [Docket Chart UI trim](resources/decisions/docket-chart-ui-trim.md) — Remove display-only Waters and Hazards panels, enhance Chart full-width
- [Task page left-column layout](resources/features/task-page-left-layout.md) — Terminal, time, and overview together on task page left side
- [Harbour constrained thumbnails](resources/features/harbor-constrained-thumbnails.md) — Fixed-size screenshot thumbnails in fleet overview and task pages
- [Task layout left redesign project](projects/wh-task-layout-left.md) — Milestone moving terminal/time to task page left column, constraining thumbnails
- [Build insights on task page](resources/features/task-page-build-insights.md) — Shows Firstmate conversation, checks, and docs on task page
- [Build Insight Dashboard project](projects/wh-build-insight.md) — Milestone for bringing build-time info into Wheelhouse
- [Spec doc editor tab](resources/features/spec-doc-editor-tab.md) — Tab for drafting guided spec docs before sending to Firstmate
- [Harbor ADR/docs references](resources/features/harbor-docs-references.md) — Show architecture decisions and docs in fleet overview
- [.wheelhouse config editor](resources/features/wheelhouse-config-editor.md) — UI to edit .wheelhouse.yaml and define stages
- [Local k8s deploy stage](resources/features/local-deploy-k8s-stage.md) — Custom stage for local Kubernetes deployment of Casebook
- [Delegate to Firstmate decision](decisions/delegate-to-firstmate-build-phase.md) — Captain delegated design decisions to Firstmate during builds
