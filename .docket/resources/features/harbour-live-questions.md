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
  status: shipped
links:
- rel: depends_on
  target: system.firstmate
  evidence:
  - source: code
    path: src/lib/server/insights/decisions.ts
    observedAt: '2026-10-26'
    observedBy: claude
    session: 0a1e9b14-2b3d-4336-b3d3-97c2ffc1a9c2
    note: Parses Firstmate's decision answers to display verdicts on questions
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
- source: code
  path: src/lib/server/insights/decisions.ts
  symbol: pairRounds
  observedAt: '2026-10-26'
  observedBy: claude
  session: 0a1e9b14-2b3d-4336-b3d3-97c2ffc1a9c2
  note: >-
    Code review finding (severity: warning): pairRounds and conversation()
    disagree about resolved lines without answers. When a non-answer resolve is
    followed by a re-raised needs-decision on the same key, pairRounds marks
    the round closed (line 76-80) while conversation() treats it as a new round
    (conversation.ts:157). This causes rounds to be skipped, answers split
    across multiple findings, and card display to show wrong question pairings.
    Example: needs-decision at t1, resolved without answer at t2, needs-decision
    at t3, resolved with answer at t4 results in missing t3 round, wrong t4
    answer pairing, and inconsistent display between card and conversation.
- source: code
  path: src/lib/server/insights/decisions.ts
  symbol: callsFor
  observedAt: '2026-10-26'
  observedBy: claude
  session: 0a1e9b14-2b3d-4336-b3d3-97c2ffc1a9c2
  note: >-
    Code review finding (severity: warning): When a finding id is not found in
    the answer text, fallback regex matches the id anywhere. Single-letter ids
    ('a', 'b') can match ordinary words (e.g., 'Add a guard' matches id 'a').
    This causes wrong calls to be applied. Example: "Decision for key K: FIX
    both. Add a guard" would mark finding 'a' with call 'guard.' (verdict
    'Decided' with reason 'Guard.') while 'b' correctly gets 'Fix it'.
- source: code
  path: docs/guide.md
  observedAt: '2026-10-26'
  observedBy: claude
  session: 0a1e9b14-2b3d-4336-b3d3-97c2ffc1a9c2
  note: >-
    Code review finding (severity: info): Guide documentation at line 51 lists
    decision filters as 'Fix it, Keep as is, Defer' but the code (decisions
    page and this feature) now includes a 'No change' verdict and filter.
    Documentation is out of date.
- source: infrastructure
  path: .git
  symbol: "cb5dfe1"
  observedAt: '2026-10-26'
  observedBy: claude
  session: f20dc8df-2d8c-4935-9cd7-be077291571c
  note: >-
    Commit implementing fixes for the three code review findings: makes
    pairRounds treat non-answer resolved lines the same as conversation() by
    closing the round (so later needs-decision opens a new round), drops the
    match-anywhere fallback in callsFor regex to require ids at call start or
    followed by colon/call word, and updates guide to list 'No change' filter.
- source: runtime
  endpoint: /api/fleet
  observedAt: '2026-10-26'
  observedBy: claude
  session: f139abab-a86c-45e1-9ab1-4d01130aa380
  note: >-
    Live testing verified /api/fleet endpoint returns build.rounds array with
    proper status transitions (waiting → answered) for review questions paired
    with Firstmate's verdicts.
- source: code
  path: tests/helpers/fake-firstmate.ts
  observedAt: '2026-10-26'
  observedBy: claude
  session: f139abab-a86c-45e1-9ab1-4d01130aa380
  note: >-
    Test helper for creating disposable Firstmate home with ledger, findings
    files and inbox messages. Used to test live updates and edge cases.
- source: code
  path: src/lib/buildlog.ts
  symbol: questionCounts/hintLine
  observedAt: '2026-10-26'
  observedBy: claude
  session: f139abab-a86c-45e1-9ab1-4d01130aa380
  note: >-
    Known issue (info level, older code not from this change): card hint counts
    questions closed without an answer as 'answered', causing misleading counts
    like '4 questions answered' when only 2 had actual answers.
- source: code
  path: docs/guide.md
  observedAt: '2026-10-26'
  observedBy: claude
  session: b68efdc2-ee1f-4f89-9db1-58169f4e8198
  note: >-
    Documentation updated to include 'No change' verdict in decision filters list.
    Verified in cb5dfe1 commit that guide.md correctly documents the No change
    filter alongside Fix it, Keep as is, and Defer options. Prettier and ESLint
    checks pass on updated documentation.
- source: conversation
  observedAt: '2026-10-26'
  observedBy: claude
  session: a16b86df-e2e6-4663-b5ef-b57a7cc06b67
  note: >-
    No-mistakes CI phase (PR #31, branch fm/wh-live-questions) confirms user intent:
    "show the review's questions for Firstmate on the card and in the conversation;
    I want to see exactly the live questions and how they are resolved." This session
    resolves merge conflicts and processes user-approved fixes for three code review
    findings (F1: pairRounds/conversation disagreement; F2: callsFor regex fallback;
    F3: guide.md filter documentation). Context: Harbour card displays "3 questions
    for Firstmate" but captain cannot see those questions from Harbour UI; Conversation
    tab (PR #28) already exists showing back-and-forth but is not visible from Harbour
    card view.
- source: conversation
  observedAt: '2026-10-26'
  observedBy: claude
  session: dc848005-c2b6-4000-b218-b904365b8e07
  note: >-
    Test validation phase for fm/wh-live-questions (target commit 175b9574). This
    phase derives test scenarios from user intent ("see the live questions and how
    they are resolved") and validates them live against the running product. Scenarios
    cover: (1) Harbour card displays question count from open decision rounds, (2)
    card shows review questions with their Firstmate verdicts and reasoning, (3)
    Conversation tab displays complete question/answer history, (4) question rounds
    correctly pair needs-decision entries with resolved answers even after close
    without answer followed by re-raise, (5) single-letter finding ids are not
    incorrectly matched in natural prose.

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
