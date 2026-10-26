# How Wheelhouse reads Firstmate

Scripts run as argument arrays (never through a shell), with bounded output and timeouts, and with `FM_HOME` set to the operational home. stdin is closed, except that a message body is written to `fm-inbox.sh note`'s stdin, at most 16 KiB. Everything else is read-only.

| What                         | Source                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fleet and current task state | `bin/fm-fleet-snapshot.sh --json` (`fm-fleet-snapshot.v1`)                                                                                                                      |
| Supervisor readiness         | `bin/fm-inbox.sh ready` (`fm-primary-ready.v1`)                                                                                                                                 |
| Send a message               | `bin/fm-inbox.sh note --request-id <id> --json -` (`fm-inbox-note.v1`)                                                                                                          |
| Acknowledgements and replies | `bin/fm-inbox.sh receipts [--after <cursor>]` (`fm-inbox-receipts.v1`)                                                                                                          |
| Worker terminal output       | `bin/fm-peek.sh <task> <lines>`, at most 200 lines                                                                                                                              |
| History, identity, merges    | `state/fleet-ledger.jsonl`, tailed (when the home has the ledger turned on)                                                                                                     |
| Files changed                | `git diff` in the task worktree Firstmate recorded                                                                                                                              |
| Pull request and checks      | `data/<id>/contributions.json`, else `gh pr view` on the recorded PR URL                                                                                                        |
| Review after a ready report  | `gh api -X GET` on the PR, its head commit, its reviews and review comments                                                                                                     |
| The Firstmate conversation   | its Claude Code transcript (JSONL), read-only; see [The Firstmate session](guide.md#the-firstmate-session)                                                                      |
| Report and screenshots       | `data/<id>/report.md`, images under `data/<id>/`, and no-mistakes run evidence                                                                                                  |
| CI readiness of a PR         | the no-mistakes CI monitor's log, `~/.no-mistakes/logs/<run>/ci.log`, tailed                                                                                                    |
| Validation steps and rounds  | `no-mistakes axi status --run <run>` in the task worktree, and the run's step logs, tailed                                                                                      |
| Project descriptions         | `data/projects.md`                                                                                                                                                              |
| Decisions made for you       | `nm-*` decision keys in the ledger, the findings file each names under `data/<id>/`, and a live task's `state/<id>.inbox/handled/*.msg` for Firstmate's full answer             |
| Where time went, estimates   | the ledger's status history and the creation and last-write times of `~/.no-mistakes/logs/<run>/*.log` (each run is matched to its task by the `fm/<id>` branch its logs name)  |
| Who is using Claude          | only the `timestamp`, `cwd`, `gitBranch` and token `usage` fields of Claude Code transcripts under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/`, read incrementally, last 7 days |
| Claude allowance             | `quota-axi --provider claude --json --no-credential-refresh` once a minute                                                                                                      |

## Messages and retries

Every message has a stable request id: the browser makes one per message and sends it as the `Idempotency-Key`, and Wheelhouse records it before it runs `fm-inbox.sh note --request-id <id>`. Firstmate returns the original note for a repeated request id, so a retry, a double click or a reconciliation never creates a second message.

- Exit 0: delivered. Exit 3: Firstmate saved the note but was not woken; Wheelhouse shows that and re-issues the same request id (which repairs the wake). Exit 1: nothing was saved; the message shows **Retry**, which reuses its request id.
- A timeout or unreadable output is recorded as **delivery uncertain** and re-issued with the original request id on a backoff (15 s doubling to 5 min) until Firstmate confirms it. A message left mid-send when Wheelhouse stopped is treated the same way on the next start.
- If Wheelhouse cannot write the request id to its state directory, it refuses the message with a 503 and does not run `note`. If a later write fails, the delivery state is kept in memory and Wheelhouse warns that it may be lost on restart.
- Each collector round reads `receipts --after <cursor>` to update acknowledgement and replies, and lifts the bounds (`--all-pending --all-handled`) only when a message it still tracks was left out.

One collector reads readiness and the ledger every 5 seconds. The full fleet snapshot takes a few seconds, so it runs on an adaptive cadence (about twice its own duration, between 5 and 30 seconds, and sooner when the ledger shows activity). Results are cached in memory and pushed to the browser over server-sent events.

The validation run is the one Firstmate's crew state names (its `run: <id>`); Wheelhouse never picks a run itself, and never starts, answers or changes one.

`WHEELHOUSE_NM_LOGS_DIR` points the no-mistakes log reads elsewhere, and `WHEELHOUSE_NO_USAGE=1` turns off the transcript and quota-axi reads (the smoke test uses both).

Note that `fm-peek.sh` runs Firstmate's own `fm-guard.sh` first, which may update Firstmate's volatile banner state under `state/`. That is Firstmate's behaviour, not a Wheelhouse write.

## API

| Endpoint                                 | Purpose                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                        | Compatibility, supervisor readiness, collector and messaging                                                        |
| `GET /api/fleet`                         | Cached tasks, projects and staleness                                                                                |
| `GET /api/insights`                      | The rail's insights: recent decisions made for you, today's time, the Claude allowance                              |
| `GET /api/tasks/:id`                     | One task with its evidence and ledger history                                                                       |
| `GET /api/tasks/:id/output?lines=n`      | Bounded, read-only worker terminal output                                                                           |
| `GET /api/tasks/:id/diff?path=...`       | One changed file's diff (only files in its changed list)                                                            |
| `GET /api/tasks/:id/artifacts/...`       | A task's listed screenshots (nothing else is served)                                                                |
| `GET /api/tasks/:id/preview`             | Whether the task's reported preview can be embedded now (only loopback previews are fetched)                        |
| `GET /api/firstmate/messages`            | Messages sent through Wheelhouse, with receipts and replies                                                         |
| `POST /api/firstmate/messages`           | Send `{ text, taskId? }` with an `Idempotency-Key` header                                                           |
| `GET /api/events`                        | Server-sent events: `fleet`, `health` and `messages`                                                                |
| `GET /api/projects/:id/passage`          | A project's passage: files, steps, checks and consent                                                               |
| `POST /api/projects/:id/passage/consent` | Enable a project file's network checks (`{ digest }`), or turn them off (`{ digest: null }`)                        |
| `GET /api/plugins`                       | Plugins, their contract versions, and which projects use them                                                       |
| `GET /api/slots?project=`/`?task=`       | Plugin entries for one project or task (none: the fleet's cards)                                                    |
| `GET /api/firstmate/chat`                | Server-sent events: `session` (its state), `reset` (which transcript) and `records`                                 |
| `GET /api/specs`, `POST /api/specs`      | The spec drafts (newest first), or start a new one                                                                  |
| `GET`/`PUT`/`DELETE /api/specs/:id`      | One spec draft: read it (with its screenshots folder), save it, delete it and its screenshots                       |
| `POST /api/specs/:id/images`             | Attach a screenshot: the body is the image (PNG, JPEG, WebP or GIF, at most 10 MB), `x-caption` names it            |
| `GET`/`DELETE /api/specs/:id/images/:n`  | One screenshot a draft lists, or remove it                                                                          |
| `GET /api/firstmate/commands`            | The slash commands the composer offers                                                                              |
| `POST /api/firstmate/input`              | Type `{ text }` into the session and submit it                                                                      |
| `POST /api/firstmate/interrupt`          | Press Escape in the session                                                                                         |
| `POST /api/firstmate/answer`             | Answer the open question: `{ toolUseId, answers: number[][] }`                                                      |
| `POST /api/firstmate/start`              | Start the session when none is running (never a second one)                                                         |
| `GET /api/firstmate/terminal`            | WebSocket: the session's terminal (guarded as described in [The Firstmate session](guide.md#the-firstmate-session)) |
