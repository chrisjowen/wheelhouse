# Shared chat across coding tools

The goal is Wheelhouse's existing chat and composer for Claude Code, Codex,
OpenCode and Pi. A full terminal is an optional drawer for unsupported native
screens. Firstmate's source, hooks and supervision contracts stay unchanged.

## Design

Keep the interactive primary in its detached tmux session. Each tool's adapter
identifies that exact conversation and translates its structured records into
the current chat format. The existing feed, renderer, outbox, tool activity and
cards then serve every implemented adapter.

For Codex, add an invocation-scoped SessionStart recorder beside Firstmate's
project hooks. The receipt names the exact UUID, working directory and rollout.
Validate the receipt and the rollout metadata before reading. Never infer a
Codex conversation from the newest file or Firstmate's Claude-only lock UUID.

The generic JSONL feed owns byte offsets, incomplete-line handling, record
limits, deduplication and SSE. Codex owns validation and native event conversion.
Native item IDs remain stable across replay, and tool call IDs join starts and
results. Injected instructions and raw duplicated model records are not shown
as human messages.

Sending still uses Wheelhouse's serialized paste bridge. A positive native
composer check is required before sending. Supported numbered menus become
existing choice cards; a stale signature, changed command or unknown screen
blocks input. Approval choices remain the user's explicit action. Codex hook
trust is reviewed normally, with no trust bypass.

Two designs were compared. Preserving the native TUI won because replacing it
with a headless API session would change Firstmate's verified lifecycle.
OpenCode's authenticated same-TUI HTTP interface can be used without replacing
its primary. A separate Codex history helper is unnecessary for the verified
native rollout format.

## Pieces and acceptance gates

- [x] Inspect the current chat, input, launch and lifecycle contracts.
- [x] Compare native-session and headless/protocol designs.
- [x] Codex: exact binding, messages, tool activity, completion, composer,
      interruption, safe numbered choices and optional terminal drawer.
- [x] Verify Codex hook execution and a complete conversation in an isolated
      session, plus reload/restart recovery and unchanged Claude tests.
- [x] OpenCode: bind an exact session on the TUI's authenticated loopback server;
      translate messages/activity and pending permission/question requests.
- [x] Pi: bind its native session file and translate its active branch; verify
      input and extension behavior before advertising support.
- [x] Tool chooser: offer installed tools on first launch and preserve the
      selected tool for subsequent launches. Update setup's Claude-only step.
- [x] Remove obsolete terminal-only restrictions and document tested limits.

The first Codex piece targets the canonical events emitted by Codex 0.167.x.
Persisted message segments update as Codex writes them; this does not promise
individual token deltas. Unsupported dialogs continue to use the terminal
rather than guessing which key approves them.

## Verification

Each adapter needs tests for wrong session identity, wrong directory, malformed
records, duplicate events, tool start/result joins, interruption and completion.
Input tests must cover pending approval, unknown screens, changed choices and
unsent terminal text. A runnable build must show normal chat bubbles and activity
with the terminal closed. Firstmate remains read-only during implementation and
all test sessions use disposable directories and separate tmux sockets.

Sources: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Codex app server](https://learn.chatgpt.com/docs/app-server), installed Codex
0.167.2 help and local native event schemas, and installed OpenCode 1.19.5 OpenAPI.

## Verified behavior and remaining limits

The built Codex app was checked against a live isolated native session: the
project hook and Wheelhouse observer both ran, the receipt nonce matched, and
ordinary chat data contained the human prompt, final reply, command result and
completed turn after a Wheelhouse restart. A production smoke test repeats the
full feed and restart path with a deterministic native-event fixture.

OpenCode was launched through the real Wheelhouse launcher in a disposable home.
Its server rejected unauthenticated requests, selected the preallocated session,
returned an empty snapshot, and reconnected to the same ID after restart. Native
API tests cover partial reply replacement, queued admissions, stale choices,
explicit permission replies, malformed data and wrong-session rejection. Private
API credentials are stored in a mode-0600 launch record and passed through the
child environment, never process arguments.

Pi's observer was loaded by the native 1.5.2 TUI in a disposable home. Its receipt
and SDK-persisted v3 session produced the expected normalized active-branch
snapshot. Unit tests cover abandoned branches, tool results, completion,
interruption, malformed receipts and unknown screens. A fresh Pi session file
can be absent until the first assistant message, so the composer does not require
a persisted first-turn snapshot.

Live provider/model execution was exercised for Codex only. OpenCode and Pi need
operator verification with their configured providers. Browser-control tooling
was unavailable; mounted component tests verify that all three use the existing
chat/composer and optional drawer, and network tests verify the built feed.
Unsupported dialogs and multi-question forms still require the optional drawer.
Native command autocomplete and Claude usage/preview helpers are outside this
change. Tests use fixture homes; no real Firstmate checkout is modified.
