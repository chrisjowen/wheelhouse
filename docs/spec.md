# Wheelhouse MVP

A companion to Firstmate providing **communication with Firstmate and visibility into its crew**. Nautical-themed UI.

## Stack

- **SvelteKit + TypeScript:** UI and server API.
- **shadcn-svelte:** UI components.
- **Commander:** CLI.
- **Node.js:** local runner and Firstmate script integration.

## Launch

Run inside a Firstmate checkout:

```bash
wheelhouse
```

Or provide paths:

```bash
wheelhouse --firstmate ~/firstmate --home ~/crew --port 4310
```

The CLI resolves the Firstmate code directory and operational home, validates supported integration scripts, starts the server, and opens the browser.

**MVP attaches to an existing Firstmate session.** Closing Wheelhouse leaves Firstmate and its crew running.

## Features

**Firstmate communication**

- View messages submitted through Wheelhouse and recorded Firstmate replies.
- Send messages and instructions to Firstmate.
- Show delivery and acknowledgement states separately.
- Use stable request IDs to prevent duplicate submissions.
- Show supervisor readiness.
- Display existing supervisor conversation only where a verified transcript adapter supports it.

**Crew visibility**

- List tasks and their assigned workers.
- Show current state, assignment, harness, and latest available progress.
- Inspect bounded, read-only terminal output.
- Show blockers and open decisions where available.
- Display observation timestamps and stale/unavailable states.

**All user messages go to Firstmate.** No direct worker messaging or lifecycle controls.

**Captain's sessions**

- "New session" opens a fresh Claude Code session in the captain's terminal, for a chosen project or a blank idea, with an optional opening prompt.
- Sessions run in a scratch directory under Wheelhouse's state directory, never in the Firstmate home or a project checkout; a project's checkout is attached for reading, and the session is instructed not to edit it (an instruction, not enforced).
- Wheelhouse lists those sessions (alive or ended, re-attach, bounded read-only preview) and can hand one to Firstmate as a Bridge message (`Re: session <id>`, with the scratch path).
- These are the captain's own sessions: Firstmate's crew stays uncontrollable from Wheelhouse.
- Sessions run on Wheelhouse's own tmux server (a dedicated, configurable `tmux -L` socket), never the server Firstmate and its crew use.

## Firstmate adapter

Wrap existing scripts behind a TypeScript interface:

| Capability | Integration |
|---|---|
| Fleet and current task state | `fm-fleet-snapshot.sh --json` |
| Send supervisor message | `fm-inbox.sh note --request-id … --json` |
| Read acknowledgements/replies | `fm-inbox.sh receipts` |
| Supervisor readiness | `fm-inbox.sh ready` |
| Worker terminal output | `fm-peek.sh` |

Verify compatibility with the installed Firstmate version. Execute scripts using argument arrays and bounded stdin, never interpolated shell commands.

Do not treat the last status-log event as current state or terminal samples as a complete transcript.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Firstmate compatibility and supervisor readiness |
| `GET /api/fleet` | Cached tasks and worker states |
| `GET /api/firstmate/messages` | Wheelhouse submissions and available replies |
| `POST /api/firstmate/messages` | Send message with idempotency key |
| `GET /api/tasks/:id/output` | Bounded worker output |
| `GET /api/events` | SSE updates |
| `GET /api/sessions` | Captain's sessions |
| `POST /api/sessions` | Start a captain's session |
| `POST /api/sessions/:id/open` | Re-attach the captain's terminal |
| `GET /api/sessions/:id/preview` | Bounded, read-only session output |

A task-context message includes the task ID but still targets Firstmate.

## Runtime

- One shared collector polls fleet state every approximately five seconds.
- Collect selected worker output while its inspector is open.
- Push updates through SSE.
- Persist message request IDs and receipts locally; cache fleet/output in memory.
- Reconcile uncertain delivery using the original request ID.
- Bind to loopback by default and protect mutating endpoints with origin validation and a local session token.

## UI

One main workspace:

- Firstmate conversation and composer.
- Task/crew list with observed states.
- Read-only output inspector for the selected worker.
- A Sessions page for the captain's own Claude Code sessions.

Use nautical branding and terminology without prescribing detailed designs.

## Structure

```text
src/
  routes/                 UI and API
  lib/components/         UI components
  lib/server/firstmate/   Script adapter
  lib/server/collector/   Polling and SSE
  lib/server/store/       Message receipts
cli/
  index.ts                Commander entry point
```

## Out of scope

Spec editor, custom workflows, Jira integration, deployment controls, hosted service, agent configuration, and starting or stopping Firstmate's agents. (The captain's own sessions, above, are the one exception: Wheelhouse starts them, and never Firstmate's crew.)

## Acceptance criteria

- Attaches without changing Firstmate configuration.
- Sends messages only to Firstmate.
- Retries do not create duplicate messages.
- Crew states refresh and disclose stale observations.
- Worker output is inspectable but cannot accept input.
- Missing replies or output are shown honestly.
- Wheelhouse shutdown does not interrupt ongoing work, including the captain's sessions.