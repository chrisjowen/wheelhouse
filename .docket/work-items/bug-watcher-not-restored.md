---
id: work_item.bug-watcher-not-restored
type: work_item
title: ChatFeed fs watcher not restored on reconnect

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
        lines: 366
        symbol: stop, step
        observedAt: 2026-10-25
        observedBy: claude
        session: 14348614-0ff6-4f03-8831-897b7d50fb81
        note: stop() closes fs watcher; step() only creates one when file changes

evidence:
  - source: code
    path: src/lib/server/sessions/transcript.ts
    lines: 366
    symbol: stop, step
    observedAt: 2026-10-25
    observedBy: claude
    session: 14348614-0ff6-4f03-8831-897b7d50fb81
    note: Found during code review of commit d65ea71

---

# ChatFeed fs watcher not restored on reconnect

When the last viewer unsubscribes, `stop()` closes the fs watcher on the transcript file. However, `step()` (called when a new viewer reconnects or on file change) only creates a watcher when the followed file actually changes. If a page reconnects before new transcript data arrives, the watcher is not recreated, and subsequent data written to the file is not seen until the next natural change event occurs.

## Root cause

Watcher creation is conditional on file change detection, not on whether a watcher exists. Stopping and starting the stream can leave it without a watcher.

## Fix

In `step()`, check if a watcher exists before deciding whether to create one. Recreate if missing, regardless of file change.

## Severity

**warning** - Reconnecting pages may not see new transcript data until the next file change event.
