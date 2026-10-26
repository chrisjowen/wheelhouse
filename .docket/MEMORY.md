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
- [Live console fullscreen](resources/features/live-console-fullscreen.md) — Real fullscreen display for live console output with auto-updating
- [Leave fullscreen on console unmount](constraints/console-fullscreen-unmount.md) — Cleanup requirement to exit fullscreen when console component unmounts
- [WebSocket close reason truncated by UTF-8 bytes](resources/decisions/terminal-close-reason-utf8.md) — RFC 6455 compliance fix for pty error messages
- [Wheelhouse sessions API](resources/apis/wheelhouse-sessions.md) — REST API for managing browser-based captain sessions
- [Wheelhouse docket Chart](resources/features/wheelhouse-docket-chart.md) — Read-only per-project system map visualization with nautical metaphor
- [Command checks for passage stages](resources/features/passage-command-checks.md) — Shell commands to verify passage stage completion with isolated execution
- [Docket Chart UI trim](resources/decisions/docket-chart-ui-trim.md) — Remove display-only Waters and Hazards panels, enhance Chart full-width
- [Task page left-column layout](resources/features/task-page-left-layout.md) — Terminal, time, and overview together on task page left side
- [Harbour constrained thumbnails](resources/features/harbor-constrained-thumbnails.md) — Fixed-size screenshot thumbnails in fleet overview and task pages
- [Task layout left redesign project](projects/wh-task-layout-left.md) — Milestone moving terminal/time to task page left column, constraining thumbnails
- [Build insight](resources/features/build-insight.md) — Task page tabs showing worker conversation, test checks, and referenced docs
- [Harbour live questions](resources/features/harbour-live-questions.md) — Display worker review questions and Firstmate's decisions on card and in conversation
- [PR #31: Harbour Live Questions](resources/work-items/pr-31-harbour-live-questions.md) — Show Firstmate's review questions on Harbour card and in conversation
- [Command checks run in pinned worktrees](constraints/command-checks-pinned-worktree.md) — Command checks isolated to temporary worktrees at specific commits
- [Command checks use separate test and live checkouts](constraints/command-checks-separate-test-live.md) — Test runs and live task checks use separate worktrees to avoid interference
- [Command check consent language](constraints/command-checks-consent-language.md) — Consent UI must state consent covers command line, not runtime scripts
- [Test consent digest binding](constraints/test-consent-digest-binding.md) — Test panel "Also run commands" tied to displayed command digest
