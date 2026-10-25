# Wheelhouse

A local companion to [Firstmate](https://github.com/kunchenguid/firstmate): a web UI and CLI for watching Firstmate's crew at work and talking to Firstmate.

**Status:** this release covers the "watch the crew" and "talk to Firstmate" slices of the [MVP spec](docs/spec.md). `wheelhouse open` starts the one Firstmate session (or shows the one already running), and the home page is one pane: the conversation with Firstmate on the left, rendered as a chat from its live Claude Code transcript (replies, its work folded into one line per run, its questions as buttons), and on the right what needs you and what the crew is doing. The **Harbour** tab is the full board, with evidence for each task and the worker's read-only terminal output.

## Requirements

- Node.js 22 or newer, and npm.
- A Firstmate checkout and its operational home (the directory with `state/` and `data/`). Wheelhouse starts Firstmate's session there when none is running (see [The Firstmate session](#the-firstmate-session)); it never stops or reconfigures Firstmate.
- Whatever Firstmate's own scripts need (bash, python3, git).
- Optional: the GitHub CLI (`gh`), used to read a pull request's state and checks when Firstmate has no cached observation of it, and by the GitHub checks a [passage file](#passage-files) declares.
- `tmux` and Claude Code (`claude`) on your `PATH`, to run and talk to Firstmate from Wheelhouse. Without them Wheelhouse says so, still shows a Firstmate session running elsewhere (read-only), and the rest works as usual.

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

| Option                  | Default                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `--firstmate <dir>`     | the Firstmate checkout you are in                                                                 |
| `--home <dir>`          | `$FM_HOME`, else the Firstmate directory                                                          |
| `--port <n>`            | `4310`                                                                                            |
| `--state-dir <dir>`     | see below                                                                                         |
| `--config-dir <dir>`    | see [Passage files](#passage-files)                                                               |
| `--tmux-socket <name>`  | `$WHEELHOUSE_TMUX_SOCKET`, else `wheelhouse`; see [The Firstmate session](#the-firstmate-session) |
| `--no-skip-permissions` | start it with `--dangerously-skip-permissions`                                                    |
| `--no-browser`          | open the browser                                                                                  |

`wheelhouse` with no subcommand does the same as `wheelhouse open`.

`--state-dir` is where Wheelhouse keeps its own records: the inbox messages it sent (request ids, bodies, delivery outcomes, receipts and the receipts cursor), one file per Firstmate home, and `firstmate/session-start.json`, which its SessionStart hook writes to name the Firstmate session's transcript. It defaults to `$WHEELHOUSE_STATE_DIR`, else `$XDG_STATE_HOME/wheelhouse`, else `~/.local/state/wheelhouse`, and must be outside the Firstmate home.

Wheelhouse checks that Firstmate's integration scripts declare the contracts it understands, starts its server on `127.0.0.1` only, and opens the browser. It answers only requests addressed to `127.0.0.1`, `localhost` or `[::1]`; any other `Host` gets a 421, which blocks DNS-rebinding pages. Every request that changes anything (sending a message, starting the Firstmate session, typing into it, stopping it, answering its questions) must also carry an `Origin` equal to the page's own `http://<host>` origin and this launch's session token, which Wheelhouse issues only to the pages it serves; anything else gets a 403. If the scripts look incompatible it still starts, says so in the UI and in `/api/health`, and shows what it can. Press Ctrl+C to close Wheelhouse; Firstmate and its crew keep running.

## What you see

- **Home** (`/`, the **Firstmate** tab): the conversation with Firstmate, full width, with a rail on the right. See [The Firstmate session](#the-firstmate-session) for the chat. The rail lists, first, **Waiting on you**: a failed step (say, failed checks or a failed deploy) as an urgent card, then pull requests waiting for your review (with their full URLs) and decisions Firstmate is holding for you, in plain words; then **Under way**, then **Up next** and **Landed in the last day**, folded. Every card shows its project as a tag, what it is doing now (in the checks stage, the same step strip and plain line as on Harbour), a small passage with the current step marked, and a badge for anything wrong, each with an icon and words (Checks failed, Stuck, Not responding, Your review, Your call, Addressing your review, Firstmate deciding), and has **Open** (the task page) and **Chat about this** (mentions the task in the message box). A pull request you reviewed after Firstmate reported it ready, and that the worker is reworking, shows under Under way as **Addressing your review** rather than under Waiting on you, until a newer ready report for a newer head. The rail can be resized by dragging its edge (its width is remembered in this browser); on narrow screens the chat stands alone and a button opens the rail as a sheet. The project switcher scopes the rail.
- **Harbour** (`/harbour`): the full board. A one-line watch report, then **Your move** (captain-held decisions and pull requests waiting for your review, each showing its screenshot count, the reported live preview link and the pull request link), **Waiting on Firstmate** (decisions a worker raised that Firstmate is handling), and each project's work as cards. A card names the work (its title without the project prefix), who is doing it (harness, model and worker name) and what they are doing **Now**, in plain words with its age: the latest status line, else the latest line of the worker's console. While the work is in its checks stage (a no-mistakes validation run: rebase, review, tests, docs, lint, push, pull request, CI), a slim strip with one segment per step takes the Now line's place, with one plain line under it, for example "Reviewing the change · 1m 20s · 1 question for Firstmate", "Answer received · fixing review findings, round 2 · 3m" or "All checks passed · CI green". The step under way is drawn solid, a step waiting on Firstmate amber and a failed step red; the line says the same in words. Work under way is led by the worker's live console (a bounded, read-only sample of the last lines, refreshed only while the card is on screen); finished work by its latest screenshot or a picture of the diff. A card with screenshots shows the newest few as thumbnails that open in the in-page viewer. A card whose worker reported a preview has **Show live preview**, which embeds it in the card with **Open in new tab** and a feedback box (see the task page). A soft pulse on the current step shows a worker that is busy right now, and the card counts the files changed. A project switcher (`?project=`) scopes the page, and the **Passage** view (`?view=passage`) puts every task on one chart. An **Under way | Completed** toggle switches the cards between work still in progress (including what needs you) and landed or finished work, newest first (`?view=completed`); **Your move** shows only under Under way.
- **Task page** (`/tasks/<id>`): the task's passage, with the evidence each step produced: files changed, the validation run (under Checks: what is happening now, then a short timeline of what each validation step found or changed and how long it took, with the pull request's CI result on the CI step once the PR is up), the pull request and its CI checks, the report, screenshots and a reported preview. Screenshots open in an in-page viewer (Esc closes, the arrow keys step through them), and selecting a changed file shows its diff against the merge base. Status lines show in plain words, with the raw line behind a small **details** disclosure. While the work waits on your review, its screenshots, live preview link and pull request link come first, at the top of the page. A reported preview is also shown embedded, under **Live preview**: only a preview on this machine (`127.0.0.1` or `localhost`) is embedded, in a sandboxed frame, after Wheelhouse has checked that it answers; one that does not answer shows **Preview not running**, and one that refuses to be framed says so, with **Open in new tab** either way. The box under it sends your feedback to the task's worker through Firstmate's inbox, as a note about the task (`Re: <task-id>`) that Firstmate passes on (landed work has no worker, so it has no box). Below that are the ship's log (history from Firstmate's fleet ledger) and the raw terminal output, which is read-only and sampled only while it is open (or, for work under way, while its console is on screen). **Ask Firstmate about this** opens the home page with the task mentioned in the message box.
- **Insights**, each with a quiet piece on the home page's rail (the allowance under its headline, an estimate on each card under way, **Decided for you** with the latest three calls, and **Where time went today**) and a page of its own:
  - **Decided for you** (`/decisions`): review questions the automated review raised that Firstmate answered on your behalf, newest first, grouped by day and filterable (Fix it, Keep as is, Defer). Each opens to show the question, Firstmate's call and its reason (the reviewer's full note is folded away), whether the work has landed, **I'd decide differently** (opens the chat with the task mentioned and a draft to finish) and **Chat about this**. Questions that carry your own words (prototype reviews and other captain calls) are never listed.
  - **Where time went** (`/time`): for today, the last 7 or 30 days, each task's time split into building, automated review and fixes, Firstmate deciding, CI checks and waiting on you, on one shared scale, with per-project totals and how long work usually takes from start to ready for you.
  - **Headroom** (`/headroom`): how much of your Claude allowance is left, when each window resets and whether the recent pace lasts until then; who on this machine is using Claude (Firstmate, each task with its share of automated review, other use) over the last 5 hours or 7 days; and use per hour for the last day. When a window will run out before it resets, a warning shows in the header on every page. **Ask Firstmate to hold new work** drafts that message in the chat. If quota-axi needs its one-time Keychain approval, the page and the rail say **Connect your Claude usage** and give the command (`quota-axi --allow-keychain-prompt`) to run once yourself; Wheelhouse never asks for that approval.
- **Work-time estimate**: work under way shows a rough estimate of the work time left before it is ready for your review ("About 20 min left · rough guide"), on its rail and Harbour cards and, with the steps still ahead, on its task page; "Taking longer than usual" when similar work had finished by now; prototypes and scouting show their time under way with "no set end". It is worked out from finished work of the same kind (this project's when it has at least three, else across projects): what similar work still had left at the same point, as a median with a 25th–75th percentile range, labelled an early guess, a rough guide or a good guide by how much history there is and how much it agreed. The task page also shows where the task's time went and the review questions Firstmate decided on it.
- **Project passage** (`/projects/<id>/passage`, linked from each project's header): the steps and checks the project's passage declares, where each came from, and any problem with its passage files, plus the switch that enables a project file's network checks.

- **Plugins** add to fixed places on these pages: a project tab (linked beside a project's name and on its scoped Harbour view, each its own full-window page at `/projects/<id>/<plugin>/<tab>`), a card in the project's Harbour section, a section on the task page, evidence under one passage step, and a card under a Firstmate reply in the chat that links something the plugin knows. Wheelhouse ships two: **Project links** (off unless turned on in `plugins.json`): a project's repository, README and pull requests, the task's branch, and a compare link under the Pull request step; and **Docket** (on for projects with a `.docket.yaml`): a read-only chart of the project's docket. See [Plugins](#plugins).

Everything you type goes to Firstmate. There is no way to message a worker directly and no worker controls anywhere. Wheelhouse writes nothing into the Firstmate home; it types into the Firstmate session it runs, and sends to a session running elsewhere only through `fm-inbox.sh note`.

### The Firstmate session

`wheelhouse open` starts the one Firstmate session when none is running: an ordinary interactive `claude` in Firstmate's checkout, inside a detached tmux session named `wh-firstmate` on Wheelhouse's own tmux server (`tmux -L wheelhouse`; change the name with `--tmux-socket <name>` or `WHEELHOUSE_TMUX_SOCKET`), never the default server the crew run on. It is the same session you would start in a terminal, so Firstmate's own hooks and supervision run unchanged.

- **One session only.** Firstmate's session lock decides: when `fm-inbox.sh ready` says another session holds it (say, Firstmate running in your own terminal), Wheelhouse starts nothing and shows that session's conversation read-only, since it cannot type into a terminal it does not own; the message box then sends to Firstmate's inbox (`fm-inbox.sh note`, see [Messages and retries](#messages-and-retries)), and Firstmate's reply appears in the conversation. If the lock cannot be read, it starts nothing either. If starting fails, **Start Firstmate here** on the home page tries again, under the same rule.
- **It outlives Wheelhouse.** The session belongs to tmux, so closing the browser or Wheelhouse leaves it running, and the next `wheelhouse open` shows it again. To use your own terminal, run `tmux -L wheelhouse attach -t wh-firstmate`.
- **Permissions.** It starts with `--dangerously-skip-permissions` (and Claude Code's bypass-mode confirmation skipped), so Firstmate runs without stopping to ask; `--no-skip-permissions` starts it without, and Claude Code's permission prompts then appear in the terminal drawer. Before starting it, Wheelhouse pre-approves Claude Code's workspace trust for Firstmate's checkout (`hasTrustDialogAccepted` in `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json`, written atomically; no other setting is touched). `FM_HOME` is passed when the home differs from the checkout.
- **Its transcript.** Wheelhouse adds one SessionStart hook of its own through `claude --settings` (merged with Firstmate's hooks, never replacing them), which writes the hook's input, including `transcript_path`, to `<state-dir>/firstmate/session-start.json`. The chat follows that file, and finds the new one after `/clear`, `/compact` or a restart. For a session it did not start, it looks up the Claude session id Firstmate records beside its lock (`state/.lock-session`), else the newest transcript whose records name Firstmate's checkout. It only ever reads the transcript, and reads at most its last 8 MiB when first opening it (earlier messages stay in the terminal).

The chat shows the captain's messages (including ones typed while Firstmate was busy), Firstmate's replies as Markdown, and its work between replies folded into one line ("3 commands, 1 skill"; "Thought for 7s") that opens to a row per step and then to the step's input and result. Claude Code records only a sealed signature for its thinking, so thinking shows as how long it took, not the words. A turn started by a background wake (a task notification) whose reply is empty or only an all-clear such as "Captain, shipshape." is kept out of the chat; the **ship health** pill in the chat's bar (All well, N need you, Keeping an eye on a problem, Something failed) says when the last background check ran, or that one is running, and lists recent ones. A wake with something to say reads as an ordinary message. Slash commands and their output show as they do in the terminal.

- **Typing.** Enter sends, Shift+Enter adds a line. The message is pasted into the session as one bracketed paste (`tmux load-buffer` and `paste-buffer -p`), then Enter, so a multi-line message never submits early. `/` at the start offers Firstmate's commands (its skills marked `user-invocable: true` and its `.claude/commands`) and the Claude Code built-ins that work from a chat (`/compact`, `/clear`, `/context`); built-ins that open a picker in the terminal are left out. `#` anywhere offers tasks and pull requests and inserts a chip, which Firstmate receives as `[task <id>: <title>]` (or `[PR <url> — task <id>: <title>]`), the task id being the key its own scripts use. While Firstmate works, an empty message box offers **Stop**, which presses Escape in the session.
- **Questions.** When Firstmate asks with Claude Code's question picker, the chat shows the question with its options as buttons; picking sends the keys the picker expects, worked out on the server from the open question. Free-text answers go through the terminal.
- **The terminal drawer** shows the session's own screen, live, for anything the chat cannot show. It is a WebSocket at `/api/firstmate/terminal`, served on `127.0.0.1` only, backed by a real pty (`node-pty`) running `tmux -L <socket> attach-session -t =wh-firstmate`.

Everything that types into the session (sending, Stop, answering, the terminal) is refused unless its `Host` is loopback, its `Origin` is the page's own and it carries this launch's session token (as a WebSocket subprotocol for the terminal), and it reaches only `wh-firstmate` on Wheelhouse's own tmux server, and only when Wheelhouse runs it.

### Passage steps

| Work  | Steps                                                            |
| ----- | ---------------------------------------------------------------- |
| Ship  | Queued → Building → Checks → Pull request → Your review → Landed |
| Scout | Queued → Scout → Report → Your call → Done                       |

The steps follow Firstmate's delivery mode: direct-PR work has no local Checks step, local-only work has no Pull request step, and with yolo on there is no Your review step because Firstmate merges the work itself. In no-mistakes mode the pipeline opens the pull request before CI runs, so CI checks appear under Pull request. Its CI monitor keeps running until the pull request merges, so an open, non-draft pull request whose checks are green moves to Your review (and **Needs your review**) even while that monitor is still working. If the pull request then gets review comments, a changes-requested review or new commits after it was reported ready, the work is **Addressing your review** (under way) until a newer ready report for a newer head. Only review feedback from people other than the pull request's author counts, and never from bots: this assumes workers and Firstmate open pull requests as their own account, not the one you review with. These built-in passages are written in the passage file format (`src/lib/server/passages/builtin.ts`), and a project can add steps such as Deployed or Released to them with a [passage file](#passage-files).

### Honest gaps

Wheelhouse shows what Firstmate records and says plainly what it cannot see:

- **Deployments** are not recorded by Firstmate. A Deployed (or Released) step, and the watch report's "N live", appear only for projects whose [passage file](#passage-files) declares one and the checks that observe it.
- **Preview links** appear only when a worker reports one with a `preview <url>` status line.
- **Decisions** Firstmate holds for you are shown as text, since Firstmate does not record their options; you answer them in the chat. Questions Firstmate asks with Claude Code's question picker show as buttons.
- **Firstmate's thinking** is not shown as words: Claude Code keeps only a sealed signature for it.
- **Inbox messages** (sent when Firstmate runs in another terminal) report delivery and acknowledgement as a yes/no: Firstmate does not record when it acknowledged a message.
- **Current state** comes from Firstmate's current-state read. Status-log lines are shown as history, never as the current state, and terminal output is a bounded sample, not a transcript.
- **Stale data** is labelled: if Wheelhouse cannot read Firstmate, it keeps the last view and says how old it is.

## Passage files

A project can extend the built-in passage with steps of its own, such as **Deployed**, **Released** or **On npm**, and the checks that tell Wheelhouse when a task has reached them. A passage has two parts: **checks** observe something (a GitHub deployment, a release, an HTTP endpoint), and **stages** are rules over those observations and Firstmate's own facts.

Wheelhouse reads passage files from two places, layered over its built-in passages:

1. **The project's `.wheelhouse.yaml`**, read with `git cat-file` from the tip of the default branch (`origin/HEAD`, else `origin/main` or `origin/master`) of Firstmate's clone of the project, `<home>/projects/<id>`. Never from a working tree, another branch or a task's worktree, so a crewmate cannot declare or change the check that clears its own work.
2. **The captain-owned file** `<config dir>/projects/<id>.yaml`, which wins over the project's file. Use it for repositories you should not commit to (Firstmate itself, upstream projects), and for HTTP credentials. The config directory is `--config-dir`, else `$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`, and it must be outside the Firstmate home. The Firstmate home's own configuration is never read.

Both files are re-read every minute. A project with neither file uses the built-in passage, exactly as before. A file that does not validate is left out, its errors are listed on the project's passage page and flagged in the project header, and the passage falls back to the layers below it; a broken file never blanks the dashboard.

**Enable before it runs.** A project file's network checks (GitHub, npm and HTTP) stay off until you enable that file on the project's passage page, which lists every check it will run. Wheelhouse records the file's sha256 in its state directory, and a changed file is off again until you enable the new version. Checks in the captain-owned file, and the local `git.contains` and `status.note` checks, need no enabling.

An example for a web app deployed with preview and production environments:

```yaml
# .wheelhouse.yaml, on the project's default branch
version: 1
extends: ship # or scout
checks:
  preview:
    type: github.deployment # Vercel, Netlify and Render post GitHub deployments
    label: Preview deployment
    environment: Preview
    ref: pr.head
  production:
    type: github.deployment
    label: Production deployment
    environment: Production
    ref: merge.commit
  live-commit:
    type: http
    label: Live version
    url: https://docs.example.dev/api/version
    expect: { status: 200, json_pointer: /commit, equals: merge.commit }
    interval: 2m
stages:
  - id: review # a built-in step: change its evidence and primary link
    evidence: [decision, screenshots, 'check:preview']
    primary_link: preview.url
  - id: deployed # a new step
    label: Deployed
    after: landed
    reached_when: { all: [production.success, live-commit.ok] }
    failed_when: production.failure
    evidence: ['check:production', 'check:live-commit']
    primary_link: production.url
    give_up_after: 24h
headline:
  live: deployed # tasks at this step count toward the watch report's "N live"
```

More examples, including a library released by tag and published to npm and a captain-owned passage for Firstmate, are in `src/lib/server/passages/testdata/`.

### Stages

| Field           | Meaning                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `label`   | A step id (lower-case letters, digits and `-`) and its name. Naming a built-in step's id changes that step; any other id adds a new step.                               |
| `short`         | A shorter name for narrow layouts.                                                                                                                                      |
| `after`         | Where a new step goes (default: at the end). `column` lines it up with another step on the Passage chart.                                                               |
| `reached_when`  | When the step is reached. The current step is the furthest step whose condition holds, and every step before it counts as done.                                         |
| `skip_when`     | When the step is skipped (unless it is current), with an optional `skip_note`.                                                                                          |
| `failed_when`   | When the step has failed. A later step that failed becomes current and is shown in red ("1 failed at Deployed"); it is not a Needs you item.                            |
| `evidence`      | What the step shows: `check:<check>`, or a built-in block (`queue`, `progress`, `files`, `validation`, `pr`, `report`, `screenshots`, `preview`, `decision`, `landed`). |
| `primary_link`  | `<check>.url`: that check's link becomes the task's primary link while this step is current.                                                                            |
| `give_up_after` | Stop checking this long after the task landed (e.g. `24h`, `7d`), and say so.                                                                                           |
| `note`          | Text shown with the step, or `{ when: <condition>, text: … }`.                                                                                                          |

A file can change a built-in step's label, evidence, primary link and note, but not when it is reached, skipped or failed.

Conditions are references combined with `all`, `any` and `not`, plus `{ mode: <delivery mode> }` and `{ yolo: on | off }`. A reference is a Firstmate fact (`task.live`, `backlog.queued`, `backlog.done`, `nm.run`, `pr.recorded`, `pr.ready`, `crew.done`, `merged`, `hold.captain`, `report.present`) or `<check>.<outcome>`. There is no expression language or templating. Unknown fields, check types, references and outcomes are errors.

### Checks

| Type                | Parameters                                                                       | Outcomes                                                  |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `github.deployment` | `environment`, `ref: pr.head \| merge.commit`, optional `repo`                   | `success`, `failure`, `in_progress`, `inactive`, `absent` |
| `github.workflow`   | `workflow` (file name or id), `ref`, optional `event`, `repo`                    | `success`, `failure`, `in_progress`, `absent`             |
| `github.release`    | `contains: merge.commit \| pr.head`, optional `tag_pattern` (e.g. `v*`), `repo`  | `included`, `not_yet`                                     |
| `npm.published`     | `package`, `version_from: <github.release check>` (its tag, minus a leading `v`) | `published`, `latest`, `absent`                           |
| `http`              | `url`, `method: GET \| HEAD`, `expect: { status, json_pointer, equals }`         | `ok`, `mismatch`, `error`                                 |
| `git.contains`      | `repo: firstmate-root \| project-clone`, optional `ref`, `commit`                | `yes`, `no`                                               |
| `status.note`       | `prefix: preview` (the worker's `preview <url>` status line)                     | `present`, `absent`                                       |

Every check also takes `label` and `interval` (at least `30s`; GitHub and HTTP checks default to `60s`, releases and npm to `5m`). `repo` defaults to the task's pull request repository, else the project clone's origin. A deployment that succeeded and was later replaced (`inactive`) also counts as `success`. `equals` takes `merge.commit`, `pr.head`, `task.id` or a literal. In the captain-owned file only, an `http` check may set `headers_from_env: { <Header>: <ENV_VAR> }`.

How checks run:

- **In the background, never on the fleet's hot path.** Each fleet round records which checks a task could still use (a step it has not reached, a failed step that may recover, or the current step's evidence), and a scheduler runs them on their interval, two at a time. A check that needs a commit waits for it: the PR head while a pull request is recorded, the merge commit (from `gh pr view`) once it merged.
- **Terminal results are cached.** A result that cannot change, such as a successful deployment of the merge commit, is not checked again. Tasks that landed more than 30 days ago are not checked, and `give_up_after` stops checking earlier. A step reached through checks is recorded in Wheelhouse's state directory, so it stays reached after a restart even when its checks can no longer see it (a newer commit is live). A step the task has moved past keeps how it was shown (done or skipped, with its note) when its `skip_when` or note depends on checks that no longer run.
- **Unknown is honest.** A check that errors or times out has no outcome: its step stays where it was on what the check last observed, with a note saying why, and is never treated as not reached. `not` over a check that has observed nothing does not hold.
- **Observation only, with fixed queries.** GitHub reads are `gh api` GETs; commits are 40-hex values Wheelhouse looked up itself and passes as separate arguments, never text spliced into a string. HTTP checks are GET or HEAD only, http(s) only, with no cookies, at most 3 redirects, a 10 s timeout and a 64 KiB body cap; `headers_from_env` headers are dropped once a redirect leaves the URL's origin (another host, port or scheme). `git.contains` runs `git --no-optional-locks merge-base --is-ancestor`. `WHEELHOUSE_NO_GH=1` turns the GitHub reads off.
- **No command checks.** Running arbitrary commands is not supported.

## How it reads Firstmate

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
| The Firstmate conversation   | its Claude Code transcript (JSONL), read-only; see [The Firstmate session](#the-firstmate-session)                                                                              |
| Report and screenshots       | `data/<id>/report.md`, images under `data/<id>/`, and no-mistakes run evidence                                                                                                  |
| CI readiness of a PR         | the no-mistakes CI monitor's log, `~/.no-mistakes/logs/<run>/ci.log`, tailed                                                                                                    |
| Validation steps and rounds  | `no-mistakes axi status --run <run>` in the task worktree, and the run's step logs, tailed                                                                                      |
| Project descriptions         | `data/projects.md`                                                                                                                                                              |
| Decisions made for you       | `nm-*` decision keys in the ledger, the findings file each names under `data/<id>/`, and a live task's `state/<id>.inbox/handled/*.msg` for Firstmate's full answer             |
| Where time went, estimates   | the ledger's status history and the creation and last-write times of `~/.no-mistakes/logs/<run>/*.log` (each run is matched to its task by the `fm/<id>` branch its logs name)  |
| Who is using Claude          | only the `timestamp`, `cwd`, `gitBranch` and token `usage` fields of Claude Code transcripts under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/`, read incrementally, last 7 days |
| Claude allowance             | `quota-axi --provider claude --json --no-credential-refresh` once a minute                                                                                                      |

### Messages and retries

Every message has a stable request id: the browser makes one per message and sends it as the `Idempotency-Key`, and Wheelhouse records it before it runs `fm-inbox.sh note --request-id <id>`. Firstmate returns the original note for a repeated request id, so a retry, a double click or a reconciliation never creates a second message.

- Exit 0: delivered. Exit 3: Firstmate saved the note but was not woken; Wheelhouse shows that and re-issues the same request id (which repairs the wake). Exit 1: nothing was saved; the message shows **Retry**, which reuses its request id.
- A timeout or unreadable output is recorded as **delivery uncertain** and re-issued with the original request id on a backoff (15 s doubling to 5 min) until Firstmate confirms it. A message left mid-send when Wheelhouse stopped is treated the same way on the next start.
- If Wheelhouse cannot write the request id to its state directory, it refuses the message with a 503 and does not run `note`. If a later write fails, the delivery state is kept in memory and Wheelhouse warns that it may be lost on restart.
- Each collector round reads `receipts --after <cursor>` to update acknowledgement and replies, and lifts the bounds (`--all-pending --all-handled`) only when a message it still tracks was left out.

One collector reads readiness and the ledger every 5 seconds. The full fleet snapshot takes a few seconds, so it runs on an adaptive cadence (about twice its own duration, between 5 and 30 seconds, and sooner when the ledger shows activity). Results are cached in memory and pushed to the browser over server-sent events.

The validation run is the one Firstmate's crew state names (its `run: <id>`); Wheelhouse never picks a run itself, and never starts, answers or changes one.

`WHEELHOUSE_NM_LOGS_DIR` points the no-mistakes log reads elsewhere, and `WHEELHOUSE_NO_USAGE=1` turns off the transcript and quota-axi reads (the smoke test uses both).

Note that `fm-peek.sh` runs Firstmate's own `fm-guard.sh` first, which may update Firstmate's volatile banner state under `state/`. That is Firstmate's behaviour, not a Wheelhouse write.

### API

| Endpoint                                 | Purpose                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                        | Compatibility, supervisor readiness, collector and messaging                                                |
| `GET /api/fleet`                         | Cached tasks, projects and staleness                                                                        |
| `GET /api/insights`                      | The rail's insights: recent decisions made for you, today's time, the Claude allowance                      |
| `GET /api/tasks/:id`                     | One task with its evidence and ledger history                                                               |
| `GET /api/tasks/:id/output?lines=n`      | Bounded, read-only worker terminal output                                                                   |
| `GET /api/tasks/:id/diff?path=...`       | One changed file's diff (only files in its changed list)                                                    |
| `GET /api/tasks/:id/artifacts/...`       | A task's listed screenshots (nothing else is served)                                                        |
| `GET /api/firstmate/messages`            | Messages sent through Wheelhouse, with receipts and replies                                                 |
| `POST /api/firstmate/messages`           | Send `{ text, taskId? }` with an `Idempotency-Key` header                                                   |
| `GET /api/events`                        | Server-sent events: `fleet`, `health` and `messages`                                                        |
| `GET /api/projects/:id/passage`          | A project's passage: files, steps, checks and consent                                                       |
| `POST /api/projects/:id/passage/consent` | Enable a project file's network checks (`{ digest }`), or turn them off (`{ digest: null }`)                |
| `GET /api/plugins`                       | Plugins, their contract versions, and which projects use them                                               |
| `GET /api/slots?project=`/`?task=`       | Plugin entries for one project or task (none: the fleet's cards)                                            |
| `GET /api/firstmate/chat`                | Server-sent events: `session` (its state), `reset` (which transcript) and `records`                         |
| `GET /api/firstmate/commands`            | The slash commands the composer offers                                                                      |
| `POST /api/firstmate/input`              | Type `{ text }` into the session and submit it                                                              |
| `POST /api/firstmate/interrupt`          | Press Escape in the session                                                                                 |
| `POST /api/firstmate/answer`             | Answer the open question: `{ toolUseId, answers: number[][] }`                                              |
| `POST /api/firstmate/start`              | Start the session when none is running (never a second one)                                                 |
| `GET /api/firstmate/terminal`            | WebSocket: the session's terminal (guarded as described in [The Firstmate session](#the-firstmate-session)) |

## Plugins

Plugins are "panels and providers": first-party code compiled into Wheelhouse. A provider reads data on the server; a contribution puts its output in one of the fixed slots below, drawn either with Wheelhouse's built-in blocks or with the plugin's own Svelte panel. There are no microfrontends, iframes or runtime-loaded bundles, and plugins cannot add slots.

| Slot            | About     | Where it shows                                                                                                           |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `project.tab`   | a project | its own page at `/projects/<id>/<plugin>/<tab>`, linked beside the project's name and on `/harbour?project=<id>`         |
| `harbour.card`  | a project | a card at the top of the project's Harbour section                                                                       |
| `task.section`  | a task    | a section right after the passage step named by `placement.step`, else by `placement.order` (default: after the passage) |
| `step.evidence` | a task    | under the passage step named by `placement.step`                                                                         |
| `bridge.card`   | the fleet | under a Firstmate reply in the chat that contains one of the card's URLs exactly                                         |

**Isolation.** Each provider call runs with a timeout (3 s by default, at most 10 s) and its result is cached for the provider's `ttlMs` (a failure for at most 15 s). A provider that throws, times out or returns something malformed becomes "Not available" with the reason, in its own entry only; the rest of the page and every other plugin render as usual. A plugin's own panel mounts in the browser inside an error boundary, so a panel that throws is contained too. Providers see copies of the fleet and read only through their context: `readFile` confined to the project clone or task worktree (at most 64 KiB), `exec` with an argument array, no shell, a minimal environment and bounded time and output (at most 8 MiB), and `changedFiles` for the files a task in scope changed against its base branch. There is no way to write, message Firstmate or control workers. Commands run with your permissions: read-only is the plugin's contract, reviewed in Wheelhouse's own pull requests, not a sandbox.

**Versions.** Every plugin declares the plugin contract it was written against (`apiVersion`). Wheelhouse loads the current contract (1) and, once there is a 2, the one before it; it refuses any other, with the reason in `/api/plugins`, and never downgrades silently. Blocks are versioned schemas (`text.v1`, `kv.v1`, `table.v1`, `links.v1`, `image.v1`, `status.v1`, `graph.v1`, the last a nodes-and-links placeholder until a chart renderer lands). A block Wheelhouse does not know renders as a plain fallback, plugin text is always text, and links and images keep only http(s) URLs and same-origin paths.

**Turning plugins on and off.** A plugin is on by default only if it says so: for every project (`enabledByDefault`), or only for projects whose clone has a given file (`enabledWhenFile`). Override that per plugin and per project in `plugins.json` in Wheelhouse's config directory (`$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`); a project's setting wins over the plugin's. Wheelhouse re-reads the file when it changes, and if it is invalid it keeps the defaults and reports why in `/api/plugins`.

```json
{ "plugins": { "project-links": { "enabled": true, "projects": { "firstmate": false } } } }
```

A plugin's `settings` object in the same file is handed to its providers as is (`ctx.settings`); each plugin documents its own.

### Docket

The Docket plugin draws a project's [docket](https://github.com/chrisjowen/team-memory) (the Markdown knowledge files under `.docket/`) as a read-only chart. It is on by default for projects whose clone has `.docket.yaml`, and reads the docket by running `docket graph --json` (docket's versioned graph export) in the project clone. It never writes to `.docket/`, and has no editing, asking or chat; "Open in docket" links out to docket's own viewer, next to the `docket open --root <path>` command that starts it.

- **Chart** (project tab, at `/projects/<id>/docket/chart`): the chart fills the window and fits itself to it, never shrinking past where its labels stay legible (it then scrolls in place); the details sit on the right in a resizable panel, as the Firstmate rail does on the home page: the vessels under way and the key, or what the docket records about the landmark you select. It draws owners' waters as bands with their flag, landmarks in dependency columns, environments as harbours on the coast, constraints as hatched restricted waters, and decisions as notices to mariners. A link is charted (solid) when evidence backs it, position approximate (dashed, PA) on some evidence, and existence doubtful (dotted, ED) when stated without evidence; a link to nothing the docket describes is unsurveyed. Each landmark shows when its evidence was last surveyed, faded after six months. Tasks under way are vessels on what they touch. Select a landmark to inspect its links and evidence.

The Chart is the plugin's only contribution: it adds no Harbour card and no task section. Its vessels come from a deterministic join: a changed file touches an exhibit when it is the `path` of evidence recorded on the exhibit or one of its links (a path ending in `/` covers a directory). An exhibit with no file evidence cannot be placed. Settings, all optional:

```json
{
	"plugins": {
		"docket": {
			"settings": {
				"bin": "/abs/path/to/docket",
				"roots": { "wheelhouse": "/abs/path/to/team-memory/examples/acme-platform" },
				"timeoutMs": 8000
			}
		}
	}
}
```

`bin` is the docket CLI (otherwise `docket` on `PATH`); a docket too old for `docket graph --json` is said plainly on the Chart. `roots` draws another docket for a project, such as docket's `examples/acme-platform`, until the project keeps its own; turn the plugin on for that project with `"projects": { "wheelhouse": true }`. `timeoutMs` bounds `docket graph` (at most 9500).

### Writing a plugin

1. Make `src/lib/plugins/<id>/plugin.server.ts` exporting a `WheelhousePlugin` (`src/lib/server/plugins/types.ts`), and add it to `BUILTIN_PLUGINS` in `src/lib/server/plugins/builtin.ts`. `src/lib/plugins/project-links/` is a complete example.

   ```ts
   export const myPlugin: WheelhousePlugin = {
   	apiVersion: PLUGIN_API_VERSION,
   	id: 'my-plugin', // lower-case letters, digits and dashes
   	name: 'My plugin',
   	version: '0.1.0',
   	providers: [
   		{
   			id: 'summary',
   			scope: 'project', // fleet | project | task: no wider than the slots it fills
   			ttlMs: 30_000,
   			async fetch(ctx) {
   				const readme = await ctx.readFile('README.md', { root: 'project', maxBytes: 8192 });
   				if (readme === null) return { available: false, reason: 'No README in the clone.' };
   				const blocks = [{ block: 'text.v1', text: readme.split('\n')[0] }];
   				return { available: true, value: blocks, source: 'the README', observedAt: null };
   			}
   		}
   	],
   	contributions: [
   		{
   			slot: 'project.tab',
   			id: 'readme',
   			title: 'README',
   			provider: 'summary',
   			render: { blocks: true }
   		}
   	]
   };
   ```

2. Read through the context only: `ctx.readFile`, `ctx.exec`, `ctx.changedFiles` and your `ctx.settings` (`src/lib/server/plugins/types.ts`). Return blocks (`render: { blocks: true }`; a `bridge.card` returns cards: `{ key, title, mentions: [url], blocks }`), or give the contribution `render: { component: '<id>/<panel>' }` and register a Svelte panel under that name in `src/lib/plugins/panels.ts`; it receives the provider's value as `data`. Keep provider values to plain JSON.
3. Use `when: 'provider-available'` to hide an entry quietly while its provider has nothing to show.
4. Test the provider through `PluginRegistry`, as `src/lib/plugins/project-links/plugin.test.ts` does. `src/lib/server/plugins/builtin.test.ts` checks that every compiled-in plugin loads and that its panels exist.

## Develop

```bash
npm ci
WHEELHOUSE_FIRSTMATE_DIR=~/firstmate WHEELHOUSE_HOME=~/crew npm run dev
```

In development Wheelhouse starts (or shows) the Firstmate session the same way, on its first request.

| Script               | Does                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run build`      | Builds the web app (`build/`) and the CLI (`dist/cli.js`)                                           |
| `npm run check`      | Type-checks the app (svelte-check) and the CLI (tsc)                                                |
| `npm run lint`       | Prettier and ESLint                                                                                 |
| `npm run format`     | Formats everything with Prettier                                                                    |
| `npm run test:unit`  | Unit tests: adapter, store, messenger, security, collector, plugins, the Firstmate session and chat |
| `npm run test:smoke` | Builds, then starts the CLI against a fake Firstmate home                                           |
| `npm test`           | Both                                                                                                |

The code is laid out as the spec describes: `src/routes` (UI and API), `src/lib/components`, `src/lib/server/firstmate` (the script adapter and data-source rules), `src/lib/server/collector` (polling and SSE), `src/lib/server/store` (message request ids and receipts), `src/lib/server/sessions` (the Firstmate session, its transcript and terminal), `src/lib/server/insights` (decisions made for you, where time went and the work-time estimate, Claude usage), `src/lib/chat` (how the transcript reads as a chat), and `cli/index.ts` (the Commander entry point). Plugins live in `src/lib/plugins` (the slot and block contract, panels, and each plugin) and `src/lib/server/plugins` (the registry and enablement).

### Stack choice: SvelteKit 2

Wheelhouse uses SvelteKit 2 with Svelte 5, Vite 7, Tailwind 4 and shadcn-svelte. The UI prototype ran on SvelteKit 3 and needed workarounds for shadcn-svelte: `#lib` aliases, a crash on `extends: "$app/tsconfig"`, and patched component state attributes. SvelteKit 2 works with shadcn-svelte's standard `$lib` aliases and components as generated, so this build pins it. Moving to SvelteKit 3 is a later, separate change once shadcn-svelte supports it cleanly.

## License

MIT
