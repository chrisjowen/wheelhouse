---
id: feature.insights-dashboard
type: feature
title: Insights dashboard

tags:
  - wheelhouse
  - firstmate
  - analytics
  - real-time

attributes:
  status: shipped

links:
  - rel: depends_on
    target: system.firstmate
    evidence:
      - source: code
        path: src/lib/server/insights/service.ts
        lines: 1-50
        symbol: InsightsService
        observedAt: 2026-10-25
        observedBy: claude
        session: 55d79c62-b8a0-4cb6-86c8-5772945b9b13
        note: InsightsService reads from Firstmate's ledger to reconstruct task timings and review decisions.

  - rel: depends_on
    target: system.no-mistakes
    evidence:
      - source: code
        path: src/lib/server/insights/service.ts
        lines: 50-100
        symbol: readRun
        observedAt: 2026-10-25
        observedBy: claude
        session: 55d79c62-b8a0-4cb6-86c8-5772945b9b13
        note: Reads step timings from ~/.no-mistakes/logs/<run>/<step>.log files to measure build, review, CI and captain phase durations.

evidence:
  - source: code
    path: src/lib/insights.ts
    lines: 1-122
    symbol: insights helpers
    observedAt: 2026-10-25
    observedBy: claude
    session: 55d79c62-b8a0-4cb6-86c8-5772945b9b13
    note: Public display helpers for time segments (build, review, deciding, ci, captain), confidence levels, and duration formatting.

  - source: code
    path: src/lib/server/insights/service.ts
    lines: 1-523
    symbol: InsightsService
    observedAt: 2026-10-25
    observedBy: claude
    session: 55d79c62-b8a0-4cb6-86c8-5772945b9b13
    note: Main orchestration service that reads ledger, timing logs, findings files, transcript metadata, and quota data; provides time(), decisions(), headroom() and eta() views.

  - source: code
    path: src/lib/server/insights/timing.ts
    observedAt: 2026-10-25
    observedBy: claude
    session: 55d79c62-b8a0-4cb6-86c8-5772945b9b13
    note: Implements work-time estimation based on historical data for similar tasks, and time-split calculation across validation phases.

  - source: code
    path: src/lib/server/insights/decisions.ts
    observedAt: 2026-10-25
    observedBy: claude
    session: 55d79c62-b8a0-4cb6-86c8-5772945b9b13
    note: Parses code-review findings, reconstructs Firstmate's decisions from ledger and message inbox, and pairs questions with verdicts.

  - source: code
    path: src/lib/server/insights/usage.ts
    observedAt: 2026-10-25
    observedBy: claude
    session: 55d79c62-b8a0-4cb6-86c8-5772945b9b13
    note: Analyzes Claude Code transcript metadata to compute token usage per task and per time window; tracks quota window runways.

provenance:
  capturedBy: claude

---

# Insights dashboard

The insights feature provides read-only analytics over Firstmate's validation records and Claude Code transcript metadata. It displays three main dashboards:

**Time view**: Where time went in the no-mistakes validation pipeline, broken down by phase (Building, Automated review and fixes, Firstmate deciding, CI checks, Waiting on captain). Shows cumulative time per task and per project, with work-time estimates based on historical data from similar tasks in the same scope (project or global).

**Decisions view**: Code-review questions Firstmate raised and answered on the captain's behalf during automated review. Shows the findings raised, the verdict Firstmate gave (approve, request-changes, comment), and the reasoning it provided. Linked to the task and pull request that received the decision.

**Headroom view**: Claude API token usage and quota windows. Shows the 5-hour and rolling-week usage per user or task, remaining tokens in each quota window, and a runway projection for windows at risk of exhaustion.

## Architecture

The `InsightsService` orchestrates four modules:

- **timing.ts**: Estimates work time to captain's review (and beyond) using historical median times for similar tasks. Splits time across phases using step-log timestamps from no-mistakes runs.
- **decisions.ts**: Reconstructs Firstmate's review decisions by reading findings files, the Firstmate ledger (which decision was made), and the message inbox for live tasks (to find Firstmate's full answer text).
- **usage.ts**: Aggregates token counts from Claude Code transcript metadata, associates tokens with tasks and users, computes usage per time window, and projects quota window runways from historical trends.
- **service.ts**: Main read-only API; coordinates lazy-loading and caching of ledger, logs, findings, and quota data; exposes time(), decisions(), headroom(), eta(), and split() views.

The service never writes. It reads from the no-mistakes ledger, step logs, findings files (data/<task>/.no-mistakes/findings/), live task message inboxes (state/<task>.inbox/handled/), Claude Code transcripts, and `quota-axi --provider claude --json`.
