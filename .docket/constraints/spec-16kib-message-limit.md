---
id: constraint.spec-16kib-message-limit
type: constraint
title: Specs limited to 16 KiB when sent to Firstmate
tags:
- specs
- messaging
links:
- rel: governs
  target: api.wheelhouse-http
  evidence:
  - source: api
    endpoint: POST /api/specs/:id/sent
    observedAt: '2026-10-26'
    observedBy: claude
    session: de0b6853-9625-4e33-b558-9e8a32a47046
    note: >-
      Returns 413 Payload Too Large if spec exceeds 16 KiB. Send button disabled
      with plain message 'This spec is too long to send as one message' when
      serialized draft exceeds limit.
evidence:
- source: conversation
  observedAt: '2026-10-26'
  observedBy: claude
  session: de0b6853-9625-4e33-b558-9e8a32a47046
  note: >-
    Spec live testing verified the 16 KiB boundary. At 17,188 bytes Send button
    stays disabled; at 14,548 bytes it enables. Firstmate inbox path enforces
    the limit: 17 KiB payload returns 413, 15 KiB returns 201. Sendable specs
    are delivered to Firstmate as a single message including pictures' file paths.
provenance:
  capturedBy: claude
---

# Specs limited to 16 KiB when sent to Firstmate

Spec drafts cannot exceed 16 KiB (16384 bytes) when sent to Firstmate. The
Send button in the Spec tab is disabled with a plain message if the serialized
spec exceeds this limit. A POST to `/api/specs/:id/sent` returns HTTP 413
(Payload Too Large) if the spec is too large. The constraint comes from
Firstmate's inbox message size limit when Firstmate is running as a separate
service (not co-located).
