---
id: feature.improve-plugin-integration
type: feature
title: Show improve proposals as cards and menu item in Wheelhouse
tags:
  - improve
  - plugin
  - wheelhouse
  - harness-improvements
attributes:
  status: in_progress
links:
  - rel: depends_on
    target: system.improve
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Feature integrates improve harness-improvement plugin into Wheelhouse UI
  - rel: depends_on
    target: library.plugin-system
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Improve is implemented as a Wheelhouse plugin using the plugin system
  - rel: implements
    target: api.wheelhouse-http
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Plugin exposes improve proposals through Wheelhouse HTTP API endpoints
evidence:
  - source: conversation
    session: a331d90f-4bb4-4617-8825-d67369258013
    observedAt: '2026-10-26'
    observedBy: claude
    note: >-
      User intent: "add some cards or indicators directly in wheelhouse if plugin enabled"
      with "more visually appealing" design. Branch fm/wh-improve-plugin adds improve plugin
      integration showing improvements as Harbour cards and a menu item instead of external link.
      Includes tabbed "On deck" rail interface. Changes in src/lib/plugins/improve/plugin.server.ts,
      src/lib/plugins/improve/plugin.test.ts, src/lib/server/plugins/services.ts, docs/guide.md.
      User approved: "LGTM".
provenance:
  capturedBy: claude
---

# Show improve proposals as cards and menu item in Wheelhouse

Integrates the improve harness-improvement plugin directly into Wheelhouse UI,
replacing the separate improve UI link with visual cards and a menu item. Shows
improve proposals, decisions, and review state as Harbour cards when the improve
plugin is enabled. Provides tabbed "On deck" rail interface with wider viewport.

When improve plugin is enabled, Wheelhouse displays:
- Menu item for improvements
- Improvement proposals as cards with visual indicators
- Integration with Harbour for fleet-level visibility
- Improved visual design for harness improvement information

The feature brings the captain's harness-improvement workflow into the main
Wheelhouse UI for better integration and visibility.

Branch: fm/wh-improve-plugin
