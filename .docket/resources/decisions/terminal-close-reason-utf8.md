---
id: decision.terminal-close-reason-utf8
type: decision
title: WebSocket close reason truncated by UTF-8 bytes, not UTF-16
tags:
  - websocket
  - terminal
  - fix
links:
  - rel: affects
    target: feature.web-sessions
    evidence:
      - source: code
        path: src/lib/server/sessions/terminal.ts
        lines: 936
        symbol: Terminal.connect
        commit: 01099af
        observedAt: '2026-10-12'
        observedBy: claude
        session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
        note: WebSocket close reason now truncated by UTF-8 byte length (max 123) to comply with WebSocket RFC 6455 close frame limits
evidence:
  - source: code
    path: src/lib/server/sessions/terminal.ts
    lines: 936
    symbol: ws.close
    commit: 01099af
    urls:
      - https://github.com/chrisjowen/wheelhouse/blob/01099af/src/lib/server/sessions/terminal.ts#L936
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: >
      Fixed truncation logic from UTF-16 code units (120 chars) to UTF-8 bytes (max 123).
      Previous implementation ws.close(TERMINAL_CLOSE.failed, msg.slice(0, 120)) would throw
      RangeError if message exceeded 123 UTF-8 bytes, causing unhandled rejection in Node 22.
      Occurs when pty fails to start with paths containing non-ASCII characters.
  - source: conversation
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: >
      Finding identified in no-mistakes review of branch fm/wh-web-sessions
      (target commit 967deff, base 8f40081). Fix shipped in commit 01099af.
  - source: conversation
    observedAt: '2026-10-11'
    observedBy: claude
    session: 567905b6-f805-4148-8cdb-487135a4eb6d
    note: >
      Re-reviewed in no-mistakes review phase: validated that fix correctly implements UTF-8 byte
      truncation to prevent RangeError on ws.close when error message includes non-ASCII paths.
      Session also addressed commit of incorrect docket files and confirmed trust pre-registration
      decision per team (Firstmate-requested for sessions stuck on trust dialog).
provenance:
  capturedBy: claude
---

# WebSocket close reason truncated by UTF-8 bytes, not UTF-16

When a PTY fails to start, the terminal WebSocket handler sends a close frame
with an error reason. The RFC 6455 WebSocket spec limits close reason to 123
UTF-8 bytes. The initial implementation truncated by UTF-16 code units
(`msg.slice(0, 120)`), which could result in a message exceeding 123 UTF-8
bytes when the path contains non-ASCII characters (e.g. in a user's home
directory). This caused `ws.close()` to throw a RangeError inside the catch
block of an async `connect()` handler invoked without await, creating an
unhandled rejection that terminates the Node 22 server.

Fix: truncate close reason by UTF-8 byte length using a Buffer loop or
precomputed ASCII-only fallback. Added test coverage. This preserves the
trust pre-registration flow (Firstmate-requested feature).
