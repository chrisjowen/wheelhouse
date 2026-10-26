---
id: constraint.plugin-companion-service-launch
type: constraint
title: Plugins can detect and launch companion services
tags:
  - plugin-system
  - wheelhouse
  - docket
  - services
attributes:
  status: active
links:
  - rel: governs
    target: library.plugin-system
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Constraint applies to plugin system capability requirements
  - rel: affects
    target: system.improve
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Improve plugin may need to detect and launch docket or other companions
evidence:
  - source: conversation
    session: a331d90f-4bb4-4617-8825-d67369258013
    observedAt: '2026-10-26'
    observedBy: claude
    note: >-
      User requirement: "when adding plugins here we should have a way to detect if
      docket/inspect/whatever running and launch if not". This is a capability the plugin
      system should support for plugins that depend on companion services like docket viewers.
provenance:
  capturedBy: claude
---

# Plugins can detect and launch companion services

Plugin system should support capability for plugins to detect whether companion services
(like docket, inspect, or other tools) are running, and launch them if not. This allows
plugins that depend on external viewers or tools to ensure they are available.

## Constraint

When a plugin is enabled and needs a companion service:
- Plugin can detect whether that service is running (listening on expected port/endpoint)
- Plugin can launch the service if it is not already running
- Service launch respects isolation and permission boundaries

## Examples

- Improve plugin can detect if docket viewer is running and launch it
- Docket plugin can detect if docket is running and launch it
- Inspect plugin can detect if inspect tool is running and launch it

## Rationale

Companion services like docket and inspect have their own lifecycle and may not be running
when Wheelhouse starts. Rather than require the user to start them manually, plugins should
be able to detect and launch them on demand, improving the integrated experience.

## Status

Identified as requirement in improve plugin integration session (2026-10-26).
