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

The CLI resolves the Firstmate code directory and operational home, validates supported integration scripts, starts the server, starts the Firstmate session when none is running, and opens the browser.

**One Firstmate session.** `wheelhouse open` starts Firstmate's primary session - an ordinary interactive `claude --dangerously-skip-permissions` (overridable) in Firstmate's checkout - inside a tmux session on tmux's default server, beside its crew, so it survives browser tabs and Wheelhouse restarts and keeps Firstmate's interactive hooks and supervision unchanged. When Firstmate's session lock shows a session already running elsewhere, Wheelhouse never starts a second one and shows that one read-only. Closing Wheelhouse leaves Firstmate and its crew running.

## Features

**Firstmate communication**

- Show the conversation with Firstmate as a chat rendered from its live Claude Code transcript: the captain's messages, Firstmate's replies, its tool calls and thinking folded and expandable, its questions as buttons. Quiet background supervision turns are summed up as ship health instead.
- Type to Firstmate as at its prompt, with `/` commands (Firstmate's and Claude Code's) and `#` references to tasks and pull requests, which reach Firstmate as the task id and title.
- Stop Firstmate (Escape), and a terminal drawer with the session's own screen for anything the chat cannot show.
- For a Firstmate session running in another terminal, messages go to its inbox, with stable request IDs and delivery and acknowledgement kept separately.
- Show supervisor readiness.

**Crew visibility**

- List tasks and their assigned workers.
- Show current state, assignment, harness, and latest available progress.
- Inspect bounded, read-only terminal output.
- Show blockers and open decisions where available.
- Display observation timestamps and stale/unavailable states.
- Show a second mate's tasks beside the captain's own, in the same lists, cards and task page, each marked with its second mate and host. A task there gets the same preview (a remote one's reached through an `ssh -W` forward over its SSH alias), console, status, PR and preview feedback, which goes to that second mate. Chat about it reaches it through Firstmate, and its projects sit with the captain's.
- Show second mates themselves, local and remote, apart from the captain's own workers (never as task cards under way): each one's health (online or offline, and its host's CPU, memory and disk where Firstmate reports them), projects, queue and work in flight with live status, pull requests and previews, and a bounded, read-only look at its own terminal on request. Their open questions join Decisions and Your move, labelled with the second mate they come from.
- Keep the rail's Under way to work in progress: what waits on a decision is with the decisions, and landed or closed work drops off by itself.

**All user messages go to Firstmate.** No direct worker messaging or lifecycle controls. The Firstmate session runs on tmux's default server, the one the crew use (a dedicated `tmux -L` socket can be configured instead), and Wheelhouse touches only its own `wh-firstmate` session there.

## Firstmate adapter

Wrap existing scripts behind a TypeScript interface:

| Capability | Integration |
|---|---|
| Fleet and current task state | `fm-fleet-snapshot.sh --json` |
| Send inbox message | `fm-inbox.sh note --request-id … --json` |
| Read acknowledgements/replies | `fm-inbox.sh receipts` |
| Supervisor readiness and session lock | `fm-inbox.sh ready` |
| Worker terminal output | `fm-peek.sh` |
| Second mates | `fm-fleet-snapshot.sh --json` (`secondmate_current`) |
| Second mate terminal output | `fm-peek.sh` (local), `fm-on.sh <id> fm-remote-secondmate-control.sh capture` (remote; exit 255 is offline, never retried) |
| A second mate's task's status log, console and feedback | `fm-on.sh <id> fm-remote-file.sh get`, `fm-on.sh <id> fm-peek.sh`, `fm-on.sh --stdin <id> fm-inbox.sh note` (remote); the same scripts with FM_HOME set to its home (local) |

Verify compatibility with the installed Firstmate version. Execute scripts using argument arrays and bounded stdin, never interpolated shell commands.

Do not treat the last status-log event as current state or terminal samples as a complete transcript.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Firstmate compatibility and supervisor readiness |
| `GET /api/fleet` | Cached tasks, worker states and second mates |
| `GET /api/firstmate/messages` | Wheelhouse submissions and available replies |
| `POST /api/firstmate/messages` | Send message with idempotency key |
| `GET /api/tasks/:id/output` | Bounded worker output |
| `GET /api/second-mates/:id/peek` | Bounded, read-only output of a second mate's own terminal |
| `GET /api/events` | SSE updates |
| `GET /api/firstmate/chat` | SSE: the Firstmate session's state and transcript records |
| `POST /api/firstmate/input` | Type a message into the Firstmate session |
| `POST /api/firstmate/interrupt` | Stop Firstmate (Escape) |
| `POST /api/firstmate/answer` | Answer Firstmate's open question |
| `POST /api/firstmate/start` | Start the Firstmate session when none is running |
| `GET /api/firstmate/terminal` | WebSocket: the session's terminal (Origin and session token checked on upgrade) |

A task-context message includes the task ID but still targets Firstmate.

## Runtime

- One shared collector polls fleet state every approximately five seconds.
- Collect selected worker output while its inspector is open.
- Push updates through SSE.
- Persist message request IDs and receipts locally; cache fleet/output in memory.
- Reconcile uncertain delivery using the original request ID.
- Bind to loopback by default and protect mutating endpoints with origin validation and a local session token.

## UI

One main workspace, the home page:

- Firstmate conversation and composer, full width.
- A resizable rail: the work under way first (the default tab), then what waits on the captain (failed steps, reviews, decisions), with projects, steps and issues marked, and the second mates with their work.
- A Second mates page: each second mate with its health, projects, work, pull requests and a read-only look at it.
- The full board (Harbour) as a second tab, and task pages with a read-only output inspector.

Use nautical branding and terminology without prescribing detailed designs.

## Structure

```text
src/
  routes/                 UI and API
  lib/components/         UI components
  lib/server/firstmate/   Script adapter
  lib/server/collector/   Polling and SSE
  lib/server/store/       Message receipts
  lib/server/sessions/    The Firstmate session, its transcript and terminal
  lib/chat/               The transcript read as a chat
cli/
  index.ts                Commander entry point
```

## Out of scope

Spec editor, custom workflows, Jira integration, deployment controls, hosted service, agent configuration, and starting or stopping Firstmate's agents. (Firstmate's own primary session is the one exception: Wheelhouse starts it when none is running, and never stops it or the crew.)

## Acceptance criteria

- Starts at most one Firstmate session, never a second, without changing Firstmate configuration.
- Sends messages only to Firstmate.
- Retries do not create duplicate messages.
- Crew states refresh and disclose stale observations.
- Worker output is inspectable but cannot accept input.
- Missing replies or output are shown honestly.
- Wheelhouse shutdown does not interrupt ongoing work, including the Firstmate session.