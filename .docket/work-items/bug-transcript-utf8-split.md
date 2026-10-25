---
id: work_item.bug-transcript-utf8-split
type: work_item
title: ChatFeed UTF-8 split on incomplete chunks

tags:
  - firstmate
  - transcript
  - bug

attributes:
  kind: bug
  status: open

links:
  - rel: uses
    target: datasource.firstmate-home
    evidence:
      - source: code
        path: src/lib/server/sessions/transcript.ts
        lines: 398
        symbol: ChatFeed.read
        observedAt: 2026-10-25
        observedBy: claude
        session: 14348614-0ff6-4f03-8831-897b7d50fb81
        note: ChatFeed converts chunks to strings before line-buffering

evidence:
  - source: code
    path: src/lib/server/sessions/transcript.ts
    lines: 398
    symbol: ChatFeed.read
    observedAt: 2026-10-25
    observedBy: claude
    session: 14348614-0ff6-4f03-8831-897b7d50fb81
    note: Found during code review of commit d65ea71

---

# ChatFeed UTF-8 split on chunk boundaries

`ChatFeed.read` converts each new chunk from the stream into a string before buffering incomplete lines. If a read happens while Claude Code is still writing UTF-8 sequences across chunk boundaries (e.g., a 3-byte UTF-8 character split across two chunks), the first chunk may contain an incomplete sequence that produces a replacement character or a decode error when converted to a string.

## Root cause

Chunks are converted to strings individually before incomplete-line buffering is applied. UTF-8 multi-byte sequences can be split across chunk boundaries.

## Fix

Buffer incomplete bytes across chunk boundaries before converting to string. Apply line buffering at the byte level, not the string level.

## Severity

**warning** - Rare but potential data corruption on fast streaming with certain UTF-8 characters.
