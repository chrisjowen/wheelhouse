---
id: feature.resizable-rail
type: feature
title: ResizableRail - persistent right-side panel with keyboard/pointer resize

tags:
  - wheelhouse
  - ui
  - layout
  - persistence

attributes:
  status: shipped

links: []

evidence:
  - source: code
    path: src/lib/components/wh/ResizableRail.svelte
    lines: 1-100
    symbol: ResizableRail
    observedAt: 2026-10-25
    observedBy: claude
    session: fae33653-b5d4-4629-b892-6ddd48c8a059
    note: >-
      Svelte component providing a resizable right-side panel docked on full-height view.
      Supports drag resize on edge, arrow-key resize, double-click to reset to default width.
      Width persisted to localStorage via storageKey. Clamped to [280px, 720px] and max 60% viewport.

  - source: conversation
    session: fae33653-b5d4-4629-b892-6ddd48c8a059
    observedAt: 2026-10-25
    observedBy: claude
    note: >-
      Verified width persistence works: panel resizable with keyboard, handles double-click reset,
      width remembered across page navigations. Unit tests and smoke tests passed.

provenance:
  capturedBy: claude
---

# ResizableRail

A Svelte component providing a persistent, resizable right-side panel for full-window views.
Used by the Chart's inspector panel and the home page rail.

## Features

- **Drag resize**: Pointer drag on the left edge resizes the panel
- **Keyboard resize**: Arrow keys (← / →) adjust width on focus
- **Width persistence**: Width saved to localStorage under `storageKey`
- **Double-click reset**: Double-click on resize handle returns to default width
- **Width constraints**: Clamped to [280px, 720px] and max 60% of viewport width
- **Accessibility**: ARIA label for the resize handle provided via `label` prop

## Props

- `storageKey` (required): localStorage key for persisting width
- `label` (required): Accessible description of the resize handle
- `defaultWidth` (optional, default 368): Initial and reset width in pixels
- `class` (optional): Additional CSS class for the panel container
- `children` (required): Svelte snippet for panel content

## Storage

Width is stored via `localStorage.setItem(storageKey, width)` on every resize and saved
when drag or keyboard resize completes. If storage is unavailable, width persists
only for the current page view.

## Used by

- Docket Chart inspector: `storageKey: 'wh:chart:inspector:width'`
- Home page rail: `storageKey: 'wh:home:rail:width'`
