# Wheelhouse

A local companion to [Firstmate](https://github.com/kunchenguid/firstmate): a web UI and CLI for watching Firstmate's crew at work and talking to Firstmate.

**Status:** this release covers the "watch the crew" and "talk to Firstmate" slices of the [MVP spec](docs/spec.md). Wheelhouse shows the fleet: what needs you, what is under way and how far along it is, and what landed, with evidence for each task and the worker's read-only terminal output. On the Bridge you send messages to Firstmate and see whether each was delivered, whether Firstmate acknowledged it, and any reply it recorded.

## Requirements

- Node.js 22 or newer, and npm.
- A Firstmate checkout and its operational home (the directory with `state/` and `data/`). Wheelhouse attaches to the Firstmate session already running there; it never starts, stops or reconfigures Firstmate.
- Whatever Firstmate's own scripts need (bash, python3, git).
- Optional: the GitHub CLI (`gh`), used to read a pull request's state and checks when Firstmate has no cached observation of it.

## Install from the repo

Wheelhouse is not published to npm. Install it from a clone:

```bash
git clone https://github.com/chrisjowen/wheelhouse.git
cd wheelhouse
npm ci
npm run build
npm link          # puts `wheelhouse` on your PATH
```

## Use

Run it inside a Firstmate checkout:

```bash
wheelhouse open
```

Or give the paths:

```bash
wheelhouse open --firstmate ~/firstmate --home ~/crew --port 4310
```

| Option              | Default                                  |
| ------------------- | ---------------------------------------- |
| `--firstmate <dir>` | the Firstmate checkout you are in        |
| `--home <dir>`      | `$FM_HOME`, else the Firstmate directory |
| `--port <n>`        | `4310`                                   |
| `--state-dir <dir>` | see below                                |
| `--no-browser`      | open the browser                         |

`wheelhouse` with no subcommand does the same as `wheelhouse open`.

`--state-dir` is where Wheelhouse keeps its own record of the messages it sent (request ids, bodies, delivery outcomes, receipts and the receipts cursor), one file per Firstmate home. It defaults to `$WHEELHOUSE_STATE_DIR`, else `$XDG_STATE_HOME/wheelhouse`, else `~/.local/state/wheelhouse`, and must be outside the Firstmate home.

Wheelhouse checks that Firstmate's integration scripts declare the contracts it understands, starts its server on `127.0.0.1` only, and opens the browser. It answers only requests addressed to `127.0.0.1`, `localhost` or `[::1]`; any other `Host` gets a 421, which blocks DNS-rebinding pages. Every request that changes anything (sending a message) must also carry an `Origin` equal to the page's own `http://<host>` origin and this launch's session token, which Wheelhouse issues only to the pages it serves; anything else gets a 403. If the scripts look incompatible it still starts, says so in the UI and in `/api/health`, and shows what it can. Press Ctrl+C to close Wheelhouse; Firstmate and its crew keep running.

## What you see

- **Harbour** (`/`): a one-line watch report, then **Your move** (captain-held decisions and pull requests waiting for your review), **Waiting on Firstmate** (decisions a worker raised that Firstmate is handling), and each project's work as cards led by a screenshot or a picture of the diff, each with a passage stepper. A project switcher (`?project=`) scopes the page, and the **Passage** view (`?view=passage`) puts every task on one chart.
- **Task page** (`/tasks/<id>`): the task's passage, with the evidence each step produced: files changed, the validation run, the pull request and its CI checks, the report, screenshots and a reported preview. Below that are the ship's log (history from Firstmate's fleet ledger) and the raw terminal output, which is read-only and sampled only while it is open. **Ask Firstmate about this** opens the Bridge with the task attached.
- **Bridge** (`/bridge`): the conversation with Firstmate. Each message you sent shows its delivery (delivered, saved but Firstmate not woken yet, uncertain, or not delivered with a Retry) and, separately, whether Firstmate acknowledged it. A reply Firstmate recorded with `fm-inbox.sh reply` appears as plain text; when it contains a pull request or reported preview URL that exactly matches a task, that task's card appears with it. The composer can attach a task (`/bridge?task=<id>`); the message still goes to Firstmate, with `Re: <task-id>` as the first line of its body. The **On deck** rail summarises the whole fleet. The page fills the window with the composer pinned; the conversation scrolls without a visible scrollbar and follows the newest message, with **Jump to latest** when you scroll up.

All messages go to Firstmate. There is no way to message a worker directly and no worker controls anywhere. The only write Wheelhouse makes to Firstmate is `fm-inbox.sh note`.

### Passage steps

| Work  | Steps                                                            |
| ----- | ---------------------------------------------------------------- |
| Ship  | Queued → Building → Checks → Pull request → Your review → Landed |
| Scout | Queued → Scout → Report → Your call → Done                       |

The steps follow Firstmate's delivery mode: direct-PR work has no local Checks step, local-only work has no Pull request step, and with yolo on there is no Your review step because Firstmate merges the work itself. In no-mistakes mode the pipeline opens the pull request before CI runs, so CI checks appear under Pull request. Stage derivation lives behind one interface (`src/lib/server/firstmate/stages.ts`) so that per-project stage definitions can replace it later.

### Honest gaps

Wheelhouse shows what Firstmate records and says plainly what it cannot see:

- **Deployments** are not shown. Firstmate does not record them, so there is no Deployed step.
- **Preview links** appear only when a worker reports one with a `preview <url>` status line.
- **Decisions** are shown as text. Firstmate does not record their options; you answer them by messaging Firstmate.
- **Firstmate's replies** appear only when Firstmate records one against your message with `fm-inbox.sh reply`; anything else it says stays in its own session, and Wheelhouse does not show that session. Acknowledgement is a yes/no: Firstmate does not record when it acknowledged a message.
- **Current state** comes from Firstmate's current-state read. Status-log lines are shown as history, never as the current state, and terminal output is a bounded sample, not a transcript.
- **Stale data** is labelled: if Wheelhouse cannot read Firstmate, it keeps the last view and says how old it is.

## How it reads Firstmate

Scripts run as argument arrays (never through a shell), with bounded output and timeouts, and with `FM_HOME` set to the operational home. stdin is closed, except that a message body is written to `fm-inbox.sh note`'s stdin, at most 16 KiB. Everything else is read-only.

| What                         | Source                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Fleet and current task state | `bin/fm-fleet-snapshot.sh --json` (`fm-fleet-snapshot.v1`)                     |
| Supervisor readiness         | `bin/fm-inbox.sh ready` (`fm-primary-ready.v1`)                                |
| Send a message               | `bin/fm-inbox.sh note --request-id <id> --json -` (`fm-inbox-note.v1`)         |
| Acknowledgements and replies | `bin/fm-inbox.sh receipts [--after <cursor>]` (`fm-inbox-receipts.v1`)         |
| Worker terminal output       | `bin/fm-peek.sh <task> <lines>`, at most 200 lines                             |
| History, identity, merges    | `state/fleet-ledger.jsonl`, tailed (when the home has the ledger turned on)    |
| Files changed                | `git diff` in the task worktree Firstmate recorded                             |
| Pull request and checks      | `data/<id>/contributions.json`, else `gh pr view` on the recorded PR URL       |
| Report and screenshots       | `data/<id>/report.md`, images under `data/<id>/`, and no-mistakes run evidence |
| Project descriptions         | `data/projects.md`                                                             |

### Messages and retries

Every message has a stable request id: the browser makes one per message and sends it as the `Idempotency-Key`, and Wheelhouse records it before it runs `fm-inbox.sh note --request-id <id>`. Firstmate returns the original note for a repeated request id, so a retry, a double click or a reconciliation never creates a second message.

- Exit 0: delivered. Exit 3: Firstmate saved the note but was not woken; Wheelhouse shows that and re-issues the same request id (which repairs the wake). Exit 1: nothing was saved; the message shows **Retry**, which reuses its request id.
- A timeout or unreadable output is recorded as **delivery uncertain** and re-issued with the original request id on a backoff (15 s doubling to 5 min) until Firstmate confirms it. A message left mid-send when Wheelhouse stopped is treated the same way on the next start.
- If Wheelhouse cannot write the request id to its state directory, it refuses the message with a 503 and does not run `note`. If a later write fails, the delivery state is kept in memory and the Bridge warns that it may be lost on restart.
- Each collector round reads `receipts --after <cursor>` to update acknowledgement and replies, and lifts the bounds (`--all-pending --all-handled`) only when a message it still tracks was left out.

One collector reads readiness and the ledger every 5 seconds. The full fleet snapshot takes a few seconds, so it runs on an adaptive cadence (about twice its own duration, between 5 and 30 seconds, and sooner when the ledger shows activity). Results are cached in memory and pushed to the browser over server-sent events.

Note that `fm-peek.sh` runs Firstmate's own `fm-guard.sh` first, which may update Firstmate's volatile banner state under `state/`. That is Firstmate's behaviour, not a Wheelhouse write.

### API

| Endpoint                            | Purpose                                                      |
| ----------------------------------- | ------------------------------------------------------------ |
| `GET /api/health`                   | Compatibility, supervisor readiness, collector and messaging |
| `GET /api/fleet`                    | Cached tasks, projects and staleness                         |
| `GET /api/tasks/:id`                | One task with its evidence and ledger history                |
| `GET /api/tasks/:id/output?lines=n` | Bounded, read-only worker terminal output                    |
| `GET /api/tasks/:id/artifacts/...`  | A task's listed screenshots (nothing else is served)         |
| `GET /api/firstmate/messages`       | Messages sent through Wheelhouse, with receipts and replies  |
| `POST /api/firstmate/messages`      | Send `{ text, taskId? }` with an `Idempotency-Key` header    |
| `GET /api/events`                   | Server-sent events: `fleet`, `health` and `messages`         |

## Develop

```bash
npm ci
WHEELHOUSE_FIRSTMATE_DIR=~/firstmate WHEELHOUSE_HOME=~/crew npm run dev
```

| Script               | Does                                                       |
| -------------------- | ---------------------------------------------------------- |
| `npm run build`      | Builds the web app (`build/`) and the CLI (`dist/cli.js`)  |
| `npm run check`      | Type-checks the app (svelte-check) and the CLI (tsc)       |
| `npm run lint`       | Prettier and ESLint                                        |
| `npm run format`     | Formats everything with Prettier                           |
| `npm run test:unit`  | Unit tests: adapter, store, messenger, security, collector |
| `npm run test:smoke` | Builds, then starts the CLI against a fake Firstmate home  |
| `npm test`           | Both                                                       |

The code is laid out as the spec describes: `src/routes` (UI and API), `src/lib/components`, `src/lib/server/firstmate` (the script adapter and data-source rules), `src/lib/server/collector` (polling and SSE), `src/lib/server/store` (message request ids and receipts), and `cli/index.ts` (the Commander entry point).

### Stack choice: SvelteKit 2

Wheelhouse uses SvelteKit 2 with Svelte 5, Vite 7, Tailwind 4 and shadcn-svelte. The UI prototype ran on SvelteKit 3 and needed workarounds for shadcn-svelte: `#lib` aliases, a crash on `extends: "$app/tsconfig"`, and patched component state attributes. SvelteKit 2 works with shadcn-svelte's standard `$lib` aliases and components as generated, so this build pins it. Moving to SvelteKit 3 is a later, separate change once shadcn-svelte supports it cleanly.

## License

MIT
