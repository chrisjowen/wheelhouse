---
id: feature.web-sessions
type: feature
title: Captain sessions running in browser
tags:
  - sessions
  - browser
  - feature
attributes:
  status: shipped
links:
  - rel: uses
    target: api.wheelhouse-sessions
    evidence:
      - source: code
        path: src/lib/client/sessions.ts
        commit: 967deff
        observedAt: '2026-10-12'
        observedBy: claude
        session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
        note: Client-side session management calls sessions API
  - rel: part_of
    target: service.wheelhouse
    evidence:
      - source: code
        path: src/lib/server/sessions/terminal.ts
        lines: 936
        symbol: connect
        commit: 967deff
        observedAt: '2026-10-12'
        observedBy: claude
        session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
        note: Terminal WebSocket handler for captain sessions in browser
      - source: code
        path: src/lib/server/sessions/sessions.ts
        commit: 967deff
        observedAt: '2026-10-12'
        observedBy: claude
        session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
        note: Sessions module managing browser-based captain sessions
      - source: code
        path: src/routes/sessions
        commit: 967deff
        observedAt: '2026-10-12'
        observedBy: claude
        session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
        note: Browser routes for session pages and handlers
evidence:
  - source: code
    path: src/lib/server/sessions/terminal.ts
    lines: 900-950
    symbol: Terminal.connect
    commit: 967deff
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: Establishes WebSocket connection to PTY, handling terminal I/O, with fixes for close reason UTF-8 byte truncation to prevent server crashes on pty startup failure
  - source: code
    path: src/lib/server/sessions/trust.ts
    commit: 967deff
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: Trust dialog and session trust management with pre-registration flow
  - source: code
    path: src/routes/api/sessions/[id]/open/+server.ts
    commit: 967deff
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: API endpoint for opening terminal sessions and returning WebSocket URL
  - source: conversation
    observedAt: '2026-10-11'
    observedBy: claude
    session: 567905b6-f805-4148-8cdb-487135a4eb6d
    note: >
      Re-reviewed no-mistakes branch fm/wh-web-sessions to validate sessions stream to browser.
      Confirmed intent: sessions should stream to web and allow editing there, not open new
      terminal. Validated UTF-8 close reason fix and team decision to keep trust pre-registration
      (Firstmate-requested to prevent sessions stuck on trust dialog).
provenance:
  capturedBy: claude
---

# Captain sessions running in browser

Wheelhouse runs captain sessions (interactive terminal sessions for Firstmate
operations) directly in the browser via WebSocket connections to a PTY, rather
than opening a separate terminal window. Sessions have a trust dialog, session
preview, and live terminal I/O over WebSocket. The feature was shipped in
commit 967deff with fixes for WebSocket close-reason byte truncation to prevent
unhandled rejections when terminal startup fails.
