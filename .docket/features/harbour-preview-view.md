---
name: harbour-preview-view
description: Feature to embed worker previews, show screenshots, and inline feedback in the Harbour task view
metadata:
  type: feature
  status: in_progress
---

## Overview
Wheelhouse Harbor (task view) can now display embedded previews when a worker reports a `note [at=<epoch>]: preview <url>` status line, with a pop-out option, inline feedback box, and worker screenshots displayed on cards.

## Components
- Embedded iframe preview with pop-out functionality
- Screenshots displayed on Harbour cards (from `data/<id>/screenshots/` or `data/<id>/`)
- Feedback box that sends typed review feedback to the worker
- Indication of why headless browser failed to take screenshots (intent requirement)

## Related Evidence
- Source: conversation, session 0669801c-833e-451b-979f-10346de9f101, October 25, 2026
- Branch: fm/wh-preview-review (commits fd92703 → f02952a)
- User intent explicitly requires:
  1. UI to see preview link as iframe in harbour view
  2. Ability to inline give feedback
  3. Screenshots displayed in harbour view
  4. Display of why headless browser failed (if no screenshots)

## Review Findings
- Screenshot thumbnails added (ShotStrip component, collector `shots`)
- Embedded preview with pop-out working
- Feedback mechanism implemented
- **Gap**: No code reads, derives, or renders a headless-browser failure reason
- **Gap**: Absorbed earlier ask for test step launching a sandbox (CLI window) not covered

---
tags: [harbour, preview, screenshots, feedback, incomplete-intent]
observedBy: claude
observedAt: 2026-10-25
session: 0669801c-833e-451b-979f-10346de9f101
