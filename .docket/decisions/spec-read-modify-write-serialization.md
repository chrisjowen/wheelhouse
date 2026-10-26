---
name: spec-read-modify-write-serialization
description: Use per-id promise queue to serialize SpecStore read-modify-write operations
metadata:
  type: decision
---

## Spec Store Serialization Decision

**Decided**: Use a per-id promise-based queue (mutex pattern) to serialize read-modify-write operations in SpecStore, preventing race conditions when concurrent operations touch the same spec file and images.

**Why**: The page autosaves every 600ms (`src/routes/spec/+page.svelte:131`), and image uploads happen asynchronously. If `save()` reads the draft before `addImage()` writes it and then writes after, the newly uploaded image disappears from the draft's images list; while the file stays on disk, `readImage()` returns 404 and subsequent saves don't restore it. The opposite ordering (edit overwritten by old image addition) recovers on the next autosave, so only the image loss is permanent.

**Solution**: A `serial(id, fn)` method in SpecStore wraps operations like save, addImage, removeImage, remove in a per-id promise queue, ensuring they run one at a time for each spec. This is straightforward because:
- Each spec has a stable id (validated against `SPEC_ID` regex)
- Operations are async/await-friendly
- The queue is local to the SpecStore instance (single instance per state directory)

**Implementation** (`src/lib/server/specs/store.ts`):
- `private queues: Map<string, Promise<void>>` tracks pending operations per spec id
- `private serial<T>(id: string, fn: () => Promise<T>): Promise<T>` ensures `fn` runs after prior queued operations complete
- All read-modify-write methods call `this.serial(id, ...)`: `save()`, `addImage()`, `removeImage()`, `remove()`
- `get()` and `list()` remain unqueued (read-only, no corruption risk)

**Test coverage**: `src/lib/server/specs/store.test.ts` added test for concurrent save and addImage: spec keeps both the text edits and the image.

**Scope**: Wheelhouse-local; no impact on Firstmate or other services. Specs are stored only in Wheelhouse state, not shared.

**Evidence**:
- Source: code review, 2026-10-26, session 038c6b3e
- Commit: 61237f0f8e75c8e832ccf77505c6f73d4d64c6ee
- Finding: spec-save-image-race (fixed in review round 1)
- File: src/lib/server/specs/store.ts, lines ~50-65 (serial method implementation)
