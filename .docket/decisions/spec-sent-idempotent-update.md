---
name: spec-sent-idempotent-update
description: Use dedicated markSent endpoint to set only sentAt without overwriting newer edits
metadata:
  type: decision
---

## Spec Sent: Idempotent Update Decision

**Decided**: Use a dedicated endpoint `PUT /api/specs/<id>/sent` with a `markSent()` method that sets only the `sentAt` timestamp, avoiding overwrites of newer edits to concurrent drafts.

**Why**: The "Send to Firstmate" button holds the message in the composer's queue (`composerBus.outgoing`) until Firstmate is ready (Composer.svelte:209-219). If Firstmate is not up when Send is clicked:
1. Captain clicks Send and spec waits in composer queue
2. Captain navigates back to Spec tab and continues editing (edits autosave)
3. Captain goes back to `/` (chat), Firstmate comes online
4. Composer sends the queued message
5. **Old bug**: onSent() would PUT `{ ...snapshot, sentAt }` where snapshot was the state when Send was clicked, silently overwriting all intermediate edits

This can cause data loss: the captain's edits between Send and actual delivery are discarded.

**Solution**: Separate `sentAt` from content updates. Two paths:
- `PUT /api/specs/<id>` - save captain's edits; preserves `sentAt` from stored draft (never overwrites it)
- `PUT /api/specs/<id>/sent` - mark sent; reads current draft, writes only `sentAt` timestamp, leaves content untouched

The Spec tab's `send()` function now:
1. Saves the draft with `PUT /api/specs/<id>`
2. Hands message to composer
3. Composer calls `onSent` when message actually arrives, which calls `PUT /api/specs/<id>/sent` to update timestamp

**Implementation** (`src/lib/server/specs/store.ts`):
- `markSent(id: string, now = new Date()): Promise<SpecDraft | null>` wrapped in `this.serial()` for atomicity
- Reads current draft, updates only `sentAt`, writes back
- `src/routes/api/specs/[id]/sent/+server.ts` exports `PUT: RequestHandler` that calls `store.markSent()`

**Frontend** (`src/routes/spec/+page.svelte`):
- `onSent` callback now: `fetch(...'/sent', { method: 'PUT', ... })`  (changed from `PUT` with full snapshot)

**Scope**: Wheelhouse Spec tab only. No impact on other features or Firstmate.

**Atomicity**: Wrapped in SpecStore's per-id serial queue (see [[spec-read-modify-write-serialization]]), so a concurrent save cannot interleave with markSent.

**Evidence**:
- Source: code review, 2026-10-26, session 038c6b3e
- Commit: 61237f0f8e75c8e832ccf77505c6f73d4d64c6ee
- Finding: spec-onsent-overwrite (fixed in review round 1)
- Files: src/lib/server/specs/store.ts (markSent method), src/routes/api/specs/[id]/sent/+server.ts (endpoint), src/routes/spec/+page.svelte (onSent callback)
