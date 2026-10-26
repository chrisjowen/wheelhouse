---
name: spec-builder
description: Guided spec document editor for Wheelhouse, with sections, previews, and send to Firstmate
metadata:
  type: feature
---

## Spec Builder Feature

A new tab in Wheelhouse that guides users (the "captain") through writing a structured spec document before sending it to Firstmate. The spec is built section by section (via `SPEC_SECTIONS`), saved as the captain types (600ms debounce), and can include images.

**Status**: shipped (commit 61237f0)

**Core components**:
- `Spec` tab (`src/routes/spec/+page.svelte`) - editor with section-by-section guidance and live preview
- `SpecStore` (`src/lib/server/specs/store.ts`) - persistent storage in `<state>/specs/<id>.json`, images in `<state>/specs/<id>/`
- `SpecDraft` type (`src/lib/spec.ts`) - data model with id, title, summary, sections, images list, createdAt, updatedAt, sentAt
- Spec preview component (`src/lib/components/wh/spec/SpecPreview.svelte`) - renders both edit and "as sent" views

**Key capabilities**:
- Section fields editor (`src/lib/components/wh/spec/SectionFields.svelte`)
- Image upload/removal (max 10 MiB per image; types: png, jpeg, webp, gif)
- Live Markdown preview following sections
- Send to Firstmate via composer (message sent through existing chat)
- "As sent" view showing message with screenshots named as file references

**Data limits**:
- Spec message max: 64 KiB (Firstmate session limit)
- Inbox message max: 16 KiB (when Firstmate runs elsewhere; stricter limit enforced in spec-inbox-limit fix)
- Image names: `img-<12-hex-chars>.<ext>` format; validated with `IMAGE_NAME` regex

**Key fixes made in review round 1** (2026-10-26):
- `spec-onsent-overwrite`: Changed from overwriting draft to calling `markSent()` which sets only `sentAt`, preserving concurrent edits
- `spec-inbox-limit`: Gate on 16 KiB limit (smaller of inbox vs session limits) with plain-language warning
- `spec-save-image-race`: Added per-id serial queuing (promise-based mutex) to prevent race between save and addImage/removeImage

**API routes**:
- `GET /api/specs/<id>` - fetch a draft and its image directory path
- `PUT /api/specs/<id>` - save captain's edits (preserves id, createdAt, sentAt, images; merges caption changes)
- `DELETE /api/specs/<id>` - remove draft and its images
- `POST /api/specs/<id>/images` - upload an image to a draft
- `GET /api/specs/<id>/images/<name>` - fetch an image (validates against draft's images list)
- `DELETE /api/specs/<id>/images/<name>` - remove an image from a draft
- `PUT /api/specs/<id>/sent` - mark spec as sent (new; only sets sentAt)

**Evidence**:
- Source: code review transcript, 2026-10-26, session 038c6b3e
- Reviewed files: src/lib/spec.ts, src/lib/server/specs/store.ts, src/routes/spec/+page.svelte, src/routes/api/specs/+server.ts and subpaths
- Commit: 61237f0f8e75c8e832ccf77505c6f73d4d64c6ee (feat: apply the independent UX review)
