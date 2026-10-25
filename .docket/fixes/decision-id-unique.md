---
id: fix.decision-id-unique
type: decision
title: Decision view IDs made unique per question across rounds

tags:
  - wheelhouse
  - insights
  - decisions

links:
  - rel: resolves
    target: finding.decision-id-collision

evidence:
  - source: code
    path: src/lib/server/insights/service.ts
    lines: 400-410
    symbol: DecisionView ID generation
    commit: afc2e64
    observedAt: 2026-10-25
    observedBy: claude
    session: b11946b7-7f86-4760-b3bb-f2ac44261e96
    note: >
      DecisionView.id is now constructed as `${d.key}-${d.askedAt}` instead of
      just d.key. This makes the ID unique per question even when the same key
      is reopened in a second review round, fixing Svelte keyed-each duplicate-key
      errors and anchor routing collisions.

  - source: code
    path: src/lib/server/insights/service.test.ts
    commit: afc2e64
    observedAt: 2026-10-25
    observedBy: claude
    session: b11946b7-7f86-4760-b3bb-f2ac44261e96
    note: Unit test added for a key reopened across two review rounds, verifying both decisions appear with distinct IDs and anchors.

  - source: runtime
    observedAt: 2026-10-25
    observedBy: claude
    session: ac2a66e2-d79c-4230-8280-0e81660d875b
    note: "Live testing verified: /api/insights returns two distinct decision IDs (nm-01BBBB…-review-1792909191 and nm-01BBBB…-review-1792910091) for the same step reopened in two review rounds. /decisions#<round-1-id> anchor opens only the matching card without console errors. Svelte keyed-each and routing confirmed working correctly."

provenance:
  capturedBy: claude
---

# Decision view IDs made unique per question across rounds

When the no-mistakes review step raises ask-user findings in two separate rounds, the same ledger key (e.g., `nm-<run>-<step>`) can be written twice. This previously caused duplicate DecisionView.id values, which broke Svelte's keyed-each (throwing `each_key_duplicate` errors in dev) and made anchor-based routing (`#<id>`) ambiguous.

The fix includes the `askedAt` timestamp in the ID: `${key}-${askedAt}`. This ensures each question gets a unique identifier while still allowing users to link to specific decisions via anchors.
