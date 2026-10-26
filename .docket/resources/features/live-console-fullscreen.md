---
id: feature.live-console-fullscreen
type: feature
title: Live console fullscreen viewing

tags:
  - live-console
  - fullscreen
  - browser-api
  - feature

attributes:
  status: shipped

links:
  - rel: uses
    target: api.enterFullscreen
    evidence:
      - source: code
        path: src/lib/components/wh/ConsoleFullscreen.svelte
        lines: 46-49
        symbol: enterFullscreen call
        observedAt: '2026-10-26'
        observedBy: claude
        session: 33050c18-33e0-4134-9ab8-858a468925b2
        note: Component enters fullscreen when open becomes true

  - rel: uses
    target: api.leaveFullscreen
    evidence:
      - source: code
        path: src/lib/components/wh/ConsoleFullscreen.svelte
        lines: 70, 128
        symbol: leaveFullscreen calls
        observedAt: '2026-10-26'
        observedBy: claude
        session: 33050c18-33e0-4134-9ab8-858a468925b2
        note: Component exits fullscreen on dialog close and in effect cleanup

  - rel: depends_on
    target: feature.web-sessions
    evidence:
      - source: code
        path: src/lib/components/wh/ConsoleFullscreen.svelte
        lines: 77-88
        symbol: pollTaskOutput call
        observedAt: '2026-10-26'
        observedBy: claude
        session: 33050c18-33e0-4134-9ab8-858a468925b2
        note: Polls live task output from captain sessions API

  - rel: governed_by
    target: constraint.console-fullscreen-unmount
    evidence:
      - source: code
        path: src/lib/components/wh/ConsoleFullscreen.svelte
        lines: 56-72
        symbol: fullscreenchange effect
        observedAt: '2026-10-26'
        observedBy: claude
        session: 33050c18-33e0-4134-9ab8-858a468925b2
        note: Must call leaveFullscreen in cleanup to prevent fullscreen leak on unmount

evidence:
  - source: code
    path: src/lib/components/wh/ConsoleFullscreen.svelte
    lines: 1-185
    symbol: ConsoleFullscreen component
    observedAt: '2026-10-26'
    observedBy: claude
    session: 33050c18-33e0-4134-9ab8-858a468925b2
    note: >
      Svelte component displaying a worker's live console in fullscreen. Enters browser
      fullscreen when opened, fits terminal to screen size, auto-updates every 1 second,
      and supports scrolling history. Uses dialog element in browser's top layer for
      rendering above fullscreen page content.

  - source: code
    path: src/lib/client/fullscreen.svelte.ts
    lines: 1-53
    symbol: fullscreen API module
    observedAt: '2026-10-26'
    observedBy: claude
    session: 33050c18-33e0-4134-9ab8-858a468925b2
    note: >
      Provides enterFullscreen and leaveFullscreen functions for managing browser
      fullscreen mode. Handles keyboard locking (Escape key behavior), checks fullscreen
      state before transitioning, and safely handles browser refusal of fullscreen requests.

  - source: code
    path: src/lib/console.ts
    lines: 1-50
    symbol: console utilities
    observedAt: '2026-10-26'
    observedBy: claude
    session: 33050c18-33e0-4134-9ab8-858a468925b2
    note: >
      Provides fitConsole, pollTaskOutput, and consoleColumns utilities used by
      ConsoleFullscreen to size and sample the terminal display.

provenance:
  capturedBy: claude
---

# Live console fullscreen viewing

Wheelhouse workers can open their live console output in real fullscreen mode,
allowing the terminal to fill the entire display rather than being constrained
to the browser window. The fullscreen console:

- Enters browser fullscreen (not just maximized window) when opened via `enterFullscreen()`
- Renders as a `<dialog>` element in the browser's top layer, above the fullscreen page
- Automatically polls the worker's console output every 1 second, updating incrementally
- Fits the terminal font size to the available screen width, reflowing when screen resizes
- Supports scrolling history while auto-following the newest output
- Exits fullscreen when the user presses Esc, clicks the close button, or the component unmounts
- Shows read-only terminal output with a header displaying task title, timestamp, and controls

The component ensures fullscreen state is properly cleaned up on unmount,
preventing the browser from remaining in fullscreen if the component is removed
while open.
