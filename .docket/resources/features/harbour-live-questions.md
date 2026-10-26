---
id: feature.harbour-live-questions
type: feature
title: Show review's questions for Firstmate on card and in conversation
tags:
- harbour
- firstmate
- decisions
- questions
- cards
attributes:
  status: in_progress
links:
- rel: implements
  target: api.wheelhouse-http
  evidence:
  - source: code
    path: src/lib/server/insights/decisions.ts
    symbol: pairRounds
    observedAt: '2026-10-26'
    observedBy: claude
    session: 0a1e9b14-2b3d-4336-b3d3-97c2ffc1a9c2
    note: Pairs decision entries with Firstmate's answers, handling question rounds
evidence:
- source: code
  path: src/lib/components/wh/TaskCard.svelte
  observedAt: '2026-10-26'
  observedBy: claude
  session: 0a1e9b14-2b3d-4336-b3d3-97c2ffc1a9c2
  note: >-
    Task cards display review questions and Firstmate's calls. Harbour cards show
    questions from open decision rounds.
- source: code
  path: src/lib/server/buildlog/conversation.ts
  symbol: conversation()
  observedAt: '2026-10-26'
  observedBy: claude
  session: 0a1e9b14-2b3d-4336-b3d3-97c2ffc1a9c2
  note: >-
    Builds conversation view with needs-decision and resolved entries representing
    questions and answers. Processes decision rounds for display.
- source: code
  path: src/lib/components/wh/QuestionList.svelte
  observedAt: '2026-10-26'
  observedBy: claude
  session: 0a1e9b14-2b3d-4336-b3d3-97c2ffc1a9c2
  note: Renders list of questions with their Firstmate verdicts and calls

provenance:
  capturedBy: claude
---

# Show review's questions for Firstmate on card and in conversation

Displays the worker's review questions and Firstmate's decisions on the Harbour
card and in the task conversation.

The Harbour card shows live questions from open decision rounds raised during the
worker's session. The Conversation tab displays the question history with
Firstmate's answer (verdict and reasoning) for each.

Questions are paired with Firstmate's calls through the decision parsing logic,
which reconstructs question rounds from needs-decision and resolved entries in
the build log.
