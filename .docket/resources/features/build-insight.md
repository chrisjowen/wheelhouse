---
id: feature.build-insight
type: feature
title: Build insight (Conversation, Checks, Docs tabs on task page)
tags:
- task-page
- conversation
- checks
- docs
attributes:
  status: shipped
links:
- rel: implements
  target: api.wheelhouse-http
  evidence:
  - source: api
    endpoint: GET /api/tasks/:id
    observedAt: '2026-10-26'
    observedBy: claude
    session: 82522b13-ced6-45a1-a861-6c3995780a80
    note: Returns build.conversation, build.checks, build.docs fields
- rel: tests
  target: test_suite.smoke
  evidence:
  - source: runtime
    endpoint: 127.0.0.1:4310
    observedAt: '2026-10-26'
    observedBy: claude
    session: 82522b13-ced6-45a1-a861-6c3995780a80
    note: Seven feature scenarios tested with Playwright; all passed.
evidence:
- source: runtime
  endpoint: 127.0.0.1:4310
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Conversation tab: displays worker's questions to Firstmate and answers from
    the steering inbox. Open questions show "Waiting on Firstmate".
- source: runtime
  endpoint: 127.0.0.1:4310
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Checks tab: shows test pass/fail summary (e.g., "1 of 15 tests failed") and
    the failing test's name and output from the validation run's test log.
- source: runtime
  endpoint: 127.0.0.1:4310
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Docs tab: lists architecture decision records and docs the session read or changed.
    Filters out noise from node_modules and other branches.
- source: runtime
  endpoint: 127.0.0.1:4310/harbour
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Harbour card shows "N docs referenced · M changed" hint. Clicking it navigates
    to the task's Docs tab (/tasks/<id>?tab=docs).
- source: runtime
  endpoint: GET /tasks/:id/doc?path=
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Doc reader validates all paths against the task's doc list and refuses paths
    outside it: ../secret.md, /etc/passwd, docs from other branches, node_modules
    content.
- source: runtime
  endpoint: GET /tasks/:id/doc?path=docs/large.md
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    Large docs (650 KB tested) read through git show when the worktree lacks them
    show their real heading and text truncated, not "not on this machine".
- source: runtime
  endpoint: 127.0.0.1:4310/tasks/:id?tab=docs
  observedAt: '2026-10-26'
  observedBy: claude
  session: 82522b13-ced6-45a1-a861-6c3995780a80
  note: >-
    On narrow (390px) screen: loading a tab does not scroll the page down (scrollY 0).
    Only the tab row scrolls horizontally (tablist scrollLeft 91 for docs tab).

- source: conversation
  session: d319d381-8e54-4070-84ad-cce74fe19f5c
  observedAt: '2026-10-26'
  observedBy: claude
  note: >-
    Test phase validated UI design improvements on fm/wh-text-surfaces branch. Docs tab
    now renders markdown as a proper document view on white/card background instead of
    on grid. Improves readability of referenced and changed documentation records.

provenance:
  capturedBy: claude
---

# Build insight (Conversation, Checks, Docs tabs on task page)

Three tabs on the task page showing the worker's interaction with Firstmate,
test results, and documentation touched in the session.

**Conversation** shows the worker's questions and Firstmate's answers from the
steering inbox; open questions show "Waiting on Firstmate".

**Checks** displays the test summary ("1 of 15 tests failed") and the failing
test's name and output from the validation run's log.

**Docs** lists architecture decision records and docs the session read or changed,
filtered to exclude node_modules and transcripts from other branches.

The Harbour card shows "N docs referenced · M changed" and clicking it navigates
to the task's Docs tab. The doc reader validates all paths against the task's
list and refuses external access (../secrets, /etc/passwd, docs from other
branches, node_modules). Large docs are read through `git show` when the worktree
lacks them, showing their real heading and truncated text.

On narrow screens, loading a tab leaves the page at the top; only the tab row
scrolls sideways.
