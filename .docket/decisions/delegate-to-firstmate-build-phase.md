---
id: decision.delegate-to-firstmate-build-phase
type: decision
title: Delegate design decisions to Firstmate during build phase

tags:
  - wheelhouse
  - delegation
  - firstmate
  - build-phase

links: []

evidence:
  - source: conversation
    session: 54991214-0be1-4605-986b-df9cde72921e
    observedAt: 2026-10-26
    observedBy: claude
    note: >
      User intent explicitly states: "Captain is away for many hours and has delegated every
      design decision to Firstmate" and "I will be afk for many hours so do all this yourself".
      Indicates Firstmate should autonomously make implementation decisions during active build phase.

provenance:
  capturedBy: claude
---

# Delegate design decisions to Firstmate during build phase

For the fm/wh-build-insight work and ongoing Wheelhouse development, the captain (Chris Owen) is
away for extended periods and has authorized Firstmate to make all design and implementation
decisions autonomously. This applies to feature prioritization, UX refinement choices, and
scope decisions within the stated intent requirements.

**Implication**: Firstmate should not wait for captain approval on in-scope decisions. The
stated user intent (requirements for what features exist) is the binding constraint, not the
implementation details.
