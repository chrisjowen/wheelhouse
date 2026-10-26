---
id: constraint.console-fullscreen-unmount
type: constraint
title: Leave fullscreen when live consoles unmount while open

tags:
  - fullscreen
  - cleanup
  - browser-api
  - svelte

attributes:
  scope: ConsoleFullscreen component lifecycle

links:
  - rel: governs
    target: feature.live-console-fullscreen
    evidence:
      - source: code
        path: src/lib/components/wh/ConsoleFullscreen.svelte
        lines: 56-72
        symbol: fullscreenchange effect cleanup
        observedAt: '2026-10-26'
        observedBy: claude
        session: 33050c18-33e0-4134-9ab8-858a468925b2
        note: Cleanup function must call leaveFullscreen when component unmounts while console is open

  - rel: depends_on
    target: api.leaveFullscreen
    evidence:
      - source: code
        path: src/lib/client/fullscreen.svelte.ts
        lines: 39-43
        symbol: leaveFullscreen
        observedAt: '2026-10-26'
        observedBy: claude
        session: 33050c18-33e0-4134-9ab8-858a468925b2
        note: Function must be called in component cleanup to properly exit fullscreen

evidence:
  - source: code
    path: src/lib/components/wh/ConsoleFullscreen.svelte
    lines: 56-72
    symbol: fullscreenchange event handler with cleanup
    observedAt: '2026-10-26'
    observedBy: claude
    session: 33050c18-33e0-4134-9ab8-858a468925b2
    note: >
      The component listens to fullscreenchange events and maintains a held flag to track
      whether fullscreen was entered. When open becomes false or the component unmounts,
      the cleanup function (lines 68-71) must call leaveFullscreen(page) to ensure the
      browser exits fullscreen mode. Without this, fullscreen state leaks if the component
      unmounts while the console is open.

  - source: code
    path: src/lib/client/fullscreen.svelte.ts
    lines: 39-43
    symbol: leaveFullscreen function
    observedAt: '2026-10-26'
    observedBy: claude
    session: 33050c18-33e0-4134-9ab8-858a468925b2
    note: >
      Safely exits fullscreen by checking that the element still holds fullscreen before
      exiting (document.fullscreenElement !== el returns early). Unlocks keyboard if it
      was locked. Must be called when ConsoleFullscreen component unmounts.

  - source: code
    path: src/lib/components/wh/ConsoleFullscreen.svelte
    lines: 38-53
    symbol: open effect
    observedAt: '2026-10-26'
    observedBy: claude
    session: 33050c18-33e0-4134-9ab8-858a468925b2
    note: >
      When open becomes true, enters fullscreen. When it becomes false or component
      unmounts, must ensure leaveFullscreen is called to clean up browser fullscreen state.

provenance:
  capturedBy: claude
---

# Leave fullscreen when live consoles unmount while open

The ConsoleFullscreen component manages browser fullscreen mode for displaying a
live console. When the component unmounts or the console is closed while fullscreen
is active, it must properly exit fullscreen by calling `leaveFullscreen()` in the
effect cleanup function.

The constraint ensures that fullscreen state does not leak when:
- The component unmounts while `open` is true
- The user closes the console via the dialog close button
- The user presses Esc to exit fullscreen

Violation of this constraint leaves the browser in fullscreen mode, which is a
degraded user experience and violates browser user expectations. The cleanup
function on line 68-71 ensures `leaveFullscreen(document.documentElement)` is
called before the effect is torn down, preventing this leak.
