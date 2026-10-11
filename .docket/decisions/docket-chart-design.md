---
id: decision.docket-chart-design
type: decision
title: Docket Chart design for Wheelhouse system map

tags:
  - wheelhouse
  - docket
  - ui-design
  - system-visualization

evidence:
  - source: conversation
    session: 93ad43f0-a06e-4e65-a1db-14f26d5e45e3
    observedAt: 2026-10-11
    observedBy: claude
    note: Code review phase documented design intent and approved remedies for docket plugin integration

  - source: conversation
    session: 02bd65f4-fe81-427b-8d88-e4fbef88f153
    observedAt: 2026-10-11
    observedBy: claude
    note: Implementation review confirmed all design decisions; user approved F1 and F2 findings addressing docket binary setting, error handling, fixture opt-in, and CLI command display in Chart component

provenance:
  capturedBy: claude
---

# Docket Chart design decisions

## Approved design principles

The docket Chart visualization uses nautical metaphor for system topology:
- **Regions by owner**: Components grouped by team/organization ownership
- **Production as harbour**: Special visual treatment for production environments
- **Constraints as restricted waters**: Dashed/dotted lines for durable constraints
- **Vessels overlay**: In-flight tasks shown as vessels on the system map they touch
- **Evidence confidence styling**: Line styles indicate relationship confidence level

Clean, easy-to-understand presentation without internal technical jargon.

## Integration decisions

### Docket binary configuration
**Decision**: Docket binary is a plugin setting with PATH as default.

**Rationale**: Allows projects to use custom docket versions while defaulting to system PATH, 
fitting Wheelhouse's plugin architecture.

**Implementation**: Plugin loads docket from settings or PATH, displays error state if version
is too old (e.g., doesn't support `graph --json`).

### Fixture data approach
**Decision**: No runtime fallback to bundled fixtures; keep opt-in only.

**Rationale**: Fixture data (docket's examples/acme-platform) is used only when explicitly
configured. This avoids surprising behavior and keeps fixture-based exploration intentional.

**Implementation**: Smoke tests remain disabled for wheelhouse (no auto-enabling of Chart
without docket). Documentation clearly describes `settings.roots` + `projects` config required
to enable Chart for a project.

### Docket CLI error handling
**Decision**: Show "docket CLI too old for the Chart - update docket" when `graph --json` is unsupported.

**Rationale**: Clear, actionable feedback when docket version doesn't support required features.

**Implementation**: readGraph provider catches unsupported command and renders friendly error state
in Chart card rather than silent failure.

### Open in docket linkout
**Decision**: Show copyable `docket open --root <path>` command next to the "Open in docket" link.

**Rationale**: Users unfamiliar with docket CLI get direct, copy-paste-ready command instead of
relying on dead link when docket viewer isn't running or uses different port.

**Implementation**: Chart component displays both the link (for convenience if viewer is running)
and the CLI command (for reliability and discoverability).

## Out-of-scope decisions

### Not editable in Wheelhouse
Chart is intentionally read-only. Editing system maps happens in docket itself, not in Wheelhouse.
Reduces surface area and keeps editing in the domain-specific tool where all docket features are available.

### No Ask/Chat in Chart
Wheelhouse design keeps Chart and other plugins chat-free. Users open docket directly for discussion.
