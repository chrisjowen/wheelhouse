---
id: api.wheelhouse-sessions
type: api
title: Wheelhouse sessions API
tags:
  - sessions
  - websocket
  - api
attributes:
  protocol: rest
links:
  - rel: exposes
    target: service.wheelhouse
    evidence:
      - source: code
        path: src/routes/api/sessions
        commit: '967deff'
        observedAt: '2026-10-12'
        observedBy: claude
        session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
        note: Sessions API endpoints for browser-based captain sessions
evidence:
  - source: code
    path: src/routes/api/sessions/+server.ts
    commit: '967deff'
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: Sessions list and creation endpoint
  - source: code
    path: src/routes/api/sessions/[id]/open/+server.ts
    commit: '967deff'
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: Session open endpoint returns WebSocket URL for terminal connection
  - source: code
    path: src/routes/api/sessions/[id]/preview/+server.ts
    commit: '967deff'
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: Session preview endpoint for session details before opening
  - source: conversation
    observedAt: '2026-10-11'
    observedBy: claude
    session: 567905b6-f805-4148-8cdb-487135a4eb6d
    note: >
      Re-reviewed in no-mistakes phase: validated that sessions API correctly implements
      browser-based terminal sessions via WebSocket instead of opening new terminal window.
provenance:
  capturedBy: claude
---

# Wheelhouse sessions API

REST API for managing captain sessions in the browser. Provides endpoints for
listing sessions, creating new sessions, opening sessions with WebSocket,
and previewing session details. WebSocket connections are authenticated via
session token and Origin header matching.
