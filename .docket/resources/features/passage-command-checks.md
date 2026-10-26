---
id: feature.passage-command-checks
type: feature
title: Command checks for passage stages
tags:
- passages
- wheelhouse
- command-execution
- checks

links:
- rel: part_of
  target: project.wh-configurable-passages
  evidence:
  - source: conversation
    session: bbfea3ac-fdcf-492b-ac26-33e91a99f67b
    observedAt: '2026-10-26'
    observedBy: claude
    note: Command checks implementation as part of configurable passages

attributes:
  status: in_progress

evidence:
- source: conversation
  session: bbfea3ac-fdcf-492b-ac26-33e91a99f67b
  observedAt: '2026-10-26'
  observedBy: claude
  note: |
    fm/wh-passage-editor branch (commits b24e464→923c61f) implements command
    checks, a new check type for passage stages. Allows projects to define
    custom shell command checks that run to determine if a passage stage
    has been reached.
    
    Files: src/lib/server/passages/checks.ts (command execution),
    src/lib/components/wh/passage/TestPanel.svelte (test UI),
    src/lib/server/passages/testdata/local-deploy.wheelhouse.yaml (example).
    
    Example from testdata: local k8s deployment check for casebook project,
    configured via .wheelhouse.yaml, runs via pnpm deploy:local script.
    
    Key decisions: commands run in pinned worktrees at specific commits
    (constraint.command-checks-pinned-worktree), consent language updated
    to be transparent about scope (constraint.command-checks-consent-language).
- source: conversation
  session: 67b3fd14-06ad-45cd-95d3-e4318ec9b1f8
  observedAt: '2026-10-26'
  observedBy: claude
  note: |
    Code review of commits bd45744→943cc81 added separation of test vs live
    checkouts for command checks. Changes allow passage tests to use separate
    worktrees from live task checks.
    
    Implementation in src/lib/server/passages/checks.ts lines 59, 647, 649-650:
    CheckContext adds purpose?: 'test' | 'live', checkout names include
    purpose (default 'live'), checkoutsInUse set prevents concurrent runs
    of same check. Worktrees properly cleaned up afterward with finally block.
    
    Test coverage: checks separate checkouts for test vs live, refuses second
    run using same checkout, cleanup occurs correctly.
    
    Review verdict: no new defects, medium risk (runs consented commands on
    local machine, new code path). Files reviewed: checks.ts, checks.test.ts,
    service.ts, CheckForm.svelte, passage +page.svelte, local-deploy.yaml,
    docs/passages.md.
- source: conversation
  session: e064bb97-5455-413d-96c3-294df02036cb
  observedAt: '2026-10-26'
  observedBy: claude
  note: |
    Review phase (fm/wh-passage-editor branch, commits 1804faf→dd83a87) examined
    passage editor with command checks. Finding review-1 confirmed two outstanding
    issues: (a) command checks run in clone.dir without commit pinning via digest,
    allowing stale script execution; (b) consent language in docs/passages.md
    inaccurately claims "any change to one turns them off again" when only argv
    changes actually turn off consent. Both findings flagged as "ask-user" pending
    architect decision between pinned-worktree implementation vs honest
    consent-language clarification.

provenance:
  capturedBy: claude
---

# Command checks for passage stages

Command checks allow projects to run shell commands to verify passage stage
completion. Useful for custom integrations like local Kubernetes deployments,
status APIs, or project-specific build artifacts.

## Mechanism

- Defined as `run:` in `.wheelhouse.yaml` passage stage rules
- Command runs in a temporary, isolated worktree at the pinned commit
- Can be tested interactively in the passage editor's test panel
- Requires captain consent (both on the project configuration panel and when
  testing)

## Example: Local deployment

```yaml
# .wheelhouse.yaml
stages:
  - name: Deployed locally
    reached_when: 
      check: local.deploy
      expected: ok
    
checks:
  local.deploy:
    run: [pnpm, deploy:local]
    timeout: 300000  # 5 minutes
```

Runs `pnpm deploy:local` to verify a local Kubernetes deployment succeeded.

## Constraints

- Runs in a temporary worktree at the pinned commit, never in the clone's
  working tree (security, reproducibility): [[constraint.command-checks-pinned-worktree]]
- Consent language is transparent about what it covers: [[constraint.command-checks-consent-language]]
- Test panel consent tied to displayed command digest: [[constraint.test-consent-digest-binding]]
