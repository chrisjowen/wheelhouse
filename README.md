# Wheelhouse

A local companion to [Firstmate](https://github.com/kunchenguid/firstmate): a web UI and CLI for watching Firstmate's crew at work and talking to Firstmate.

**Status:** this release covers the "watch the crew" and "talk to Firstmate" slices of the [MVP spec](docs/spec.md). Wheelhouse shows the fleet: what needs you, what is under way and how far along it is, and what landed, with evidence for each task and the worker's read-only terminal output. On the Bridge you send messages to Firstmate and see whether each was delivered, whether Firstmate acknowledged it, and any reply it recorded. **New session** opens a fresh Claude Code session of your own in your terminal, to brainstorm an idea or think through a project, and hands the result to Firstmate when you are ready.

## Requirements

- Node.js 22 or newer, and npm.
- A Firstmate checkout and its operational home (the directory with `state/` and `data/`). Wheelhouse attaches to the Firstmate session already running there; it never starts, stops or reconfigures Firstmate.
- Whatever Firstmate's own scripts need (bash, python3, git).
- Optional: the GitHub CLI (`gh`), used to read a pull request's state and checks when Firstmate has no cached observation of it.
- Optional, for **New session**: `tmux` and Claude Code (`claude`) on your `PATH`. Without them Wheelhouse says so and the rest works as usual.

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

| Option                 | Default                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `--firstmate <dir>`    | the Firstmate checkout you are in                                       |
| `--home <dir>`         | `$FM_HOME`, else the Firstmate directory                                |
| `--port <n>`           | `4310`                                                                  |
| `--state-dir <dir>`    | see below                                                               |
| `--terminal <cmd>`     | see [Sessions](#sessions)                                               |
| `--tmux-socket <name>` | `$WHEELHOUSE_TMUX_SOCKET`, else `wheelhouse`; see [Sessions](#sessions) |
| `--no-browser`         | open the browser                                                        |

`wheelhouse` with no subcommand does the same as `wheelhouse open`.

`--state-dir` is where Wheelhouse keeps its own record of the messages it sent (request ids, bodies, delivery outcomes, receipts and the receipts cursor), one file per Firstmate home, and the scratch directories and records of [your sessions](#sessions) under `sessions/`. It defaults to `$WHEELHOUSE_STATE_DIR`, else `$XDG_STATE_HOME/wheelhouse`, else `~/.local/state/wheelhouse`, and must be outside the Firstmate home.

Wheelhouse checks that Firstmate's integration scripts declare the contracts it understands, starts its server on `127.0.0.1` only, and opens the browser. It answers only requests addressed to `127.0.0.1`, `localhost` or `[::1]`; any other `Host` gets a 421, which blocks DNS-rebinding pages. Every request that changes anything (sending a message, starting or re-opening a session) must also carry an `Origin` equal to the page's own `http://<host>` origin and this launch's session token, which Wheelhouse issues only to the pages it serves; anything else gets a 403. If the scripts look incompatible it still starts, says so in the UI and in `/api/health`, and shows what it can. Press Ctrl+C to close Wheelhouse; Firstmate and its crew keep running.

## What you see

- **Harbour** (`/`): a one-line watch report, then **Your move** (captain-held decisions and pull requests waiting for your review, each showing its screenshot count, the reported live preview link and the pull request link), **Waiting on Firstmate** (decisions a worker raised that Firstmate is handling), and each project's work as cards. A card names the work (its title without the project prefix), who is doing it (harness, model and worker name) and what they are doing **Now**, in plain words with its age: the validation step and fix round while a no-mistakes run works, else the latest status line, else the latest line of the worker's console. Work under way is led by the worker's live console (a bounded, read-only sample of the last lines, refreshed only while the card is on screen); finished work by its latest screenshot or a picture of the diff. A soft pulse on the current step shows a worker that is busy right now, and the card counts the files changed. A project switcher (`?project=`) scopes the page, and the **Passage** view (`?view=passage`) puts every task on one chart. An **Under way | Completed** toggle switches the cards between work still in progress (including what needs you) and landed or finished work, newest first (`?view=completed`); **Your move** shows only under Under way.
- **Task page** (`/tasks/<id>`): the task's passage, with the evidence each step produced: files changed, the validation run, the pull request and its CI checks, the report, screenshots and a reported preview. Screenshots open in an in-page viewer (Esc closes, the arrow keys step through them), and selecting a changed file shows its diff against the merge base. Status lines show in plain words, with the raw line behind a small **details** disclosure. While the work waits on your review, its screenshots, live preview link and pull request link come first, at the top of the page. Below that are the ship's log (history from Firstmate's fleet ledger) and the raw terminal output, which is read-only and sampled only while it is open (or, for work under way, while its console is on screen). **Ask Firstmate about this** opens the Bridge on that task's thread.
- **Bridge** (`/bridge`): the conversation with Firstmate, one thread at a time. `/bridge?task=<id>` is that task's thread: its title and status, the messages you sent about it and Firstmate's replies to them; `/bridge` is the general thread for messages not about one task. **Threads** switches between them, marking threads that need you and replies you have not seen, with the same **Under way | Completed** toggle (`?view=completed`); a dot on **Completed** shows it holds replies you have not seen. When the task is waiting on your decision, the thread opens with the question itself (the captain-hold reason from Firstmate's backlog), its options listed when the text gives `(a) … (b) …`; an option button starts your answer in the composer, and you can add to it or write your own. Every message sent in a task's thread goes to Firstmate with `Re: <task-id>` as the first line of its body. Each message you sent shows its delivery (delivered, saved but Firstmate not woken yet, uncertain, or not delivered with a Retry) and, separately, whether Firstmate acknowledged it. A reply Firstmate recorded with `fm-inbox.sh reply` appears as plain text; when it contains a pull request or reported preview URL that exactly matches another task, that task's card appears with it. The page fills the window with the composer pinned (Enter sends, Shift+Enter adds a line); the conversation scrolls without a visible scrollbar and follows the newest message, with **Jump to latest** when you scroll up.

- **Plugins** add to fixed places on these pages: a project tab (beside a project's name, and as a tab on the project's own view), a card in the project's Harbour section, a section on the task page, evidence under one passage step, and a card under a Bridge reply that links something the plugin knows. Wheelhouse ships two: **Project links** (off unless turned on in `plugins.json`): a project's repository, README and pull requests, the task's branch, and a compare link under the Pull request step; and **Docket** (on for projects with a `.docket.yaml`): a read-only chart of the project's docket. See [Plugins](#plugins).

- **Sessions** (`/sessions`): the Claude Code sessions you started from Wheelhouse, newest first, each with its project (or "Blank idea"), when it started, whether it is still running, **Open** (re-attach your terminal), a read-only **Preview** of its last lines, and **Hand to Firstmate**. See [Sessions](#sessions).

All messages go to Firstmate. There is no way to message a worker directly and no worker controls anywhere. The only write Wheelhouse makes to Firstmate is `fm-inbox.sh note`.

### Sessions

**New session** (in the header, and on each project's section of the Harbour) starts a fresh, interactive Claude Code session of your own, about a project or a blank idea, with an optional opening prompt. These are your sessions, not Firstmate's crew: Wheelhouse still cannot start, stop or steer a worker.

- Each session runs `claude` in a detached tmux session named `wh-session-<id>` on Wheelhouse's own tmux server (`tmux -L wheelhouse`; change the name with `--tmux-socket <name>` or `WHEELHOUSE_TMUX_SOCKET`), never the default server Firstmate and its crew use, so Wheelhouse cannot list, read or end their sessions. It runs in its own scratch directory, `<state-dir>/sessions/<id>/`, never inside the Firstmate home or a project checkout. Wheelhouse keeps its record of the session next to it, in `<state-dir>/sessions/<id>.json`.
- For a project, the project's checkout is attached for reading (`claude --add-dir <path>`), and a note appended to the session's system prompt instructs it that the project is for reading and brainstorming, not editing, and that notes belong in the scratch directory. This is an instruction, not enforced: `--add-dir` does not block edits, so Claude's usual permission prompts (or your Claude settings) are what stand between the session and the checkout.
- Everything runs as argument arrays: the prompt reaches `claude` as one argument, never through a shell.
- Wheelhouse then opens your terminal attached to it (`tmux -L wheelhouse attach-session -t =wh-session-<id>`). On macOS it uses Terminal through `osascript`. To use another terminal, or on other systems, pass `--terminal "<command>"` (or set `WHEELHOUSE_TERMINAL`): it is split on spaces and must include `{attach}` as its own word, which becomes the attach command's arguments; Wheelhouse refuses a command without it. For example `--terminal "wezterm start -- {attach}"`. If the terminal cannot be opened, the session keeps running and Wheelhouse shows the command to attach yourself.
- If `tmux` or `claude` is missing, Wheelhouse says so and starts nothing.
- The preview is a bounded `tmux capture-pane` sample, taken only while it is open. Nothing typed in the browser reaches the session; you type in your terminal. When a session ends, its scratch directory stays.
- **Hand to Firstmate** sends an ordinary Bridge message (the same idempotent send) whose body starts `Re: session <id>` and names the session's scratch directory, so Firstmate can read any notes the session left there.

### Passage steps

| Work  | Steps                                                            |
| ----- | ---------------------------------------------------------------- |
| Ship  | Queued → Building → Checks → Pull request → Your review → Landed |
| Scout | Queued → Scout → Report → Your call → Done                       |

The steps follow Firstmate's delivery mode: direct-PR work has no local Checks step, local-only work has no Pull request step, and with yolo on there is no Your review step because Firstmate merges the work itself. In no-mistakes mode the pipeline opens the pull request before CI runs, so CI checks appear under Pull request. Its CI monitor keeps running until the pull request merges, so an open, non-draft pull request whose checks are green moves to Your review (and **Needs your review**) even while that monitor is still working. Stage derivation lives behind one interface (`src/lib/server/firstmate/stages.ts`) so that per-project stage definitions can replace it later.

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
| CI readiness of a PR         | the no-mistakes CI monitor's log, `~/.no-mistakes/logs/<run>/ci.log`, tailed   |
| Validation step and round    | the newest step log in `~/.no-mistakes/logs/<run>/`, tailed                    |
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

| Endpoint                            | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `GET /api/health`                   | Compatibility, supervisor readiness, collector and messaging  |
| `GET /api/fleet`                    | Cached tasks, projects and staleness                          |
| `GET /api/tasks/:id`                | One task with its evidence and ledger history                 |
| `GET /api/tasks/:id/output?lines=n` | Bounded, read-only worker terminal output                     |
| `GET /api/tasks/:id/diff?path=...`  | One changed file's diff (only files in its changed list)      |
| `GET /api/tasks/:id/artifacts/...`  | A task's listed screenshots (nothing else is served)          |
| `GET /api/firstmate/messages`       | Messages sent through Wheelhouse, with receipts and replies   |
| `POST /api/firstmate/messages`      | Send `{ text, taskId? }` with an `Idempotency-Key` header     |
| `GET /api/events`                   | Server-sent events: `fleet`, `health` and `messages`          |
| `GET /api/plugins`                  | Plugins, their contract versions, and which projects use them |
| `GET /api/slots?project=`/`?task=`  | Plugin entries for one project or task (none: Bridge cards)   |
| `GET /api/sessions`                 | Your sessions, with whether each is still running             |
| `POST /api/sessions`                | Start a session: `{ projectId?, prompt? }`                    |
| `POST /api/sessions/:id/open`       | Re-open your terminal attached to a running session           |
| `GET /api/sessions/:id/preview`     | Bounded, read-only last lines of a session (`?lines=n`)       |

## Plugins

Plugins are "panels and providers": first-party code compiled into Wheelhouse. A provider reads data on the server; a contribution puts its output in one of the fixed slots below, drawn either with Wheelhouse's built-in blocks or with the plugin's own Svelte panel. There are no microfrontends, iframes or runtime-loaded bundles, and plugins cannot add slots.

| Slot            | About     | Where it shows                                                                                                           |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `project.tab`   | a project | a chip beside the project's name; a tab on `/?project=<id>`                                                              |
| `harbour.card`  | a project | a card at the top of the project's Harbour section                                                                       |
| `task.section`  | a task    | a section right after the passage step named by `placement.step`, else by `placement.order` (default: after the passage) |
| `step.evidence` | a task    | under the passage step named by `placement.step`                                                                         |
| `bridge.card`   | the fleet | under a Firstmate reply that contains one of the card's URLs exactly                                                     |

**Isolation.** Each provider call runs with a timeout (3 s by default, at most 10 s) and its result is cached for the provider's `ttlMs` (a failure for at most 15 s). A provider that throws, times out or returns something malformed becomes "Not available" with the reason, in its own entry only; the rest of the page and every other plugin render as usual. A plugin's own panel mounts in the browser inside an error boundary, so a panel that throws is contained too. Providers see copies of the fleet and read only through their context: `readFile` confined to the project clone or task worktree (at most 64 KiB), `exec` with an argument array, no shell, a minimal environment and bounded time and output (at most 8 MiB), and `changedFiles` for the files a task in scope changed against its base branch. There is no way to write, message Firstmate or control workers. Commands run with your permissions: read-only is the plugin's contract, reviewed in Wheelhouse's own pull requests, not a sandbox.

**Versions.** Every plugin declares the plugin contract it was written against (`apiVersion`). Wheelhouse loads the current contract (1) and, once there is a 2, the one before it; it refuses any other, with the reason in `/api/plugins`, and never downgrades silently. Blocks are versioned schemas (`text.v1`, `kv.v1`, `table.v1`, `links.v1`, `image.v1`, `status.v1`, `graph.v1`, the last a nodes-and-links placeholder until a chart renderer lands). A block Wheelhouse does not know renders as a plain fallback, plugin text is always text, and links and images keep only http(s) URLs and same-origin paths.

**Turning plugins on and off.** A plugin is on by default only if it says so: for every project (`enabledByDefault`), or only for projects whose clone has a given file (`enabledWhenFile`). Override that per plugin and per project in `plugins.json` in Wheelhouse's config directory (`$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`); a project's setting wins over the plugin's. Wheelhouse re-reads the file when it changes, and if it is invalid it keeps the defaults and reports why in `/api/plugins`.

```json
{ "plugins": { "project-links": { "enabled": true, "projects": { "firstmate": false } } } }
```

A plugin's `settings` object in the same file is handed to its providers as is (`ctx.settings`); each plugin documents its own.

### Docket

The Docket plugin draws a project's [docket](https://github.com/chrisjowen/team-memory) (the Markdown knowledge files under `.docket/`) as a read-only chart. It is on by default for projects whose clone has `.docket.yaml`, and reads the docket by running `docket graph --json` (docket's versioned graph export) in the project clone. It never writes to `.docket/`, and has no editing, asking or chat; "Open in docket" links out to docket's own viewer, next to the `docket open --root <path>` command that starts it.

- **Chart** (project tab): owners' waters as bands with their flag, landmarks in dependency columns, environments as harbours on the coast, constraints as hatched restricted waters, and decisions as notices to mariners. A link is charted (solid) when evidence backs it, position approximate (dashed, PA) on some evidence, and existence doubtful (dotted, ED) when stated without evidence; a link to nothing the docket describes is unsurveyed. Each landmark shows when its evidence was last surveyed, faded after six months. Tasks under way are vessels on what they touch. Select a landmark to inspect its links and evidence.
- **Waters this passage crosses** (task section, after Building): what the task's changed files touch, one step out along `depends_on`, `uses` and `deployed_to`, and the constraints and decisions that apply there.
- **Hazards ahead** (Harbour card): shown only while a task under way touches something a constraint applies to.

The join is deterministic: a changed file touches an exhibit when it is the `path` of evidence recorded on the exhibit or one of its links (a path ending in `/` covers a directory). An exhibit with no file evidence cannot be placed. Settings, all optional:

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

| Script               | Does                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `npm run build`      | Builds the web app (`build/`) and the CLI (`dist/cli.js`)                     |
| `npm run check`      | Type-checks the app (svelte-check) and the CLI (tsc)                          |
| `npm run lint`       | Prettier and ESLint                                                           |
| `npm run format`     | Formats everything with Prettier                                              |
| `npm run test:unit`  | Unit tests: adapter, store, messenger, security, collector, plugins, sessions |
| `npm run test:smoke` | Builds, then starts the CLI against a fake Firstmate home                     |
| `npm test`           | Both                                                                          |

The code is laid out as the spec describes: `src/routes` (UI and API), `src/lib/components`, `src/lib/server/firstmate` (the script adapter and data-source rules), `src/lib/server/collector` (polling and SSE), `src/lib/server/store` (message request ids and receipts), `src/lib/server/sessions` (the captain's tmux sessions), and `cli/index.ts` (the Commander entry point). Plugins live in `src/lib/plugins` (the slot and block contract, panels, and each plugin) and `src/lib/server/plugins` (the registry and enablement).

### Stack choice: SvelteKit 2

Wheelhouse uses SvelteKit 2 with Svelte 5, Vite 7, Tailwind 4 and shadcn-svelte. The UI prototype ran on SvelteKit 3 and needed workarounds for shadcn-svelte: `#lib` aliases, a crash on `extends: "$app/tsconfig"`, and patched component state attributes. SvelteKit 2 works with shadcn-svelte's standard `$lib` aliases and components as generated, so this build pins it. Moving to SvelteKit 3 is a later, separate change once shadcn-svelte supports it cleanly.

## License

MIT
