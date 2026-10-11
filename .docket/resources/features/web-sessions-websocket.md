---
id: feature.web-sessions-websocket
type: feature
title: Web-based interactive sessions via WebSocket

tags:
  - sessions
  - websocket
  - browser
  - terminal

attributes:
  status: in_progress

links:
  - rel: uses
    target: service.wheelhouse
    evidence:
      - source: code
        path: src/lib/server/sessions/terminal.ts
        lines: 1-50
        symbol: WebSocket terminal handler
        commit: 967deff
        observedAt: '2026-10-11'
        observedBy: claude
        session: 71583f35-026d-4285-99c2-39ccdd873ce1
        note: Terminal streams input/output via WebSocket instead of tmux only.

evidence:
  - source: conversation
    observedAt: '2026-10-12'
    observedBy: claude
    session: 71583f35-026d-4285-99c2-39ccdd873ce1
    note: Code review session for fm/wh-web-sessions branch implementing web-based sessions. User intent states sessions should stream to web and be editable there, not open a new terminal.

  - source: code
    path: src/lib/server/sessions/terminal.ts
    lines: 900-950
    symbol: WebSocket connection handler
    commit: 967deff
    observedAt: '2026-10-12'
    observedBy: claude
    session: 71583f35-026d-4285-99c2-39ccdd873ce1
    note: Terminal WebSocket endpoint protected by loopback Host check, Origin matching, session token, and recorded session ID.

  - source: code
    path: src/lib/server/sessions/sessions.ts
    lines: 1-50
    symbol: Session launch flow
    commit: 967deff
    observedAt: '2026-10-12'
    observedBy: claude
    session: 71583f35-026d-4285-99c2-39ccdd873ce1
    note: Sessions launch captain-owned tmux with -L wheelhouse socket and establish WebSocket for browser terminal access.

provenance:
  capturedBy: claude
---

# Web-based interactive sessions via WebSocket

Interactive Claude Code sessions now stream to the web browser via WebSocket
and allow live editing there, replacing the flow where a session launches and
the captain must open a new terminal. The feature establishes a secure
WebSocket connection between the browser and a dedicated tmux server (-L
wheelhouse) running the captain's session, protecting the channel with a
loopback Host check, Origin header validation, a session token, and a recorded
session ID.

The implementation covers the full terminal lifecycle: launching the tmux
session, establishing the WebSocket after authentication, streaming stdin/stdout
via the WebSocket, and handling session closure. The feature allows the captain
to edit, run commands, and interact with the Claude Code session directly in the
Wheelhouse web page.

**Branch**: fm/wh-web-sessions (base: 8f40081, target: 967deff)  
**Files changed**: 29 files across server sessions logic, WebSocket handlers, and web UI components  
**Status**: Under review; code review completed 2026-10-12

## Known issues from review

Two issues flagged during review:

1. **Trust pre-registration** (src/lib/server/sessions/trust.ts): The implementation pre-registers Claude Code trust settings in the user's global `.claude.json` config before launching the session. This goes beyond the feature intent (streaming to web) and creates a lost-update window for concurrent Claude Code processes. Recommendation: remove unless explicitly requested.

2. **PTY failure crash path** (src/lib/server/sessions/terminal.ts:936): When the pty fails to start, the close reason (error message) can exceed the WebSocket close frame limit of 123 UTF-8 bytes, causing an unhandled rejection that terminates the Node 22 server on non-ASCII home directories. Mitigation needed: truncate by bytes, not UTF-16 code units.
