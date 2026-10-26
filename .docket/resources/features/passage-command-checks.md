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
