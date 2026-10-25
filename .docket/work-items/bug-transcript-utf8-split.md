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
  status: fixed

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

  - source: code
    path: src/lib/server/sessions/transcript.ts
    lines: 295-410
    symbol: ChatFeed with Buffer-based partial line handling
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Fix applied - partial field changed from string to Buffer; split is now done on byte 0x0a before decoding

  - source: code
    path: src/lib/server/sessions/transcript.test.ts
    lines: 222-240
    symbol: test for multi-byte UTF-8 character split across reads
    commit: a62e3a6
    observedAt: 2026-10-25
    observedBy: claude
    session: f99b5b2a-b526-41a2-b88e-6d34b02e1f47
    note: Test added covering UTF-8 character (anchor emoji) split across two reads

---

# ChatFeed UTF-8 split on chunk boundaries

`ChatFeed.read` converts each new chunk from the stream into a string before buffering incomplete lines. If a read happens while Claude Code is still writing UTF-8 sequences across chunk boundaries (e.g., a 3-byte UTF-8 character split across two chunks), the first chunk may contain an incomplete sequence that produces a replacement character or a decode error when converted to a string.

## Root cause

Chunks are converted to strings individually before incomplete-line buffering is applied. UTF-8 multi-byte sequences can be split across chunk boundaries.

## Fix

Buffer incomplete bytes across chunk boundaries before converting to string. Apply line buffering at the byte level, not the string level.

## Severity

**warning** - Rare but potential data corruption on fast streaming with certain UTF-8 characters.
