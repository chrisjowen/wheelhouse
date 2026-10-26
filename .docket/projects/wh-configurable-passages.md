---
id: project.wh-configurable-passages
type: project
title: Configurable passage stages (Wheelhouse)

tags:
  - wheelhouse
  - passages
  - configurable
  - extensibility

attributes:
  kind: project
  status: active

links: []

evidence:
  - source: conversation
    session: 2ac54de0-7761-400a-807e-056a20043914
    observedAt: 2026-10-11
    observedBy: claude
    note: CI phase session to resolve merge conflicts on PR #9 (chrisjowen/wheelhouse:fm/wh-passages). Feature brings configurable passage stages with typed checks as defined in the approved extensibility design.

provenance:
  capturedBy: claude
---

# Configurable passage stages (Wheelhouse)

The first feature in Wheelhouse's extensibility roadmap: making passage stages
configurable so projects can define custom stages like Deployed and Released
beyond the built-in ship and scout passages.

## Design

Passages are expressed as data in two parts:
- **Checks**: typed, built-in probes that gather observations (github.deployment,
  github.workflow, github.release, npm.published, http GET/HEAD, git.contains,
  status.note)
- **Stages**: rules over check observations defining when stages are reached and
  what evidence they show

Each project's passage is the built-in ship or scout passage plus a small YAML
file (`.wheelhouse.yaml`) that adds or overrides stages. The built-in passages
are themselves expressible in the same format, so every project works with no
configuration.

## Configuration

**Location and scope**: `.wheelhouse.yaml` at the project's root, read only from
the project's default branch of Firstmate's project clone, never from task
branches or worktrees (prevents crewmates from marking their own passages
Deployed). Layered over built-in passages and under captain-owned Wheelhouse
config overrides (e.g. `~/.config/wheelhouse/`).

**Validation**: Project files require explicit captain approval on a project
panel that lists every check that will run. Wheelhouse records the file's digest
and re-asks if the file changes. Invalid files show a warning and fall back to
built-in passages without blanking the dashboard.

**Schema**: Small and type-safe. Conditions are references (Firstmate facts or
`check.outcome`) combined with `all/any/not` plus mode and yolo predicates; no
expression language, no templating. Unknown types, fields and references are
errors. Values such as merge commits are validated and placed by Wheelhouse code,
never substituted into user strings.

## Stage semantics

- `reached_when`: high-water mark (furthest step whose condition holds is
  current; earlier steps count as done even after task cleanup); terminal
  outcomes are cached
- `skip_when`: mode/yolo-aware conditional skipping
- `failed_when`: makes a later failed step current and shown as failed without
  creating a "Needs you" item
- `give_up_after`: stops polling and reports give-up
- A check that errors is unknown and never silently treated as not reached
- `evidence`: lists what each step shows
- `primary_link`: makes a check's URL the card's primary action
- `headline.live`: names the step that counts toward the watch report's "N live"
  (returns only where declared)

## Polling

Checks run on their interval (minimum 30s) in a background scheduler, only while
the task could still advance, and terminal outcomes are cached. Checks never run
on the fleet's hot path.

## Status

PR #9 on chrisjowen/wheelhouse (branch fm/wh-passages) resolves merge conflicts
and advances toward merge. Implementation covers the core check types and stage
rules.

Command checks are being added in the fm/wh-passage-editor branch (commits
b24e464→923c61f), with architectural decisions documented in review phase:
- Command checks run in temporary worktrees at pinned commits for isolation
  and security
- Consent language updated to be transparent about what consent covers
- Test panel consent tied to displayed command digest to prevent race conditions

Plugins/slots and docket integration remain separate future PRs.
