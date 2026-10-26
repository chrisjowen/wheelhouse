---
id: system.improve
type: system
title: Improve (harness-improvement plugin)
tags:
  - improve
  - harness-plugin
  - captain-only
attributes:
  category: other
  vendor: chrisjowen
links:
  - rel: depends_on
    target: system.firstmate
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Improve has a Firstmate adapter that imports sanitized evidence from the Firstmate home; enabled per home in .harness/improve.json.
  - rel: provides
    target: feature.improve-harness-proposals
    evidence:
      - source: conversation
        session: a331d90f-4bb4-4617-8825-d67369258013
        observedAt: '2026-10-26'
        observedBy: claude
        note: Improve generates harness proposals classified as captain-private or shared Firstmate code, routed as captain-held decisions.
evidence:
  - source: docs
    path: docs/improve.md
    observedAt: '2026-10-26'
    observedBy: claude
    session: a331d90f-4bb4-4617-8825-d67369258013
    note: Mentioned in user intent context as the captain's Claude Code harness-improvement plugin with Firstmate adapter merged.
  - source: conversation
    session: a331d90f-4bb4-4617-8825-d67369258013
    observedAt: '2026-10-26'
    observedBy: claude
    note: >-
      Repository at github.com/chrisjowen/improve, cloned at projects/improve in Firstmate home.
      Firstmate adapter merged (PR #18). Enabled per home in .harness/improve.json. Imports sanitized
      evidence from Firstmate home (counts of tasks, review questions, decisions, preferences, learnings,
      repeated patterns). Classifies proposals as captain-private or shared Firstmate code. Routes proposals
      as captain-held decisions. Has optional periodic review ('due'). Its own review UI is being redesigned
      (fm/improve-runner-ui). Now integrated into Wheelhouse plugin system for visibility within Wheelhouse.

provenance:
  capturedBy: claude
---

# Improve (harness-improvement plugin)

The captain's Claude Code harness-improvement plugin that generates suggestions
for improving the Wheelhouse harness and Firstmate integration. It reads sanitized
evidence from the Firstmate home (counts, patterns, learnings) and generates proposals
classified as captain-held decisions or shared Firstmate code.

Improve is configured per home in `.harness/improve.json` when the Firstmate adapter
is enabled. It has an optional periodic review with a due date. Its review UI is
separate and being redesigned. It is now integrated into Wheelhouse as a plugin
to make improvements visible directly in the UI rather than through a separate link.

Repository: https://github.com/chrisjowen/improve
