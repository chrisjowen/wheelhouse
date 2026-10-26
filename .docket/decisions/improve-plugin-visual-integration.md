---
id: decision.improve-plugin-visual-integration
type: decision
title: Show improve in Wheelhouse as visual cards instead of separate UI link
tags:
  - improve
  - wheelhouse
  - ui-design
  - plugin-system
attributes:
  status: accepted
links:
  - rel: governs
    target: feature.improve-plugin-integration
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Decision constrains feature scope to visual integration via plugin system
  - rel: governs
    target: system.improve
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Decision shapes how improve's capabilities are surfaced in Wheelhouse
evidence:
  - source: conversation
    session: a331d90f-4bb4-4617-8825-d67369258013
    observedAt: '2026-10-26'
    observedBy: claude
    note: >-
      User intent: "I didn't see an integrated UI more a link to improve UI can we add some cards
      or indicators directly in wheelhouse if plugin enabled?" and "If the plugin installed can we have
      a new menu item with improvements and list them can click to open the improve UI".
      User feedback: "Bit too much like a 'all of text' make it more visually appealing"
      and "on deck on right chat is too much info perhaps tabs? Also can default to wider".
      User approved implementation: "LGTM".
provenance:
  capturedBy: claude
---

# Show improve in Wheelhouse as visual cards instead of separate UI link

Decided to integrate the improve harness-improvement plugin directly into Wheelhouse UI
as visual cards and indicators, rather than a separate link to the improve UI. This brings
the captain's harness-improvement workflow into the main Wheelhouse interface where improve
is enabled.

## Decision

Instead of:
- A link in Wheelhouse that opens improve in a separate window

Use:
- Harbour cards showing improve proposals with visual indicators
- Menu item for improvements section
- Integrated with Wheelhouse's plugin system
- Tabbed interface for "On deck" rail content (improvements, chat, context)
- Visually appealing design instead of raw text display

## Rationale

The user wanted improve visible and integrated in Wheelhouse rather than as a separate
concern. Visual design matters: "make it more visually appealing" than text-only display.
The tabbed "On deck" rail layout improves information density and readability by separating
concerns (improvements, chat, system context).

## Consequences

- Improve plugin becomes a first-class citizen in Wheelhouse's plugin system
- Requires improve to be enabled in .harness/improve.json for the home
- Improves captain visibility into harness improvement suggestions during work
- Plugin system needs to support dynamic launch of companion services (detect and launch docket/inspect)
