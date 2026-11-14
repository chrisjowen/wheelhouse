# Wheelhouse operations reference

Source-checked against Wheelhouse 0.5.0, main commit `75ab999`, on 2026-11-12. CLI, route, configuration and integration contracts are derived from this package’s source. Source file references identify implementations; line numbers refer to the original inventory snapshot and may drift. Use the installed version’s help when it differs. Examples use placeholders; use the running installation’s actual directories and URL.

## Reading this inventory

- **R**: reads application data; may refresh in-memory caches or run bounded read probes. Underlying Firstmate `fm-peek.sh` may invoke its guard and update volatile Firstmate banners (`docs/architecture.md:62`).
- **C**: check-only operation with local/network effects such as git fetch, temporary plugin inspection, helper execution, a forward or sandbox listener; not a pure disk read.
- **W**: changes persistent state, sends a message, types into an agent, starts/stops something, publishes, or executes a command. Do not infer safety from an HTTP GET alone.
- All tables describe supported calling contracts, not permission to perform the operations. Use the user's requested scope and the owning Firstmate home's rules. Secrets are handled by name; never print values or keys.

Contents: [CLI](#wheelhouse-cli), [vault](#wh-vault-cli), [config/state](#configuration-and-directories), [HTTP](#http-api), [other servers/pages](#other-http-and-websocket-surfaces), [passages](#passages), [plugins](#plugins-and-services), [MCP](#mcp-and-apps), [agent conventions](#firstmate-status-chat-and-inbox-contracts), [restart/update](#restart-and-upgrade), [Cloud/remotes](#cloud-and-remotes), [Shared review](#bundled-shared-review), [help evidence](#help-evidence).

## Wheelhouse CLI

`wheelhouse` runs the default `open` command. Node >=22 is required. Published executables are exactly `wheelhouse -> dist/cli.js` and `wh-vault -> dist/wh-vault.js` (`package.json:24`, build commands at `package.json:43`; `cli/index.ts:304`, `cli/vault/index.ts:8`). These are generated bundles, not extra management programs. No other dist executable is declared. `build/handler.js` is the adjacent SvelteKit server handler (`cli/index.ts:80`).

Root options: `-V, --version` and `-h, --help` (R); `help [command]` and each Commander's auto-generated `-h, --help` are R. Group commands also have `help [command]`. Exact installed help output is retained below.

| Invocation                                                             | Effect / output                                                                                                                                                                                                                               | Flags and defaults                                                                                                                                                                                                                                                                                                                                                    | Source                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `wheelhouse open` (or `wheelhouse`)                                    | W: locate Firstmate, compatibility check, launch loopback UI/watcher, start Firstmate if no owner; open browser; if no install, setup wizard                                                                                                  | `--firstmate <dir>` code checkout; `--home <dir>` operational home; `--port <n>` 4310, range 0..65535, 0 allocates; `--state-dir <dir>`; `--config-dir <dir>`; `--plugins-dir <dir>`; `--tmux-socket <name>` default env then tmux's default server; `--no-browser`; `--no-skip-permissions` starts Claude without dangerously-skip-permissions (skipping is default) | `cli/index.ts:114`, `cli/index.ts:309`                                  |
| `wheelhouse __server` (hidden, internal)                               | W: child HTTP server under `open`; not an independent restart command                                                                                                                                                                         | `--port <n>` default 4310                                                                                                                                                                                                                                                                                                                                             | `cli/index.ts:230`, `cli/index.ts:346`                                  |
| `wheelhouse plugin`                                                    | Management group; directory options apply to subcommands                                                                                                                                                                                      | `--plugins-dir <dir>`, `--config-dir <dir>`; pass the same directories as the running install                                                                                                                                                                                                                                                                         | `cli/plugin.ts:60`                                                      |
| `wheelhouse plugin list`                                               | R: installed ids, versions, enabled/load state, pinned commit and repository/ref                                                                                                                                                              | No own flags besides help                                                                                                                                                                                                                                                                                                                                             | `cli/plugin.ts:103`; implementation `src/lib/server/plugins/install.ts` |
| `wheelhouse plugin install <org/repo[@ref]>`                           | W: fetch, validate/review manifest, request settings, install at exact commit; restart all instances using same plugins dir                                                                                                                   | `-y, --yes`; repeatable `-s, --setting <key=value>`                                                                                                                                                                                                                                                                                                                   | `cli/plugin.ts:95`                                                      |
| `wheelhouse plugin update <id>`                                        | W: fetch original ref again or move ref, review and replace, restart                                                                                                                                                                          | `--ref <ref>`, `-y, --yes`, repeatable `-s, --setting <key=value>`                                                                                                                                                                                                                                                                                                    | `cli/plugin.ts:107`                                                     |
| `wheelhouse plugin remove <id>`                                        | W: remove installed directory/record, leave plugin settings, restart                                                                                                                                                                          | `-y, --yes` permits restart even mid-work                                                                                                                                                                                                                                                                                                                             | `cli/plugin.ts:116`                                                     |
| `wheelhouse plugin enable <id>`                                        | W: load installed plugin on next start, restart running instances                                                                                                                                                                             | `-y, --yes`                                                                                                                                                                                                                                                                                                                                                           | `cli/plugin.ts:123`                                                     |
| `wheelhouse plugin disable <id>`                                       | W: prevent loading, keep files, restart                                                                                                                                                                                                       | `-y, --yes`                                                                                                                                                                                                                                                                                                                                                           | `cli/plugin.ts:130`                                                     |
| `wheelhouse upgrade`                                                   | W: clean clone only; fast-forward origin default branch, `npm ci`, `npm run build`, restart                                                                                                                                                   | `--check` C: only check, may fetch git refs; `-y, --yes` upgrade/restart without asking; `--plugins-dir <dir>` discovers running instances                                                                                                                                                                                                                            | `cli/upgrade.ts:68`, `cli/upgrade.ts:115`                               |
| `wheelhouse gateway`                                                   | Discord messaging group                                                                                                                                                                                                                       | `--config-dir <dir>`                                                                                                                                                                                                                                                                                                                                                  | `cli/gateway.ts:107`                                                    |
| `wheelhouse gateway connect <channel>`                                 | W: set bot token via hidden input/stdin; validate bot and save Keychain or private file; print bot/invite info                                                                                                                                | Only supported channel `discord`; no token argument/flag                                                                                                                                                                                                                                                                                                              | `cli/gateway.ts:148`                                                    |
| `wheelhouse gateway on [channel]` / `off [channel]`                    | W: turn channel on/off; off neither receives nor sends                                                                                                                                                                                        | Channel defaults discord                                                                                                                                                                                                                                                                                                                                              | `cli/gateway.ts:185`                                                    |
| `wheelhouse gateway unbind [channel]`                                  | W: forget paired user; retain token                                                                                                                                                                                                           | Default discord                                                                                                                                                                                                                                                                                                                                                       | `cli/gateway.ts:205`                                                    |
| `wheelhouse gateway titles-only <on\|off> [channel]`                   | W: redact alert/decision bodies sent to phone, or restore full                                                                                                                                                                                | Default discord                                                                                                                                                                                                                                                                                                                                                       | `cli/gateway.ts:223`                                                    |
| `wheelhouse gateway status`                                            | R: token presence/location (never token), pairing, alerts, connection                                                                                                                                                                         | `--port <n>` default 4310, range 1..65535                                                                                                                                                                                                                                                                                                                             | `cli/gateway.ts:242`                                                    |
| `wheelhouse remote`                                                    | Wheelhouse Cloud group                                                                                                                                                                                                                        | `--config-dir <dir>`                                                                                                                                                                                                                                                                                                                                                  | `cli/remote.ts:130`                                                     |
| `wheelhouse remote connect`                                            | W: pair device, display code/fingerprint, wait for browser approval, keep device key                                                                                                                                                          | `--gateway <url>` remembered/default gateway; `--name <name>` defaults hostname                                                                                                                                                                                                                                                                                       | `cli/remote.ts:193`                                                     |
| `wheelhouse remote status`                                             | R: enabled/started, gateway, machine fingerprint, trusted passkeys, connection and relay sessions, never private key                                                                                                                          | No own flags                                                                                                                                                                                                                                                                                                                                                          | `cli/remote.ts:238`                                                     |
| `wheelhouse remote pins`                                               | R: trusted passkeys and pending re-pin (id, fingerprints); `approve <id>`/`reject <id>` W: decide it locally                                                                                                                                  | id required, prefix of 8+ chars                                                                                                                                                                                                                                                                                                                                       | `cli/remote.ts:349`                                                     |
| `wheelhouse remote disconnect`                                         | W: revoke device upstream and delete local key; report upstream failure if any                                                                                                                                                                | No own flags                                                                                                                                                                                                                                                                                                                                                          | `cli/remote.ts:275`                                                     |
| `wheelhouse remote on` / `off`                                         | W: enable/disable paired connector, keeping pairing; `on` alone does not start an unstarted page connector                                                                                                                                    | No own flags                                                                                                                                                                                                                                                                                                                                                          | `cli/remote.ts:293`                                                     |
| `wheelhouse remote run`                                                | W: keep outbound connector alive in foreground, pair first if needed, independent of page Start                                                                                                                                               | `--port <n>` 4310; `--gateway <url>` and `--name <name>` used if pairing needed                                                                                                                                                                                                                                                                                       | `cli/remote.ts:316`                                                     |
| `wheelhouse skills status\|sync\|diff\|accept\|keep\|adopt\|uninstall` | R (`status`, `diff`) / W: the installed agent skills as `<config>/agent-material/manifest.json` records them; `status --json` lists each item's state (current, missing, outdated, modified, kept, foreign, refused, off) and Firstmate drift | `--config-dir <dir>`; `accept`/`adopt`/`uninstall` ask first, `-y, --yes` skips the question                                                                                                                                                                                                                                                                          | `cli/skills.ts`; `src/lib/server/material/ops.ts`                       |

`--yes` is not a dry-run flag. Plugin removal/enabling/disabling mutates before a potentially busy restart question. Plugin install/update without a terminal refuses unless `--yes` is passed. Required settings without value/default still refuse with `--yes`; strings/list values can be supplied by `--setting`, booleans/numbers/options are validated (`cli/plugin.ts:28`, `src/lib/server/plugins/settings.ts`).

## wh-vault CLI

Global flags before the subcommand: `--config-dir <dir>`, `-V, --version`, `-h, --help`. `help [command]` and per-command help are R. The config dir resolution is shared with Wheelhouse; there is no `--project` override on `run`. Command definitions: `cli/vault/program.ts:112`.

| Invocation                                                     | Mode and result                                                                                                                 | Flags                                                                                                                                                                         | Source                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `wh-vault set <NAME>`                                          | W: store/replace one Keychain value from hidden prompt or stdin; new name has no grants; print name and grants only             | None                                                                                                                                                                          | `cli/vault/program.ts:185`                     |
| `wh-vault import <file>`                                       | W: parse dotenv and set each nonempty name; report line numbers for bad lines; print deletion advice but do not delete file     | None                                                                                                                                                                          | `cli/vault/program.ts:212`                     |
| `wh-vault list`                                                | R: names granted to caller project                                                                                              | `--all` every name/grant/set/last-use date; `--json` schema `wh-vault.list.v1`                                                                                                | `cli/vault/program.ts:274`                     |
| `wh-vault grant <NAME> <projects...>`                          | W: add project grants by id                                                                                                     | None                                                                                                                                                                          | `cli/vault/program.ts:367`                     |
| `wh-vault revoke <NAME> <projects...>`                         | W: remove project grants                                                                                                        | None                                                                                                                                                                          | `cli/vault/program.ts:371`                     |
| `wh-vault remove <NAME>`                                       | W: delete value and grants, audit it                                                                                            | None                                                                                                                                                                          | `cli/vault/program.ts:376`                     |
| `wh-vault run [--only NAME[,NAME] ...] -- <program> <args...>` | W: execute one command, inject granted secrets, mask exact values in stdout/stderr, audit use; no shell unless explicitly named | `--only <names>` comma-separated and repeatable; child options pass through after `--`                                                                                        | `cli/vault/program.ts:393`; `cli/vault/run.ts` |
| `wh-vault audit`                                               | R: newest-first log with names/project/task/program (without arguments)/outcome, never values                                   | `--project <id>`, `--task <id>`, `--name <name>`, `--event <run\|set\|remove\|grant\|revoke>`, `--limit <n>` default 50 positive integer, `--json` schema `wh-vault.audit.v1` | `cli/vault/program.ts:422`                     |

Caller project comes from `FM_TASK_ID` plus its `.meta` beside `FM_TASK_INBOX` (else under `FM_HOME`), then from origin repository name if no matching record. No project/no grants/ungranted `--only` refuses to launch (`cli/vault/caller.ts`, `docs/vault.md:65`). Native key backend is macOS login Keychain only, service `wheelhouse-vault`, account NAME. Name regex is environment-variable style, up to 128 characters; never put a value in command arguments, chat, report, plugin settings or status. Values over roughly 1900 bytes or requiring base64 may not fit (`docs/vault.md:34`). `run` masks exact values, not transformed/partial output or files. Same-user grants are an accident/prompt-injection limit, not an OS isolation boundary (`docs/vault.md:9`, `docs/vault.md:78`). Exit child status normally; 125 refused/unavailable, 126 cannot execute, 127 not found (`docs/vault.md:69`). Names/grants/audit reads do not retrieve values (`docs/vault.md:110`).

## Configuration and directories

Use the actual running directories. CLI and APIs can report them; do not assume the Firstmate home is the code checkout, or that editing Firstmate's own config changes Wheelhouse. Config and state must live outside the operational home (`cli/index.ts:147`). Paths below are defaults/placeholders, not user-specific.

| Surface                                                     | Resolve / format / effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Source                                                                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wheelhouse config dir                                       | `--config-dir` > `WHEELHOUSE_CONFIG_DIR` > `$XDG_CONFIG_HOME/wheelhouse` > `~/.config/wheelhouse`; file edits W                                                                                                                                                                                                                                                                                                                                                                                                                  | `src/lib/server/plugins/config.ts:35`; `cli/index.ts:115`                                                                                                                                                  |
| User management skill                                       | `$CLAUDE_CONFIG_DIR/skills/manage-wheelhouse`, else `~/.claude/skills/manage-wheelhouse`; also `~/.agents/skills/manage-wheelhouse` when Firstmate runs on codex/opencode/pi. Installed by open/setup and brought up to date on each server start (after an upgrade too). `WHEELHOUSE_MANAGE_SKILL=0` opts out. Edited copies are left with the new version in `<config>/agent-material/proposed/`; unowned copies and symlinks are left alone; never installed inside Firstmate checkout/home. `wheelhouse skills` settles them | `src/lib/server/material/`; `docs/guide.md`                                                                                                                                                                |
| Firstmate code/home                                         | code: `--firstmate` > nearest ancestor Firstmate checkout > remembered `firstmate`; home: `--home` > `FM_HOME` > remembered home only if using remembered code > code dir. Server env can name `WHEELHOUSE_FIRSTMATE_DIR` / `WHEELHOUSE_HOME`                                                                                                                                                                                                                                                                                    | `src/lib/server/firstmate/install.ts:128`; `src/lib/server/runtime.ts:183`                                                                                                                                 |
| `<config>/firstmate.json`                                   | `{ "firstmate": "/absolute/code/path", "home": "/absolute/home/path" }`; home optional. Wizard remembers through atomic rename; relative/invalid records ignored                                                                                                                                                                                                                                                                                                                                                                 | `src/lib/server/setup/remembered.ts:17`                                                                                                                                                                    |
| `<config>/plugins.json`                                     | `{ "plugins": { "<id>": { "enabled": true, "projects": { "<project>": false }, "settings": {} } } }`; project choice > global enabled > plugin default. Reread on mtime change; invalid file uses defaults/reports error; writes refuse invalid existing file                                                                                                                                                                                                                                                                    | `src/lib/server/plugins/config.ts:23`, `:93`, `:103`, `:192`                                                                                                                                               |
| `<config>/projects/<id>.yaml`                               | Captain-owned passage override, wins over repo passage, no requirement to commit; reloaded each minute                                                                                                                                                                                                                                                                                                                                                                                                                           | `src/lib/server/passages/sources.ts:111`                                                                                                                                                                   |
| `<home>/projects/<id>/.wheelhouse.yaml`                     | Repo passage read from `origin/HEAD`, else origin/main/master by git cat-file, not working tree. Editor writes working copy only                                                                                                                                                                                                                                                                                                                                                                                                 | `src/lib/server/passages/sources.ts:41`, `:83`; `docs/passages.md:5`                                                                                                                                       |
| Installed plugins dir                                       | `--plugins-dir` > `WHEELHOUSE_PLUGINS_DIR` > `~/.wheelhouse/plugins`; `<id>/` holds fetched plugin without git metadata; `installed.json` records repo/ref/commit/version/install time/enabled                                                                                                                                                                                                                                                                                                                                   | `src/lib/server/plugins/installed.ts:49`; `docs/plugins.md:282`                                                                                                                                            |
| `<plugins>/.running/<pid>.json`                             | W by server: `{pid,url,token}`, 0600 in 0700 folder. Restart control credential; read programmatically, never print                                                                                                                                                                                                                                                                                                                                                                                                              | `cli/running.ts:25`, `:33`                                                                                                                                                                                 |
| Bundled plugins dir                                         | Adjacent installed `plugins/`; CLI sets `WHEELHOUSE_BUNDLED_PLUGINS_DIR`; loader fallback resolves `plugins`                                                                                                                                                                                                                                                                                                                                                                                                                     | `cli/index.ts:184`; `src/lib/server/plugins/loader.ts:64`                                                                                                                                                  |
| `<config>/vault/vault.json`, `audit.jsonl`                  | 0600 under 0700 vault dir; names/grants/timestamps and audit events; values are in Keychain, never these files                                                                                                                                                                                                                                                                                                                                                                                                                   | `cli/vault/store.ts:12`, `:33`; `cli/vault/audit.ts`; `docs/vault.md:98`                                                                                                                                   |
| `<config>/gateway/settings.json`                            | Per Discord enabled/paired/alerts/titlesOnly. Keychain token preferred, else `<config>/gateway/discord.token` private fallback; never cat token files                                                                                                                                                                                                                                                                                                                                                                            | `src/lib/server/gateway/settings.ts:18`, `:58`, `:122`                                                                                                                                                     |
| `<config>/cloud/settings.json`, `device.key`, `status.json` | Paired device/public identity/enabled/started/gateway; device key in Keychain else private file; connector writes status (0600). Never print key                                                                                                                                                                                                                                                                                                                                                                                 | `src/lib/server/cloud/settings.ts:24`, `:174`                                                                                                                                                              |
| State dir                                                   | `--state-dir` > `WHEELHOUSE_STATE_DIR` > `$XDG_STATE_HOME/wheelhouse` > `~/.local/state/wheelhouse`                                                                                                                                                                                                                                                                                                                                                                                                                              | `src/lib/server/store/store.ts:54`                                                                                                                                                                         |
| `<state>/homes/<hash>/messages.json`                        | Per real operational home SHA256 first 16 hex; request ids, bodies, receipts cursor, replies/delivery; max 500 ordinary + 2000 change messages                                                                                                                                                                                                                                                                                                                                                                                   | `src/lib/server/store/store.ts:23`, `:72`                                                                                                                                                                  |
| Sibling per-home state                                      | `passage-consent.json`, `passage-reached.json`, `answered-decisions.json`, `chat-reactions.json`, `issue-watch.json`, `gateway.json`; server-managed, don't synthesize outcomes by editing                                                                                                                                                                                                                                                                                                                                       | `passages/consent.ts:35`, `passages/reached.ts:51`, `inbox/answered.ts:28`, `firstmate/reactions.ts:18`, `issues/watch.ts:230` under `src/lib/server/`; `runtime.ts:477`                                   |
| Other state                                                 | `firstmate/session-start.json` transcript SessionStart hook; `setup/claude` setup signin cwd; `uploads/` seven-day attachment retention; `gateway/discord.jsonl` audit; `services/` launch logs; `service-ports.json` per-home allocated ports; `plugins/shared-review/` desk                                                                                                                                                                                                                                                    | `src/lib/server/sessions/firstmate.ts:56`; `src/lib/server/setup/terminal.ts:42`; `src/lib/server/uploads.ts`; `src/lib/server/runtime.ts:295`, `:326`, `:490`; `plugins/shared-review/review/paths.mjs:1` |

Additional environment controls (read at launch; a change generally needs a restart): `WHEELHOUSE_TMUX_SOCKET` unset means tmux's default server; `WHEELHOUSE_SKIP_PERMISSIONS=0` retains Claude permission prompts; `WHEELHOUSE_RESTARTED=1` avoids starting Firstmate on child restart; `WHEELHOUSE_INSTALL_DIR` locates clone upgrade; `WHEELHOUSE_URL` links back to UI; `WHEELHOUSE_NO_GH=1` disables GitHub evidence/checks; `WHEELHOUSE_NO_USAGE=1` disables quota/transcript usage reads; `WHEELHOUSE_NM_LOGS_DIR`, `WHEELHOUSE_NM_EVIDENCE_DIR` redirect evidence; `CLAUDE_CONFIG_DIR` names Claude transcripts; `FM_SNAPSHOT_BUDGET` defaults 20; `WHEELHOUSE_PREVIEW_CLAUDE`, `WHEELHOUSE_PREVIEW_MODEL` select helper binary/model (sonnet); `WHEELHOUSE_SETUP_DRY_RUN=1`, `WHEELHOUSE_SETUP_REPOSITORY` are setup test/development hooks, not normal administration. Evidence: `src/lib/server/runtime.ts:101`, `:183`, `:534`; `src/lib/server/firstmate/scriptenv.ts`; `src/lib/server/previewhelper.ts:189`; `src/lib/server/setup/service.ts:74`. `BODY_SIZE_LIMIT` defaults to upload max plus 64 KiB in CLI child; route-specific caps still apply (`cli/index.ts:233`).

## HTTP API

Base defaults to `http://127.0.0.1:4310`; use the URL printed by the actual instance. Paths below use `<id>` as one URL-encoded path segment. Request bodies are JSON unless specified. No universal public MCP management endpoint exists.

All SvelteKit requests require loopback Host (`127.0.0.1`, localhost, [::1], optional port) or get 421. Every method other than GET/HEAD/OPTIONS requires BOTH `Origin: http://<actual Host>` and `x-wheelhouse-session: <this launch token>` or gets 403 (`src/hooks.server.ts:18`, `src/lib/server/session.ts:15`, `:56`). The page/layout supplies `sessionToken` (`src/routes/+layout.server.ts:13`); use it in-process, not logs. For scripted authorized changes it can be obtained through SvelteKit's served page data `/__data.json` (layout field `sessionToken`, serialized data format is framework-dependent); prefer CLI/file operations where available and don't scrape tokens into stdout. Reacquire after a restart. JSON body validation commonly returns 400/413/415, and unconfigured Firstmate returns 503. `GET /api/vault` is availability only, not a list.

The special CLI restart endpoint uses a DIFFERENT per-start Bearer token and bypasses SvelteKit; see restart section. Do not confuse it with `x-wheelhouse-session`.

The following tables enumerate every explicitly implemented SvelteKit HTTP method, with handler line references generated from this commit. SvelteKit additionally provides normal HEAD behavior for GET routes and framework method/OPTIONS responses; these are not extra management contracts. Error bodies usually `{message}`; SvelteKit `error()` may use its standard error response. JSON views/types are in `src/lib/types.ts`, `src/lib/inbox.ts`, `src/lib/setup.ts`, `src/lib/plugins/types.ts` and the linked server modules.

| Method/path                                    | Mode | Inputs                                                                                                                                              | Success output / effect                                                                                                                                       | Definition                                                         |
| ---------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/health`                              | R    | None                                                                                                                                                | Compatibility/version/install, supervisor readiness, collector/ledger/messaging/passages health                                                               | `src/routes/api/health/+server.ts:5`                               |
| `GET /api/fleet`                               | R    | None                                                                                                                                                | Fleet snapshot: generation/collection times, stale/reason, projects/tasks/secondMates/omissions                                                               | `src/routes/api/fleet/+server.ts:5`                                |
| `GET /api/insights`                            | R    | None                                                                                                                                                | Rail insights: recent decisions, today’s time, allowance                                                                                                      | `src/routes/api/insights/+server.ts:6`                             |
| `GET /api/events`                              | R    | None; SSE, close stream when finished                                                                                                               | SSE server {id}, fleet, health, messages, alerts on connect; later alert and settled plus collector changes; retry 3000 ms, heartbeat 15 s                    | `src/routes/api/events/+server.ts:24`                              |
| `GET /api/files`                               | R    | ?path=<allowed document-linked asset>                                                                                                               | Raw bounded image/text bytes under file-reader roots; sandbox CSP/nosniff; 404/503 as appropriate                                                             | `src/routes/api/files/+server.ts:11`                               |
| `GET /api/inbox`                               | R    | None                                                                                                                                                | Inbox view: available/reason/canAnswer/cards/answered                                                                                                         | `src/routes/api/inbox/+server.ts:9`                                |
| `POST /api/inbox`                              | W    | {cardId,choice: approve/fix/skip/close,note?,picks?,decided?}; Idempotency-Key; body <=16 KiB                                                       | {replay,message}; 201 new, 200 replay, 202 uncertain/sending. Sends Firstmate a note; close asks to resolve the exact key                                     | `src/routes/api/inbox/+server.ts:20`                               |
| `GET /api/inbox/report`                        | R    | ?card=<open card id>                                                                                                                                | text/plain Markdown named by card, only .md inside Firstmate data; 404 missing                                                                                | `src/routes/api/inbox/report/+server.ts:10`                        |
| `GET /api/firstmate/messages`                  | R    | None                                                                                                                                                | Messages view: last messages, receiptsAt/receiptsError/storeError, receipt replies/delivery                                                                   | `src/routes/api/firstmate/messages/+server.ts:13`                  |
| `POST /api/firstmate/messages`                 | W    | {text,taskId?}; Idempotency-Key; raw <=64 KiB, actual inbox note <=16 KiB (change requests reserve 1024 bytes)                                      | {replay,message}; 201 new/200 replay/202 pending. <task>@<mate> routes to that mate and returns {replay,secondMate:true,announced}, 201/200                   | `src/routes/api/firstmate/messages/+server.ts:23`                  |
| `GET /api/firstmate/chat`                      | R    | None; SSE                                                                                                                                           | SSE session, reset, records oldest first, synced; 15 s heartbeat                                                                                              | `src/routes/api/firstmate/chat/+server.ts:13`                      |
| `GET /api/firstmate/commands`                  | R    | None                                                                                                                                                | {commands}; Firstmate slash commands plus Claude built-ins                                                                                                    | `src/routes/api/firstmate/commands/+server.ts:8`                   |
| `POST /api/firstmate/input`                    | W    | {text}; bounded input                                                                                                                               | {sent:true}; types and submits to Wheelhouse-owned live Firstmate session                                                                                     | `src/routes/api/firstmate/input/+server.ts:13`                     |
| `POST /api/firstmate/pick`                     | W    | {signature,press:<integer>} OR {signature,submit:true}; <=4 KiB                                                                                     | {picked:true}; acts only on the exact current question/permission menu signature                                                                              | `src/routes/api/firstmate/pick/+server.ts:13`                      |
| `POST /api/firstmate/dismiss`                  | W    | No body required                                                                                                                                    | {closed:true}; Escape only if a Claude menu is open                                                                                                           | `src/routes/api/firstmate/dismiss/+server.ts:11`                   |
| `POST /api/firstmate/interrupt`                | W    | No body required                                                                                                                                    | {interrupted:true}; Escape to stop Firstmate work                                                                                                             | `src/routes/api/firstmate/interrupt/+server.ts:7`                  |
| `POST /api/firstmate/start`                    | W    | No body required                                                                                                                                    | Firstmate session view; 503 if unavailable, never starts a second lock owner                                                                                  | `src/routes/api/firstmate/start/+server.ts:10`                     |
| `GET /api/firstmate/reactions`                 | R    | None                                                                                                                                                | {liked:[message ids]}                                                                                                                                         | `src/routes/api/firstmate/reactions/+server.ts:8`                  |
| `POST /api/firstmate/reactions`                | W    | {id,on:<boolean>}; <=4 KiB                                                                                                                          | {liked,changed}; persistent thumbs-up state; 503 if state dir is in Firstmate home                                                                            | `src/routes/api/firstmate/reactions/+server.ts:20`                 |
| `POST /api/firstmate/uploads`                  | W    | Raw file bytes; raw application/octet-stream bytes, URI-encoded x-wheelhouse-filename and x-wheelhouse-filetype MIME; max25 MiB (attachments.ts:19) | 201 saved attachment descriptor; cleans expired uploads; does not send it by itself                                                                           | `src/routes/api/firstmate/uploads/+server.ts:14`                   |
| `GET /api/firstmate/uploads/[day]/[id]/[name]` | R    | Path segments identify stored upload                                                                                                                | Only sniffed PNG/JPEG/GIF/WebP/AVIF bytes, nosniff/sandbox; SVG/HTML/docs not served                                                                          | `src/routes/api/firstmate/uploads/[day]/[id]/[name]/+server.ts:12` |
| `GET /api/tasks/[id]`                          | R    | Task id (including task@mate)                                                                                                                       | Task detail: task/evidence/history/checks/docs; 404 absent                                                                                                    | `src/routes/api/tasks/[id]/+server.ts:5`                           |
| `GET /api/tasks/[id]/output`                   | R    | ?lines=<n>, default 40; local clamp 1..200; remote <=100                                                                                            | TaskOutput {available,reason,lines,capturedAt,requested}; bounded fm-peek; 3 concurrent samples max                                                           | `src/routes/api/tasks/[id]/output/+server.ts:33`                   |
| `GET /api/tasks/[id]/diff`                     | R    | ?path=<changed file>, nonempty <=1024 characters                                                                                                    | FileDiff or {available:false,reason}; only listed changed files; worktree gone is explicit                                                                    | `src/routes/api/tasks/[id]/diff/+server.ts:16`                     |
| `GET /api/tasks/[id]/artifacts/[...name]`      | R    | Evidence-listed screenshot name only                                                                                                                | PNG/JPEG/WebP/GIF bytes <=15 MiB; arbitrary files refused                                                                                                     | `src/routes/api/tasks/[id]/artifacts/[...name]/+server.ts:17`      |
| `GET /api/tasks/[id]/preview`                  | C    | Task id                                                                                                                                             | Preview check state/url/reason/embed availability; fetch loopback only; remote mate preview may open SSH forward                                              | `src/routes/api/tasks/[id]/preview/+server.ts:13`                  |
| `POST /api/tasks/[id]/preview/helper`          | C    | {turns,list}; JSON <=256 KiB; readRequest in src/lib/previewhelper.ts                                                                               | {reply,suggest}; one headless Claude run, no message sent; no helper for landed work                                                                          | `src/routes/api/tasks/[id]/preview/helper/+server.ts:15`           |
| `GET /api/previews/check`                      | C    | ?url=<loopback http(s) preview>; origin must have been shown by Wheelhouse                                                                          | Preview check with reportedAt:null; 400 invalid, 404 unseen origin, 503 unconfigured; does not probe arbitrary ports                                          | `src/routes/api/previews/check/+server.ts:19`                      |
| `GET /api/second-mates/[id]/peek`              | R    | ?lines=<n>, default 40; local <=200, remote <=100                                                                                                   | Bounded terminal look result; no steering; remote SSH 255 is offline                                                                                          | `src/routes/api/second-mates/[id]/peek/+server.ts:12`              |
| `GET /api/projects/[id]/passage`               | R    | Project id                                                                                                                                          | Project passage view: sources/errors/digests/stages/checks/consent                                                                                            | `src/routes/api/projects/[id]/passage/+server.ts:8`                |
| `POST /api/projects/[id]/passage/consent`      | W    | {digest:<64 lowercase hex sha256> OR null}; <=4 KiB                                                                                                 | Updated passage view; allow repository network checks only for reviewed file; 409 stale digest                                                                | `src/routes/api/projects/[id]/passage/consent/+server.ts:15`       |
| `POST /api/projects/[id]/passage/commands`     | W    | {digest:<commands sha256> OR null}; <=4 KiB                                                                                                         | Updated passage view; allow exact reviewed commands from either layer; 409 stale digest                                                                       | `src/routes/api/projects/[id]/passage/commands/+server.ts:13`      |
| `GET /api/projects/[id]/passage/file`          | R    | ?target=project/captain (default project)                                                                                                           | Editor view plus recent tasks available for testing; includes current text/base digest/default branch difference                                              | `src/routes/api/projects/[id]/passage/file/+server.ts:10`          |
| `PUT /api/projects/[id]/passage/file`          | W    | {target:project/captain,text,baseDigest:<sha256 or null>}                                                                                           | Updated editor + tasks; save only after strict validation; 409 concurrent edit, 422 invalid file; project target changes working copy only                    | `src/routes/api/projects/[id]/passage/file/+server.ts:29`          |
| `POST /api/projects/[id]/passage/draft`        | R    | {target:project/captain,text}; body <=2*64 KiB+4096                                                                                                 | Draft validation/effective passage, nothing saved; mutation authentication still required                                                                     | `src/routes/api/projects/[id]/passage/draft/+server.ts:8`          |
| `POST /api/projects/[id]/passage/test`         | W    | {target,text,taskId,commands?}; commands is exact reviewed list or null, max200                                                                     | Dry-run result per check and projected stages; 200 success/422 invalid. Nothing recorded, but command checks EXECUTE and may deploy                           | `src/routes/api/projects/[id]/passage/test/+server.ts:14`          |
| `GET /api/plugins`                             | R    | None                                                                                                                                                | Plugin registry view: supported contracts/config/installed/loaded/enabled/suggested/roles/errors                                                              | `src/routes/api/plugins/+server.ts:5`                              |
| `GET /api/slots`                               | R    | ?task=<id> OR ?project=<id> OR neither; both is400                                                                                                  | Resolved plugin slot entries including provider results; task/project/fleet scope                                                                             | `src/routes/api/slots/+server.ts:6`                                |
| `GET /api/services`                            | C    | ?plugin=<id>&service=<id>[&project=<id>]                                                                                                            | Companion service running/startability view; read-only health probes, does not start it                                                                       | `src/routes/api/services/+server.ts:20`                            |
| `POST /api/services`                           | W    | {plugin,service,project?}; <=4 KiB                                                                                                                  | Service view after launch/up/failure; 404 unknown; launch may install/build its declared dependencies                                                         | `src/routes/api/services/+server.ts:26`                            |
| `GET /api/plugins/updates`                     | C    | None                                                                                                                                                | Installed plugins’ cached update state, starts git ls-remote check if >6h old; pinned commit not checked                                                      | `src/routes/api/plugins/updates/+server.ts:11`                     |
| `POST /api/plugins/updates`                    | C    | None                                                                                                                                                | Force update check, same view; does not install                                                                                                               | `src/routes/api/plugins/updates/+server.ts:14`                     |
| `POST /api/plugins/inspect`                    | C    | {repo,ref?} OR {id,ref?}; <=4 KiB                                                                                                                   | Manifest/exact commit/settings/permissions preview; temporary fetch only; 422 invalid inspection                                                              | `src/routes/api/plugins/inspect/+server.ts:13`                     |
| `POST /api/plugins/install`                    | W    | {repo,ref?,commit,settings}; <=64 KiB                                                                                                               | Install outcome; refetched commit must equal preview; saves settings and restarts; 409 refused/concurrent change                                              | `src/routes/api/plugins/install/+server.ts:19`                     |
| `POST /api/plugins/[plugin]/update`            | W    | {ref?,commit,settings}; <=64 KiB                                                                                                                    | Update outcome then restart; exact inspected commit required; 409 refusal                                                                                     | `src/routes/api/plugins/[plugin]/update/+server.ts:19`             |
| `POST /api/plugins/[plugin]/load`              | W    | No body required                                                                                                                                    | Load outcome then restart; turns disabled installed plugin on; 409 cannot load/restart                                                                        | `src/routes/api/plugins/[plugin]/load/+server.ts:11`               |
| `GET /api/plugins/[plugin]/config`             | R    | Plugin id                                                                                                                                           | Plugin page including scopes/projects/settings;404 unknown                                                                                                    | `src/routes/api/plugins/[plugin]/config/+server.ts:12`             |
| `POST /api/plugins/roles`                      | W    | {role:"review.surface",provider:"<id>"/null}; <=4 KiB                                                                                               | Choose the review surface plugin (must be loaded, provide the role and be on) or null for built-in; no restart; reinstalls this skill                         | `src/routes/api/plugins/roles/+server.ts`                          |
| `POST /api/plugins/[plugin]/config`            | W    | ONE of {enabled:true/false/null}, {project,enabled:true/false/null}, {settings:{...}}; <=64 KiB                                                     | Updated plugin page; global boolean clears project overrides, null removes global choice and keeps them; no restart;409 invalid current config                | `src/routes/api/plugins/[plugin]/config/+server.ts:27`             |
| `GET /api/plugins/[plugin]/ui/[...path]`       | R    | Manifest UI-directory relative file                                                                                                                 | Whitelisted JS/MJS/CSS/JSON/map/image/font bytes; traversal/outside paths404                                                                                  | `src/routes/api/plugins/[plugin]/ui/[...path]/+server.ts:25`       |
| `GET /api/plugins/[plugin]/icon/[icon]`        | R    | Contribution id plus manifest image extension                                                                                                       | Only declared nav-page icon bytes; svg CSP/no scripts;404 mismatch                                                                                            | `src/routes/api/plugins/[plugin]/icon/[icon]/+server.ts:13`        |
| `POST /api/plugins/[plugin]/feedback`          | W    | {taskId,subject?,items:[{text,points?}]}; Idempotency-Key; <=64 KiB                                                                                 | {replay,message},201/200/202; feedback capability required; one attributed task note                                                                          | `src/routes/api/plugins/[plugin]/feedback/+server.ts:18`           |
| `POST /api/plugins/[plugin]/feedback/summary`  | C    | Same list body as feedback, no idempotency required                                                                                                 | {points:[{text,points,from}]}; headless Claude summary sends nothing                                                                                          | `src/routes/api/plugins/[plugin]/feedback/summary/+server.ts:17`   |
| `GET /api/wheelhouse/update`                   | C    | None                                                                                                                                                | Selected-source update state and upgrade progress; background check if >6h (may fetch git refs)                                                               | `src/routes/api/wheelhouse/update/+server.ts:12`                   |
| `POST /api/wheelhouse/update`                  | C    | None                                                                                                                                                | Check now/reset failed-upgrade display; same view; no upgrade                                                                                                 | `src/routes/api/wheelhouse/update/+server.ts:15`                   |
| `POST /api/wheelhouse/upgrade`                 | W    | No body required                                                                                                                                    | 202 update/progress view; npm release install or clone fast-forward/build, then restart;409 change busy/no watcher                                            | `src/routes/api/wheelhouse/upgrade/+server.ts:11`                  |
| `POST /api/wheelhouse/source`                  | W    | `{source:"published"}` or `{source:"github"}`                                                                                                       | 200 update view after reinstall/relink and restart; 400 invalid input, 409 busy/unavailable/no watcher                                                        | `src/routes/api/wheelhouse/source/+server.ts`                      |
| `GET /api/vault`                               | R    | None                                                                                                                                                | {canStore,reason}; no secret names/values                                                                                                                     | `src/routes/api/vault/+server.ts:15`                               |
| `POST /api/vault`                              | W    | {action:set,name,value,projects?,replace?} OR {action:grant/revoke,name,projects} OR {action:remove,name}                                           | {message,secrets,observedAt}; names/grants/dates only. replace:false gives409 if exists;503 no supported Keychain                                             | `src/routes/api/vault/+server.ts:35`                               |
| `GET /api/gateway`                             | R    | None                                                                                                                                                | Channel view with connected/bot/paired/alerts/pairing presence; never bot token                                                                               | `src/routes/api/gateway/+server.ts:14`                             |
| `POST /api/gateway`                            | W    | {channel:discord,action:pair/cancel-pairing/unbind/on/off/alerts/titles-only,alerts?,titlesOnly?}; <=4 KiB                                          | {view,pairing:{code,expiresAt} or null}; alerts kinds pr-green/question/stuck/landed; token set only via CLI                                                  | `src/routes/api/gateway/+server.ts:24`                             |
| `GET /api/cloud`                               | R    | Local caller only; relay403                                                                                                                         | Remote starter view with pairing/device/connector; never private key                                                                                          | `src/routes/api/cloud/+server.ts:19`                               |
| `POST /api/cloud`                              | W    | {action:start/stop/disconnect/gateway(+gateway)/approve-pins/reject-pins(+id)}; <=4 KiB; local-only                                                 | {view,note}; start pairs if needed; stop cancels/off; disconnect revokes/deletes; gateway change409 while paired/pairing; pins id409 if stale                 | `src/routes/api/cloud/+server.ts:32`                               |
| `GET /api/cloud/previews`                      | R    | None                                                                                                                                                | {ports:[reported allowed preview ports]} for connector                                                                                                        | `src/routes/api/cloud/previews/+server.ts:7`                       |
| `GET /api/setup`                               | R    | Local computer only; relay403                                                                                                                       | Setup wizard view                                                                                                                                             | `src/routes/api/setup/+server.ts:35`                               |
| `POST /api/setup`                              | W    | {action,...}; <=16 KiB; see action subtable below; local-only                                                                                       | Action-specific view/result;409 action refused; no universal dry-run guarantee                                                                                | `src/routes/api/setup/+server.ts:40`                               |
| `POST /api/apps/[op]`                          | W    | op=chat/open/run/call/read; app ref plus op inputs (MCP section); <=256 KiB                                                                         | AppOpenView / AppCallView / chat-app matches;404 no app/op;409 confirm,403 refused,502 MCP failure. Calls can execute tools; open may create sandbox listener | `src/routes/api/apps/[op]/+server.ts:40`                           |

### Setup action details

All use `POST /api/setup`, the common authentication above, and `{action,...}`. Definitions: `src/routes/api/setup/+server.ts:13`, action dispatch at line 47; outputs/types in `src/lib/setup.ts:16` and service implementations in `src/lib/server/setup/service.ts`.

| action          | Inputs besides action | Mode / output                                                                                                                                                                                                             |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect`       | `dir`                 | R: location inspection: new, empty, valid Firstmate, occupied                                                                                                                                                             |
| `clone`         | `dir`                 | W: clone Firstmate into new/empty directory, remember and select; location result                                                                                                                                         |
| `use`           | `dir`                 | W: select existing valid checkout, remember; location result                                                                                                                                                              |
| `tools`         | None                  | C: Firstmate detect-only bootstrap report; no dependency installation                                                                                                                                                     |
| `install`       | `tool`                | W: one allowed install from bootstrap report; result/report                                                                                                                                                               |
| `agent-choose`  | `agent,auth,provider` | W: keep the agent (claude, codex, pi) and how it is paid for in harness.json; may restart Wheelhouse                                                                                                                      |
| `agent`         | None                  | R: installed/signed-in status of the chosen agent (also `claude`)                                                                                                                                                         |
| `agent-install` | None                  | W: npm install the chosen agent, result (also `claude-install`)                                                                                                                                                           |
| `agent-test`    | None                  | C: tiny noninteractive run of the chosen agent; closes sign-in terminals (also `claude-test`)                                                                                                                             |
| `agent-key`     | `value,replace?`      | W: API key into the vault as `WHEELHOUSE_AGENT_<PROVIDER>_API_KEY` (no project grants), then the agent's own sign-in with it; never echoed. A name already there is kept and answered `exists:true` unless `replace:true` |
| `check`         | None                  | C: Firstmate bootstrap/readiness and Wheelhouse compatibility/environment checks                                                                                                                                          |
| `plugins`       | None                  | R: suggested plugins                                                                                                                                                                                                      |
| `plugin`        | `id,on:<boolean>`     | W: global bundled plugin choice in plugins.json                                                                                                                                                                           |
| `finish`        | None                  | W: start Firstmate session, finish result                                                                                                                                                                                 |

### Authenticated request recipe

For authorized API mutations, avoid echoing credentials. This Node 22 snippet loads the served layout's devalue token in memory and defines an authenticated request helper. Supply `WH_URL` with the actual base URL; fallback is Wheelhouse's default. It performs only a GET unless the caller adds an explicitly intended `change(...)` call. Serialization is SvelteKit-specific; if the format changes, use the page or inspect the loader, not a guessed token.

```js
const base = new URL(process.env.WH_URL || 'http://127.0.0.1:4310');
const doc = await (await fetch(new URL('/__data.json', base))).json();
let session;
for (const node of doc.nodes || []) {
	const data = node?.data;
	if (Array.isArray(data) && Number.isInteger(data[0]?.sessionToken))
		session = data[data[0].sessionToken];
}
if (typeof session !== 'string' || !session) throw new Error('No layout session token');
async function change(route, method, body, requestId) {
	const response = await fetch(new URL(route, base), {
		method,
		headers: {
			Origin: base.origin,
			'x-wheelhouse-session': session,
			'Content-Type': 'application/json',
			...(requestId ? { 'Idempotency-Key': requestId } : {})
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	if (!response.ok) throw new Error(`Wheelhouse ${response.status}: ${await response.text()}`);
	return response;
}
```

Do not print the full page data, which contains both token and private fleet/chat metadata. Restart credentials below come from a different source.

## Other HTTP and WebSocket surfaces

### CLI server interception

| Surface                                             | Mode / protocol                                              | Inputs and outputs                                                                                                                                                                                                            | Definition                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/wheelhouse/restart`                       | R, special CLI route                                         | `Authorization: Bearer <record.token>` from matching `.running/<pid>.json`; returns `{busy:[descriptions]}`;403 wrong/missing token,405 unsupported method                                                                    | `cli/running.ts:57`                                                                                |
| `POST /api/wheelhouse/restart`                      | W                                                            | Same Bearer header, no body;202 text `restarting\n`, then child exit75 and watcher restarts same port/options                                                                                                                 | `cli/running.ts:77`; `cli/index.ts:238`                                                            |
| WebSocket `/api/firstmate/terminal`                 | W: live tmux client/PTY                                      | loopback Host, matching Origin, protocols `wheelhouse.terminal.v1` and `wheelhouse.token.<sessionToken>`; output binary frames; input JSON `{type:"input",data}` or `{type:"resize",cols,rows}`; only session Wheelhouse owns | `src/lib/terminal.ts:9`; `src/lib/server/sessions/terminal.ts:14`, `:125`                          |
| WebSocket `/api/setup/terminal`                     | W: private agent sign-in PTY (`claude`, `codex login`, `pi`) | Same terminal protocol/auth plus local caller/no Cloud relay; setup cwd `<state>/setup/claude`; close destroys this sign-in PTY, not Firstmate                                                                                | `src/lib/setup.ts` (`SETUP_TERMINAL_PATH`); `src/lib/server/setup/terminal.ts:10`                  |
| Plugin host templates on Wheelhouse port            | R/W depends plugin                                           | `<port>.localhost` or template ending .localhost; full HTTP path/response/WS handled by plugin; mutations/WS require that host's matching Origin, no Wheelhouse page token granted                                            | `src/lib/server/hostroutes/router.ts`; `src/lib/server/plugins/types.ts:79`; `docs/plugins.md:172` |
| MCP app sandbox `GET /sandbox.html?host=&csp=&sig=` | C on first app open, then R serving HTML                     | Separate ephemeral loopback port per declared MCP server/project; HMAC-signed policy, only specified Wheelhouse origin may frame; not a management API                                                                        | `src/lib/server/apps/sandbox.ts:7`, `:25`, `:91`                                                   |

The Cloud connector can relay HTTP/WS to the UI and allowlisted preview ports; it is an outbound client, not an extra local listening management port. Optional plugin services can expose their own HTTP routes (Shared review below). The repository cannot enumerate routes of externally installed plugins; discover their manifests/docs and service view.

### Pages and SvelteKit data loaders

Each path below is GET/HEAD (R unless it subsequently launches a helper/service through an action). They serve HTML, and SvelteKit `/<path>/__data.json` transports the corresponding loader data. No `export const actions` form-action mutations were found; UI changes use APIs above. All page loaders also receive the shared layout's fleet/health/inbox/addressRewrites/pullRequestTabs/remote/sessionToken (`src/routes/+layout.server.ts:13`). Avoid dumping loader responses.

| Page                            | Inputs / contents                                                                                                                                                                                                    | Source                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `/`                             | Firstmate chat, rail insights/fleet slots; `?decision=<card>` opens discussion, task references via composer                                                                                                         | `src/routes/+page.server.ts:7`; `docs/guide.md:106`                                   |
| `/deck`                         | Same rail insights/fleet slots                                                                                                                                                                                       | `src/routes/deck/+page.server.ts:6`                                                   |
| `/harbour`                      | `?view=passage/radar`, `?project=<id>` charts; default project cards; `?show=needs-you/held-up/under-way/quiet` is UI filtering; omit for all (values `src/lib/berths.ts:27`); non-chart project query307 to project | `src/routes/harbour/+page.server.ts:9`; `src/routes/harbour/+page.svelte`             |
| `/projects`                     | 307 to `/harbour`                                                                                                                                                                                                    | `src/routes/projects/+server.ts:5`                                                    |
| `/projects/<id>`                | Work, `?view=completed`, saved browser/cookie layout; repo link/project slots                                                                                                                                        | `src/routes/projects/[id]/+page.server.ts:9`                                          |
| `/projects/<id>/<plugin>/<tab>` | Project plugin contribution, optional plugin-specific queries (PR tab `?pr=<encoded URL>`)                                                                                                                           | `src/routes/projects/[id]/[plugin]/[tab]/+page.server.ts:8`                           |
| `/projects/<id>/passage`        | Passage sources/stages/checks/consent and project tabs                                                                                                                                                               | `src/routes/projects/[id]/passage/+page.server.ts:9`                                  |
| `/projects/<id>/passage/edit`   | `?file=captain` else project; editor data/tasks                                                                                                                                                                      | `src/routes/projects/[id]/passage/edit/+page.server.ts:4`                             |
| `/tasks/<id>`                   | Task detail and plugin task slots; `?tab=timeline/preview/changes/docs/screenshots` and legacy tab mapping; full preview `&full=1`                                                                                   | `src/routes/tasks/[id]/+page.server.ts:6`; `docs/guide.md:109`                        |
| `/tasks/<id>/doc`               | `?path=<listed doc>` <=1024 chars; only task Docs entries; doc/task/problem output                                                                                                                                   | `src/routes/tasks/[id]/doc/+page.server.ts:7`                                         |
| `/tasks/<id>/review`            | 307 to project plugin PR review tab else GitHub; no PR redirects to task; no built-in review mutation API remains                                                                                                    | `src/routes/tasks/[id]/review/+server.ts:8`                                           |
| `/files`                        | `?path=<markdown>` relative to operational home or allowed absolute root; doc/problem; text up to1 MiB; asset endpoint15 MiB; named and real path must stay inside roots                                             | `src/routes/files/+page.server.ts:6`; `src/lib/server/files/docfile.ts:7`, `:24`      |
| `/inbox`                        | Current escalated decisions from layout; handled-by-Firstmate view from loader                                                                                                                                       | `src/routes/inbox/+page.server.ts:5`                                                  |
| `/decisions`                    | Recorded calls made for user                                                                                                                                                                                         | `src/routes/decisions/+page.server.ts:4`                                              |
| `/headroom`                     | Claude usage/allowance view                                                                                                                                                                                          | `src/routes/headroom/+page.server.ts:4`                                               |
| `/time`                         | Time breakdown/estimates view                                                                                                                                                                                        | `src/routes/time/+page.server.ts:4`                                                   |
| `/second-mates`, `/more`        | Browser pages using shared layout fleet/navigation                                                                                                                                                                   | `src/routes/second-mates/+page.svelte:1`; `src/routes/more/+page.svelte:1`            |
| `/settings`                     | 307 to gateway                                                                                                                                                                                                       | `src/routes/settings/+page.server.ts:5`                                               |
| `/settings/gateway`             | Gateway view                                                                                                                                                                                                         | `src/routes/settings/gateway/+page.server.ts:4`                                       |
| `/settings/update`              | Update source selection, install and progress                                                                                                                                                                        | `src/routes/settings/update/+page.server.ts`                                          |
| `/remotes`, `/settings/cloud`   | Same remotes page data, local-only controls                                                                                                                                                                          | `src/routes/remotes/+page.server.ts:4`; `src/routes/settings/cloud/+page.server.ts:4` |
| `/setup`, `/settings/setup`     | Setup wizard/return to setup; `/setup` explicitly refuses nonlocal/relay                                                                                                                                             | `src/routes/setup/+page.server.ts:7`; `src/routes/settings/setup/+page.server.ts:4`   |
| `/settings/plugins`             | Registry plus per-plugin configuration pages                                                                                                                                                                         | `src/routes/settings/plugins/+page.server.ts:6`                                       |
| `/settings/plugins/<plugin>`    | Plugin view and `canRestart`;404 absent                                                                                                                                                                              | `src/routes/settings/plugins/[plugin]/+page.server.ts:6`                              |
| `/plugins`                      | 307 to `/settings/plugins`                                                                                                                                                                                           | `src/routes/plugins/+page.server.ts:5`                                                |
| `/plugins/<plugin>/<page>`      | Fleet/nav-page slots plus suggested install metadata                                                                                                                                                                 | `src/routes/plugins/[plugin]/[page]/+page.server.ts:7`                                |

Legacy HTML links like `/harbour?task=<id>` redirect307 to `/tasks/<encoded id>`; API/plugin/task paths and data requests keep their query (`src/lib/server/oldlinks.ts:8`). No Firstmate configured opens `/setup` for normal pages (`src/hooks.server.ts:29`). `_app/*`, static fonts/icons and frontend bundles are SvelteKit/static resources, not operation endpoints.

## Passages

Authoritative guide: `docs/passages.md:1`; parser `src/lib/server/passages/schema.ts:5`, reader `sources.ts:7`, layering `resolve.ts`, scheduler `scheduler.ts`, engine `engine.ts`, editor `editor.ts`. The built-in `ship` passage is Queued → Building → Checks → Pull request → Your review → Landed; direct-PR skips local Checks, local-only skips PR, yolo-on skips Your review. A project whose default-branch `package.json` has a `name`, is not private, and has no `publishConfig.registry` other than registry.npmjs.org also gets Released (a `v*` GitHub release contains the merge commit) → On npm (that version is on the registry) after Landed, unless a passage file declares its own `github.release`/`npm.published` check or the `released`/`on-npm` steps (`docs/passages.md#released-and-on-npm`). `scout` is Queued → Scout → Report → Your call → Done (`builtin.ts:5`).

A captain-owned `<config>/projects/<id>.yaml` is the intended way to add a Deployed step without committing to the project. Layer order: built-in < repository `.wheelhouse.yaml` on the remote-tracking default branch of Firstmate's project clone < captain file. Both overlays re-read every minute. Bad layers are excluded and errors displayed; valid lower layers still render. No special Firstmate config directory is read.

Minimal captain passage:

```yaml
version: 1
extends: ship
checks:
  production:
    type: github.deployment
    environment: Production
    ref: merge.commit
stages:
  - id: deployed
    label: Deployed
    after: landed
    reached_when: production.success
    failed_when: production.failure
    evidence: ['check:production']
    primary_link: production.url
    give_up_after: 24h
headline:
  live: deployed
```

Replace the environment with the actual GitHub deployment environment, not a presumed provider-specific name. Captain network checks need no repository file consent, but command checks always need their own consent. Editing a file that already contains allowed commands may change behavior immediately or revoke the commands depending on digest; inspect first.

File schema: `version:1`, optional `extends:ship/scout` (defaults ship), captain-only `project` if present must match id, `checks` mapping, `stages` ordered array, optional `headline.live`. Stage fields: `id,label,short,after,column,reached_when,skip_when,skip_note,failed_when,evidence,primary_link,give_up_after,note`. Built-in ids may change presentation/evidence/link/note, not movement/conditions/removal. Added ids may be placed after another; `column` aligns chart. IDs match lower-case letter then letters/digits/dashes, <=40 chars. Unknown fields/references/outcomes, cycles and invalid cross-check dependencies fail strict validation; max file64 KiB, checks16, stages24, condition depth8 (`schema.ts:93`, `:163`, `:188`, `:721`).

Conditions: a fact or `<check>.<outcome>`, `{all:[...]}`, `{any:[...]}`, `{not:...}`, `{mode:<delivery mode>}`, `{yolo:on/off}`. YAML `on`/`off` can be quoted to avoid parser ambiguity. Facts: `task.live, backlog.queued, backlog.done, nm.run, pr.recorded, pr.ready, crew.done, merged, hold.captain, report.present`. Evidence: `queue,progress,files,validation,pr,report,screenshots,preview,decision,landed` or `check:<id>`. Notes are text or `{when,text}`. `primary_link:<check>.url`. No arbitrary expressions, shell interpolation or templating (`docs/passages.md:74`; `src/lib/passage-meta.ts`).

| Check type          | Exact fields beyond common label/interval                                                                                 | Outcomes                                                                          | Mode        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------- |
| `github.deployment` | `environment`, `ref:pr.head/merge.commit`, optional `repo:owner/name`                                                     | success, failure, in_progress, inactive, absent (inactive also satisfies success) | R network   |
| `github.workflow`   | `workflow` filename/id, `ref`, optional event/repo                                                                        | success, failure, in_progress, absent                                             | R network   |
| `github.release`    | `contains:merge.commit/pr.head`, optional tag_pattern/repo                                                                | included, not_yet                                                                 | R network   |
| `npm.published`     | `package`, `version_from:<release-check-id>`                                                                              | published, latest, absent                                                         | R network   |
| `http`              | `url`, optional method GET/HEAD, expect `{status,json_pointer,equals}`; captain-only `headers_from_env:{Header:ENV_NAME}` | ok, mismatch, error                                                               | R network   |
| `git.contains`      | `repo:firstmate-root/project-clone`, `commit:merge.commit/pr.head`, optional ref                                          | yes,no                                                                            | R local     |
| `status.note`       | `prefix:preview`                                                                                                          | present,absent                                                                    | R local     |
| `command`           | `run:[program,args...]`, optional cwd/timeout/env/when/ref                                                                | passed,failed                                                                     | W execution |

All defined in `schema.ts:46`; exact outcomes `src/lib/passage-meta.ts`, `docs/passages.md:80`. `equals` accepts merge.commit/pr.head/task.id or literal. Common interval >=30s (up to24h); GH deployment/workflow/HTTP default60s, release/npm5m, command10m. Default repo is PR repo then clone origin. Checks run in background, observational concurrency2; terminal success cached, no checks after landing30d, give_up_after can stop sooner. Reached stages persist across restart. Unknown/error/timeout does not count as a negative observation, including under `not`; a later failed stage can become current/red without a Needs-you item. HTTP restricts scheme, redirects3, timeout10s, body64 KiB, no cookies; env headers drop on cross-origin redirects. `git.contains` uses no-optional-locks merge-base --is-ancestor; GH calls fixed GET queries. `WHEELHOUSE_NO_GH=1` disables GH reads (`docs/passages.md:94`).

Command checks are operational programs, including possible deploys, even when invoked through the editor's Test. They run directly without shell, fresh temporary pinned checkout, no node_modules or untracked .env; scripts must install dependencies themselves. `cwd` relative, no .. or escaping symlink; default timeout5m/max60m; `env` passes named variables from Wheelhouse's environment plus fixed basic vars and WHEELHOUSE_TASK_ID/PROJECT/COMMIT. `when` uses Firstmate facts only; use `merged` plus `ref:merge.commit` for after-merge deploy. No ref uses default branch tip. Separate single command queue; one run per check/commit at once; passes final, failures retried by interval, old tasks landed before consent excluded; last16 KiB output kept (`docs/passages.md:103`). Never infer that enabling commands reviewed repository script content forever: consent covers command arguments, while script content can change at future merged commits.

Editing workflow: GET passage + GET file target; POST draft to validate; review diff; PUT file with unchanged baseDigest (null for new file); inspect effective view after reload. Repository target saves to clone working tree but takes effect only when committed to the branch read by `sources.ts`, not immediately. Captain target takes effect within a minute. Review actual command list before command digest consent; repository network consent is file-sha-specific and invalidated on any change. The editor Test executes checks once without recording reached state; don't use it as a harmless syntax check. Use draft for that (`docs/passages.md:148`; HTTP table).

## Plugins and services

Installed format: `.wheelhouse-plugin/plugin.json` supplies package id/name/version/wheelhouse.apiVersion (currently1), ESM server entry path, optional UI and settings, contributions, services, MCP server ids, host routes, address rewrites and capabilities. Server entry exports providers/contributions and any declared services/MCP/routes; manifest and exports must agree. Entries must exist within plugin root. Runtime loads code only at startup. Compiled-in registry currently has none; four bundled plugins are under `plugins/` (`docs/plugins.md:3`, `src/lib/server/plugins/builtin.ts`, `loader.ts`, `manifest.ts:138`). Installed ids cannot shadow bundled/compiled-in ids.

| Bundled plugin  | What / how to manage                                                                                                                                            | Evidence                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `project-links` | Links/tab/cards from project clone origin, README and fleet; turn/configure through plugin page/config API                                                      | `plugins/project-links/README.md:1`, `.wheelhouse-plugin/plugin.json`, `wheelhouse/server/index.js` |
| `github-issues` | Project Issues tab; labels/assignee and per-project watch list/bell/auto; readonly listing, Wheelhouse watcher can alert or send one issue handoff note in auto | `plugins/github-issues/README.md:1`; `docs/plugins.md:40`; `src/lib/server/issues/watch.ts`         |
| `vault`         | On by default; fleet Vault/project Secrets/task Secrets used; reads wh-vault list/audit, native page uses core API for changes                                  | `plugins/vault/README.md:1`; `docs/vault.md:108`                                                    |
| `shared-review` | Off by default; Reviews menu, task review, preview action; desk service and feedback capability                                                                 | `plugins/shared-review/README.md:5`                                                                 |

Examples of external plugins in docs: improve (harness improvements), docket (graph/search MCP apps), localhost-proxy (host routes). These aren't additional bundled CLI tools or guaranteed installed services; inspect current registry. Use `wheelhouse plugin install <org/repo[@ref]>` for an authorized install, optionally `--setting key=value` (list comma-separated), or `/settings/plugins` inspect/review/install flow. Review source/commit/capabilities, including code executed on server and browser. Fetch uses git, drops .git, records exact commit, does not execute plugin during install; install's subsequent restart loads executable code. Update is explicit, never automatic. New commit/tag checks use git ls-remote, six-hour cache; commit pins aren't checked. UI install/update refetches and requires exact inspected commit (`docs/plugins.md:229`, `:259`; CLI and HTTP sections).

Distinguish installed load state (`installed.json`, CLI disable, requires restart) from live enabled scopes/settings (`plugins.json`, no restart). Global boolean config update clears project choices; null restores default while keeping project overrides. Direct file deletion of `enabled` removes a setting; null is an API instruction, not a valid stored enabled value. Settings are plaintext; secret references must be names for wh-vault. Invalid plugins.json is never overwritten by UI/CLI. Missing or malformed config falls back to defaults with error.

Provider contract (`src/lib/server/plugins/types.ts:166`): scope fleet/project/task; copies of projects/tasks; settings; `exec` argument array/minimal env/bounded output; `readFile`/`listDir` confined to home/clone/worktree (read64 KiB); `changedFiles`, `loopbackAddresses`, `reservedPorts`. Timeout3s default/max10s; results cached ttlMs, failures<=15s, last good up to10m; provider errors isolated. This is read-only by contract, not a sandbox: imported code runs with the OS user's permissions (`docs/plugins.md:17`).

Companion services (`types.ts:132`, `docs/plugins.md:95`) have fleet/project scopes, resolver chooses command/cwd/address/health/setup steps and optionally port identity. GET service checks health; POST launches only on requested click/authorized launch, may run install/build preparation, refuses all-interface listener. Declared service already started keeps running after Wheelhouse exits; no generic stop-service endpoint. A service still launching is stopped by Wheelhouse restart and included in busy list. Per-service allocated ports are persisted. CLI/plugin changes can restart every Wheelhouse sharing plugins dir, not just one browser tab.

Plugin UI host API includes `service`, `startService`, `sendFeedback`, `summariseFeedback`; sends/start require fresh browser user activation. Feedback max30 items, each text500 chars, points200 chars, subject200 chars, also16 KiB inbox note ceiling; one Re: task note, no direct worker messaging. Summary runs headless Claude once, default timeout2m; result points preserve source item indexes, send remains a separate click (`docs/plugins.md:334`, `:386`).

Fixed slot/render/block contracts and SDK: `packages/plugin-sdk/README.md:1`, `packages/plugin-sdk/index.js`, `index.d.ts`, `plugin.schema.json`, `docs/plugins.md:7`. Data blocks text.v1/kv.v1/table.v1/links.v1/image.v1/status.v1/graph.v1; unsupported block falls back to text, graph is placeholder. Render via compiled panel, installed custom element, or declared MCP app. Slots cannot be arbitrarily invented. Full long-tail authoring procedures live in `docs/plugins.md` and SDK schema, rather than the skill entrypoint.

Host routes: template must end .localhost with `{port}` once in first label. Requests and WS handled before SvelteKit; matching-origin required on mutations/WS. Address rewrite applies http loopback URLs, preserves path/query, uses viewer's Wheelhouse port; excludes https/own-port/foreign address. First enabled rewrite wins. Host-route implementation can mutate state; inspect plugin docs/route handler. Never assume a generic proxy can read any loopback port: contexts give shown addresses and reserved ports (`docs/plugins.md:172`). PR review links similarly select first enabled opensPullRequest project tab, else GitHub (`docs/plugins.md:210`).

## MCP and apps

Wheelhouse 0.5.0 is an MCP Apps **host/client**, not a bundled MCP management server. No stock `wheelhouse_health`/restart/plugin-management MCP tools, root `/mcp`, stdio server entrypoint or universal tool catalogue are defined. All four bundled manifests currently declare no `mcpServers`. External plugins may declare their own services and MCP tools; query `/api/plugins`, `/api/slots` and service view, then their manifests/docs. Do not invent tool names from page labels.

A plugin declares `mcpServers:[{id,title,service,path}]` in its server export and corresponding id/service in manifest; endpoint is Streamable HTTP at service address + path, confined to loopback and plugin's own declared service. A contribution sets `render:{app:{server,tool}}`; its provider returns arguments. Wheelhouse uses initialize (with `io.modelcontextprotocol/ui` extension), notifications/initialized, tools/list, tools/call, resources/read; protocol versions 2025-11-25, 2025-06-18, 2025-03-26; no stdio, sampling, roots or elicitation; JSON or SSE responses, max8 MiB, no redirects, reinitialize once on404 forgotten session (`src/lib/server/apps/mcp.ts:3`, `:16`).

The tool must advertise `_meta.ui.resourceUri` for a `ui://` resource of `text/html;profile=mcp-app`. Optional `_meta.ui.csp` declares allowed origins; per-server/project sandbox on another ephemeral loopback origin, signed policy; default no network. Slot app runs its initial tool from provider arguments (W if that tool mutates). Chat app reuses original finished call/result from transcript rather than re-running it; result >2 MiB is not passed; JSON text can be reconstructed as structuredContent (`docs/plugins.md:128`, `:148`; `src/lib/server/apps/host.ts:20`).

Chat matching names: `mcp__<server-id>__<tool>` or `mcp__plugin_<plugin-id>_<server-id>__<tool>`, exactly one enabled plugin must match; per-project service requires a `project` argument naming the Firstmate project id. Wheelhouse never reads Claude MCP config or reaches arbitrary undeclared servers. Docket example: server id `docket`, `docket_search({query,project?})`, readOnlyHint true, UI `ui://docket/search.html`; these belong to docket plugin, not Wheelhouse itself (`docs/plugins.md:160`).

All HTTP app operations are `POST /api/apps/<op>` with common page token/Origin. App reference is `{plugin,contribution,project?,task?}` or `{chat:<tool_use id>}`:

| op     | Additional body                                   | Output / effect                                                                                                                                                      |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat` | `{calls:[tool_use ids]}` <=500, no app ref needed | R lookup of chat calls with UI app/title (may contact declared MCP server)                                                                                           |
| `open` | App ref                                           | C: HTML/policy/tool/arguments or service status; may allocate sandbox                                                                                                |
| `run`  | App ref                                           | W: initial slot tool call; chat uses recorded result                                                                                                                 |
| `call` | App ref + `{name,arguments:{},confirmed?:true}`   | R/W per tool; same server only and visibility includes app. readOnlyHint runs; other tools require captain confirmation409 before confirmed retry;403 policy refusal |
| `read` | App ref + `{uri}`                                 | R: resources/read on own server only                                                                                                                                 |

Definition all branches `src/routes/api/apps/[op]/+server.ts:40`, host policy `src/lib/server/apps/host.ts:28`. App protocol requests: `ui/message` shows proposed captain message for consent then sends via Firstmate; `ui/open-link` http(s) new tab only; `ui/request-display-mode` inline/fullscreen if declared, no pip; `ui/update-model-context`, `ui/download-file`, sampling refused (`docs/plugins.md:135`). This is not an agent backdoor to approve its own tool call.

## Firstmate status, chat and inbox contracts

### What Wheelhouse reads

Wheelhouse wraps Firstmate scripts with bounded argument arrays and `FM_HOME=<owning home>`, using that home's recorded runtime endpoints. Compatibility gates inspect script contract markers, not just version number (`src/lib/server/firstmate/install.ts:30`).

| Surface / call                                                                      | Mode / what Wheelhouse learns                                                                                                                  | Definition                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `<code>/bin/fm-fleet-snapshot.sh --json`                                            | R; `fm-fleet-snapshot.v1`, live tasks, projects, secondmate_current, endpoints, open decision keys, crew run named by task                     | `src/lib/server/firstmate/adapter.ts:238`; `contracts.ts:11`; `docs/architecture.md:7`   |
| `<code>/bin/fm-inbox.sh ready`                                                      | R; `fm-primary-ready.v1`, Firstmate lock/readiness/transcript owner                                                                            | `src/lib/server/firstmate/install.ts:38`; `docs/architecture.md:8`                       |
| `<code>/bin/fm-inbox.sh note --request-id <id> --json -`                            | W; stdin note <=16 KiB, `fm-inbox-note.v1`; stable request-id replay                                                                           | `src/lib/server/firstmate/adapter.ts:402`; `docs/architecture.md:9`                      |
| `<code>/bin/fm-inbox.sh receipts [--after <cursor>]`                                | R; `fm-inbox-receipts.v1`, pending/handled/replies/reply_cursor/omissions; optionally all-pending/all-handled to recover omitted tracked notes | `src/lib/server/firstmate/adapter.ts:428`; `contracts.ts:606`; `docs/architecture.md:10` |
| `<code>/bin/fm-peek.sh <task> <lines>`                                              | R console, default40/max200 (may run Firstmate guard)                                                                                          | `src/lib/server/firstmate/adapter.ts:155`; `docs/architecture.md:11`                     |
| `<code>/bin/fm-on.sh <mate> fm-remote-secondmate-control.sh capture <mate> <lines>` | R remote mate's own terminal, max100; exit255 offline                                                                                          | `docs/architecture.md:13`                                                                |
| `fm-on.sh <mate> fm-remote-file.sh get state/<task>.status <max-bytes>` / task meta | R; remote task status/PR/preview/project/brief; no endpoint guessing                                                                           | `docs/architecture.md:14`; `src/lib/server/firstmate/matetasks.ts:30`                    |
| `fm-on.sh --stdin <mate> fm-inbox.sh note --request-id <id> --json -`               | W: one task note to that second mate's inbox                                                                                                   | `docs/architecture.md:21`; `src/lib/server/firstmate/adapter.ts:370`                     |

Other R sources: `state/fleet-ledger.jsonl` status/identity/merge history; `state/<id>.meta` repo/project/worktree/run; `data/projects.md` project descriptions/posture; `data/backlog.md` queue/captain holds; `data/<id>/brief.md`, report.md, contributions.json, screenshots; worker inbox pending/handled messages for conversation; worktree git diff and project git remote/log; recorded PR `gh pr view` and gh api graphql; no-mistakes `axi status --run <recorded run>` plus CI/step/evidence logs; Claude JSONL transcripts and `quota-axi --provider claude --json --no-credential-refresh` for allowance. See complete source map `docs/architecture.md:5` and parsers `src/lib/server/firstmate/`. Wheelhouse does not choose/start/answer a no-mistakes run and does not supervise the crew; closing Wheelhouse leaves Firstmate/crew running. Firstmate session lock prevents a second supervisor session.

Readiness/ledger checked every5s; full fleet adaptive about2x its duration bounded5..30s; issue watcher each minute; plugin and passage checks on separate caches/queues. Fleet views expose stale/unknown/omissions rather than guessing (`docs/architecture.md:56`).

### Status lines and previews

Wheelhouse consumes existing Firstmate append-only status logs/ledger, including worker state, text, numeric epoch, decision key and associated PR/run. Preserve native Firstmate status-writing/ledger procedure; don't write Wheelhouse's cache to fake task state. The task id comes from record identity, project from `repo=` then basename of `project=` (Firstmate home maps to firstmate), not a status label (`src/lib/server/firstmate/matetasks.ts:111`, `:135`; `model.ts`). A status line is `<state> [at=<Unix-seconds>] [key=<decision-key>]: <text>`; use actual numeric epoch, not a shell-expression string. `needs-decision`/`blocked` opens a key; matching `resolved` is what closes it, not merely a later working/done line. Open keys in the snapshot, held backlog and readiness/evidence drive decision cards (`docs/architecture.md:31`, `:38`; `src/lib/server/inbox/service.ts`).

The reliable preview payload is `preview http://127.0.0.1:<actual-preview-port>/<path>` in the text after the status colon. The `<port>` must be the running preview's own port, not Wheelhouse's. The parser also understands nearby “preview at/on”, “Preview ready/up/live”, “prototypes ready” with loopback URLs, and board URLs `/session/<id>` or following `board`; addresses inside inline/fenced code don't count. Convention `preview <url>` can link nonloopback http(s), but only loopback embeds/probes (`src/lib/previewnote.ts:7`, `:29`, `:71`). Status append/ledger update is W; merely formatting a reply is not a server mutation.

Firstmate's own chat reply can link the real loopback preview outside Markdown code; any such address becomes a preview box, no worker status required. To associate a task card, name the task id or full PR URL and link its preview/board; card placement uses latest matching linked reply after report, or first mention, then first post-landing reply. Standalone addresses dedupe per server under latest linked reply; own Wheelhouse port ignored. No API call creates the card: transcript content does (`src/lib/chat/previews.ts:1`, `src/lib/previewnote.ts:91`). Check embedding with `/api/tasks/<id>/preview` or `/api/previews/check?url=<encoded>`, which only fetches shown loopback origins. Embedding can fail due to CSP/X-Frame-Options even if service is up.

### Decisions in chat

End a reply with this exact fenced block (nothing after it):

````text
```decision-form
Which approach should ship?
- Small release: Deliver the essential change first (recommended)
- Full release: Include the optional workflow
```
````

First non-list line is question, `- label: detail` gives optional explanation, `(recommended)` (or rec) marks recommendation, `- (written)` requests free text. Two options become one-tap buttons only if neither has detail and each label<=28 chars; otherwise choice/Decide. Answer words cap300. Standalone form response arrives as `Decided: <words> — for: “<question>”` plus optional note after blank line; absent question drops “for”. Stable distinct question wording routes queued answers to the right latest still-open form; same question replaces earlier form. Parser: `src/lib/decisionform.ts:155`; standalone end-of-reply constraint `src/lib/chat/forms.ts:67` and answer format `:76`.

Escalated decision cards are grounded in Firstmate's actual recorded keys/holds/questions, not created by a decorative form. Card id `<task>:<key>`; `/api/inbox` supplies cards/evidence/recommendation/options. `/api/inbox` answers `approve/fix/skip/close` and optional note/picks/decided go as messages to Firstmate, never directly to a worker. Discuss messages begin `> About the decision on <task> (key <key>), not an answer yet: “...”` and FORM_HINT; discussion itself is not an answer. Firstmate can end its reply with decision-form to refine that card's choices (`src/lib/chat/discuss.ts:26`, `:54`; `src/lib/server/inbox/service.ts`). A captain's actual answer still needs normal Firstmate decision resolution; the UI folding a sent card doesn't replace that duty.

### Project markers and task routing

Put `<!-- project: <registered-project-id-or-topic-slug> -->` on its own line at reply start or each section of a multi-project round-up. It is invisible in rendered text and tags subsequent text until next marker, even across reply parts. Marker inside code blocks ignored. Unregistered kebab-case slug creates a topic; no need to add a project just to make a thread. Captain messages arrive with leading `[project <slug>]` (after reply quote), so preserve/interpret the context (`src/lib/chat/topics.ts:1`, `:56`, `:88`). Without explicit markers Wheelhouse guesses from task ids/PR/preview then reply context; browser retag overrides locally.

For messages about a task, `POST /api/firstmate/messages {text,taskId}` stores/sends `Re: <task-id>\n<text>` (`src/lib/server/store/messenger.ts:53`). Native `#task` mentions expand to task context (`src/lib/chat/refs.ts`, `mention.ts`). Second mate tasks use composite `<task>@<mate>` everywhere the API accepts task id, and go to the second mate's inbox/home (`src/lib/server/firstmate/matetasks.ts:48`). Never strip @mate and send to a same-named main-home task.

For requested changes after a PR was reported ready, the note adds immutable routing advice: use `fm-send.sh <task-id>` for the existing live authoring worker, else start a new run on that PR; unknown/stale state means try worker first. Preview/plugin feedback asks to pass the list to the same task, start no new task; Firstmate may add separately attributed notes (`docs/architecture.md:52`; `src/lib/server/firstmate/changes.ts`).

### Inbox notes and replies

Idempotency-Key is 1..128 of letters/digits/dot/underscore/colon/dash, no leading dot. Reuse same key/body on uncertain delivery, not new keys. Firstmate note exit0 delivered,3 saved but not woken,1 not saved; Wheelhouse reconciles uncertain/unannounced at15s doubling to5m, stores before delivery, refuses503 if initial persistence fails. Delivery and acknowledgement are separate; acknowledged means Firstmate drained to handled, not that it replied (`docs/architecture.md:45`; `src/lib/server/store/messenger.ts:7`).

Firstmate should answer the original note with its **own** `fm-inbox.sh reply` command so Wheelhouse and Discord attach the answer to that note. Do not use POST /api/firstmate/messages to send Firstmate's reply back to itself. Wheelhouse is a consumer of receipts, not the owner of reply creation: replies carry `id` (note id), `at`, `body`, `cursor`, and top-level reply_cursor. Exactly parsed by `src/lib/server/firstmate/contracts.ts:582`; fake implementation evidence `tests/helpers/fake-firstmate.ts:227`. Phone note explicitly says to use fm-inbox.sh reply (`src/lib/server/gateway/render.ts:28`, `docs/guide.md:179`).

**Scope-bound syntax limit:** this Wheelhouse tree documents `fm-inbox.sh reply` but does not define that command's arguments or stdin flag. Its implementation belongs to Firstmate rather than this package, so do not treat a guessed `reply <id> -` or `reply <id> <text>` as verified. In the owning Firstmate installation, run `<code>/bin/fm-inbox.sh --help`, use the exact `reply` syntax it documents with the original note id, and verify it via `receipts --after <previous cursor>` / `GET /api/firstmate/messages`. There is no Wheelhouse HTTP “reply as Firstmate” route. Use the owning installation’s documented syntax.

Attachments arrive as `[attached file <absolute path> — <name>, <size>, <type>]`, not file bytes in a note. Read through own tools if task requires; uploads retained7d, max25 MiB each (`src/lib/chat/attachments.ts:18`, `:38`).

### Secrets requested in chat

A reply can contain:

````text
```vault-request
name: DEPLOY_TOKEN
purpose: Deploy this project's release
projects: project-id
```
````

Name required; purpose optional one line<=300, projects optional comma/space-separated <=20 valid ids. Only name/purpose/projects fields, each once; any `value` field rejects the block and leaves it as code. UI button opens native hidden-value popup on user click, never asks the agent to hold value. Once saved, Firstmate receives `Stored secret DEPLOY_TOKEN in the vault. project-id can use it.` or no project may use it yet (`src/lib/chat/vaultrequest.ts:1`, `:55`, `:100`). Grants/usage remain by name via wh-vault.

## Restart and upgrade

There is **no public `wheelhouse restart`, `stop`, `status`, `doctor` or `update` CLI subcommand** at this commit; use health API, supported upgrade/plugin commands, or authenticated restart route. Never invent `wheelhouse restart` or use kill-all as a substitute.

`wheelhouse open` runs a small watcher with hidden __server child. Restart exit75 or child death causes same-port restart without another browser tab. Default4310, port0's chosen port retained; `WHEELHOUSE_RESTARTED` prevents starting another Firstmate. Firstmate and crew belong to tmux and remain running. Restart interrupts Wheelhouse's in-flight Firstmate input/scripts, service launches and terminal drawers (reconnect), sandbox/proxy/forward state; already-started companion services persist (`cli/index.ts:41`; `cli/supervise.ts`; `src/lib/server/runtime.ts`; `docs/plugins.md:251`).

For a targeted authorized restart: read `<actual plugins-dir>/.running/<pid>.json` in memory, select record by actual URL; GET its exact `/api/wheelhouse/restart` with `Authorization: Bearer <record.token>` to inspect `{busy}`; then POST same URL/header if restart is intended. Do not print token or restart another record just because it shares the directory. GET requires Bearer too; page session token is insufficient (`cli/running.ts:57`). The standalone bearer route's security is token possession, not SvelteKit's Origin/session check. CLI plugin/upgrade requestRestart scans **all** records using that plugins directory; cleans stale records and prompts for listed busy work unless --yes (`cli/running.ts:100`).

Clone update: `wheelhouse upgrade --check` checks default branch and may fetch refs; `wheelhouse upgrade` prompts and fast-forwards only clean correct-branch nondiverged clone, runs npm ci/build, requests restart. Local changes/other branch/local commits refused; no reset/stash/merge. `-y/--yes` skips agreement including busy restart. HTTP GET/POST /api/wheelhouse/update provides check/progress; POST /api/wheelhouse/upgrade starts202 and UI polls update. Page-driven mutation requires the `wheelhouse open` watcher and follows the chosen update source (`published` or `github`); published updates run global npm install, GitHub updates fast-forward/build the selected clone (`cli/upgrade.ts:18`; `src/lib/server/upgrade/clone.ts`, `service.ts`; `docs/guide.md` Keeping Wheelhouse up to date).

Npm install update: `npm install -g @chrisjowen/wheelhouse` as README instructs (`README.md:34`). It updates installed package files; arrange restart of the actual running instance using above control to load them. Do not rebuild unrelated worktree or assume updating files updates memory. Not performed here.

### Update source selection

Local Settings → Updates selects `published` (latest npm release) or `github` (origin default branch). `POST /api/wheelhouse/source` accepts `{source:"published"}` or `{source:"github"}` with the normal Origin/session headers, returns the Wheelhouse update view on 200, 400 for invalid JSON/source, 409 if busy, unavailable or no restart watcher. Switching installs/relinks and restarts; review its effects before calling. `POST /api/wheelhouse/upgrade` follows this selection; the CLI `wheelhouse upgrade` remains clone-only. `GET/POST /api/wheelhouse/update` supplies/checks the update view, including install and selected-source state. Source: `src/routes/api/wheelhouse/source/+server.ts`, `src/lib/server/upgrade/service.ts`, `src/lib/updates.ts`.

Settings live at `<config>/update/settings.json` (`wheelhouse-update-settings.v1`, `source:published|github|null`, `cloneDir:string|null`). Default source follows install kind until selected; the default managed clone is `<config>/update/wheelhouse`. `<config>/update/next-install` is an internal one-use handoff consumed by the watcher, not a file to synthesize. The watcher adopts the new install’s CLI and bundled assets after a source switch. A dirty/diverged clone is still refused. Source: `src/lib/server/upgrade/settings.ts`, `kind.ts`, `npm.ts`.

## Cloud and remotes

Two distinct features: Discord **gateway** is bot messaging and alerts; Wheelhouse **Cloud** (`remote` CLI, `/remotes`) exposes the UI/previews through a hosted outbound relay. Neither implies the other is enabled.

Cloud starts only after Start on local Remotes page (`POST /api/cloud {action:"start"}`), or `wheelhouse remote run`. `remote connect` pairs but doesn't set page started; `remote on` only enables; page Start sets started/enabled and pairs if needed. Started state persists across open/restart until Stop. Pairing displays code and key fingerprint for approval on trusted browser; private Ed25519 key stays in Keychain (`wheelhouse-cloud`) else0600 device.key under0700 config/cloud; status only exposes fingerprints (the machine's, and those of the passkeys it trusts) and key-store location (`src/lib/server/cloud/settings.ts:24`; `pairing.ts:49`). Approval signs the machine's pin challenge with the captain's passkey; once that checks out, the machine pins the account's passkeys and serves only relay sessions one of them signed (protocol 2; `src/lib/server/cloud/guard.ts`, `passkeys.ts`). A machine paired without pins serves sessions as before; re-pair to turn checking on. A change of pins the gateway asks for (signed by a trusted passkey) only waits: it applies once the captain approves it locally (Remotes page, `POST /api/cloud {action:"approve-pins"|"reject-pins", id}`, or `wheelhouse remote pins approve|reject <id>` (id required)), never through the relay, and lapses after an hour. A re-pin is trust-on-first-use like pairing: the captain checks new fingerprints against the authenticator or a trusted device, not the gateway's Account page. Default gateway comes from `src/lib/cloud.ts`, overridable with `--gateway` or the page; use configured value, no user-specific domain in skill.

Local management: remote status R; remote connect/disconnect/on/off/run W; page start/stop/gateway/disconnect W; GET /api/cloud R. Changing gateway refused while paired/pairing; stop then disconnect before changing. Disconnect deletes local key even if upstream revocation fails; report note and revoke device in gateway UI too. Setup and Remotes control refuse relayed calls (403); don't attempt to enable remote access from the relay itself (`src/routes/api/cloud/+server.ts:19`; `src/routes/api/setup/+server.ts:35`).

Gateway protocol is external `wheelhouse-cloud` repository, not hosted by Wheelhouse's SvelteKit server. This repo implements client-side `POST <gateway>/v1/pair/start` (public key/machine/protocol -> pairing id/code/verificationUri/expiry), `POST /v1/pair/poll` (signed poll -> approval/pending/expiry), `POST /v1/device/unpair` (signed -> revoked), and outbound WebSocket `/v1/connect` carrying signed connection and multiplexed HTTP/WS streams. Follow implementations rather than forge signatures by hand (`src/lib/server/cloud/pairing.ts:110`, `:184`, `:236`; `connector.ts:56`; `protocol.ts:10`). HTTPS gateway required except loopback development, no credentials/path/query. No remote server deployment/admin endpoints are defined here.

Relay restricted to this UI plus preview ports Wheelhouse has shown (`GET /api/cloud/previews`), and on a machine with pinned passkeys to sessions it verified itself. Outbound connector lives in open's watcher, survives child UI restart; local requests marked `X-Wheelhouse-Remote:1` after stripping spoofed browser header. Browser origins/links are translated by relay; no arbitrary localhost proxy. See `src/lib/server/cloud/relay.ts`, `remote.ts`, `service.ts`; `docs/guide.md` Wheelhouse Cloud.

Discord: connect token via CLI hidden stdin; local Settings Gateway starts one-time pairing, bot listens only paired account's DMs/buttons; no token through browser. Phone messages use `discord:<message id>` stable keys, task replies include Re: task; direct message reply must use Firstmate inbox reply so it returns to phone. `status`/`help` bot commands answered from cached fleet; text only, <=6 forwarded messages/min and200/day; enabled alerts `pr-green,question,stuck,landed`, titles-only avoids bodies (`docs/guide.md:179`; `src/lib/server/gateway/`). Pairing/alert preference/action fields in HTTP table; neither Discord nor Cloud is an instruction to type into arbitrary agent sessions.

## Bundled Shared review

Optional bundled plugin with its own Node22 CLI/desk/server under `plugins/shared-review/`, not extra binaries in dist. All commands below are `node <wheelhouse-install>/plugins/shared-review/review/main.mjs ...`; use the install that launched the plugin, not a discarded worker checkout. Source `review/main.mjs:1`, README Commands section; never dump status/list output to a transcript: some read commands include desk key, passcodes and share links. Read source or `help` before execution.

| Command                      | Inputs / output                                                                                                                                                                                                                                     | Mode / source                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `serve`                      | Env `REVIEW_PUBLIC_URL`, `REVIEW_OWNER_TOKEN` required; `REVIEW_LISTEN` default127.0.0.1:8080, `REVIEW_DATA_DIR` default review-data, optional REVIEW_SESSION_SECRET, REVIEW_SMTP_URL or REVIEW_OUTBOX_DIR, REVIEW_EMAIL_FROM, REVIEW_TRUST_PROXY=1 | W persistent review server; `main.mjs:115`                                                  |
| `desk`                       | `--port <n>` default0; `--remote <url>` else REVIEW_REMOTE_URL; `--token-env <NAME>` default SHARED_REVIEW_OWNER_TOKEN; starts loopback desk/local review server                                                                                    | W; `main.mjs:157`                                                                           |
| `start`                      | Exactly one `--live <url>` or `--static <dir>`; optional `--task <id>` else FM_TASK_ID, `--project <id>`, `--title <text>`, `--start </path>`, `--spa`, `--email <comma/space-separated addresses>`; returns local review/passcode/link             | W; `main.mjs:170`                                                                           |
| `list`                       | Optional `--task <id>`, `--json`; reviews/comments/state/links/passcodes                                                                                                                                                                            | R but credential-bearing output; `main.mjs:198`                                             |
| `status`                     | Optional `--task <id>`; always JSON; outputs desk url AND KEY, remote and reviews (or not-running/problem)                                                                                                                                          | R credential-bearing, intended plugin provider input, filter keys/passcodes; `main.mjs:200` |
| `go-live <id>`               | Move local preview to configured review server; new link/passcode; only on captain's instruction to publish                                                                                                                                         | W; `main.mjs:239`                                                                           |
| `close <id>`                 | Close link and mark bundle delivered; prints bundle/feedback; CLI does NOT send Wheelhouse plugin feedback automatically                                                                                                                            | W; `main.mjs:244`                                                                           |
| `show <id>`                  | Review/comments or closed bundle                                                                                                                                                                                                                    | R but may include share credentials; `main.mjs:254`                                         |
| `help` or no/unknown command | Usage only (unknown exit2)                                                                                                                                                                                                                          | R; `main.mjs:274`                                                                           |

Common CLI options: `--state <dir>` else WH_REVIEW_STATE else Wheelhouse state/plugins/shared-review (`review/paths.mjs:1`); `--json` for machine output; parser also accepts `--name=value` (`main.mjs:30`). Although `--help` is parsed, it only suppresses unknown-command error: **do not run `desk --help`, `serve --help`, `close <id> --help` etc to discover flags**; recognized commands execute normally. Inspect source header or `help` instead.

Plugin settings: reviewServer (https URL, optional local-only if absent), ownerToken (vault name default SHARED_REVIEW_OWNER_TOKEN), signIn passcode/email/both, invite address/domain list, reviewHost SSH target, emailFrom, smtpUrl (vault name default SHARED_REVIEW_SMTP_URL). The desk obtains owner token via `wh-vault run --only <name>` in a granted project's clone. No grant/macOS vault means local previews still work, remote disabled. Deploy templates `deploy/Dockerfile`, `kubernetes.yaml`, `ssh-deploy.sh`, `Caddyfile.example` are examples, W if applied/run; configure placeholders and wh-vault names, never print kubernetes secret values. No deployment performed. README Settings/Deploying a review server is the long-tail guide.

Desk state includes desk.json (URL/key), records and `bundles/<id>.json`; local server files/sessions/comments and peek tickets. Every review starts local; Go live is explicit; closing removes remote files/sessions/attachments/tunnel but retains comments/attachment metadata in local bundle. UI sends selected threads/points through core `/api/plugins/shared-review/feedback` first, then closes and marks delivered; late arrivals remain catchable. `sent`, `held`, summary from source thread indexes preserve what reached Firstmate. Voice bytes aren't transcribed or sent in note, only metadata (`README.md:31`, `:76`).

### Desk HTTP on its separate loopback port

Requires `x-review-desk-key` from desk record; browser CORS for allowed local Wheelhouse origin; rejects foreign Host. Error `{error}`/status. No Wheelhouse session token here. All under `/_review/desk/` (`review/desk.mjs:694`):

| Method/path suffix                       | Input                                                                                               | Output / mode                                                             | Definition             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------- |
| `OPTIONS *`                              | Browser CORS preflight                                                                              | 204 allowed GET/POST/DELETE, content-type/x-review-desk-key; R            | `desk.mjs:705`         |
| `GET state`                              | `?task=<id>` optional                                                                               | `{version,url,remote,reviews}` (includes private sharing metadata); R     | `desk.mjs:720`, `:639` |
| `POST reviews`                           | `{task?,project?,title?,start?,source:{kind:live,url} OR {kind:static,dir,spa?},signIn?,invitees?}` | 201 `{review}` local preview; W                                           | `desk.mjs:722`, `:260` |
| `DELETE reviews/<id>/comments/<comment>` | No body                                                                                             | Owner delete comment/replies; result with removed ids; W                  | `desk.mjs:724`         |
| `GET reviews/<id>/bundle`                | No body                                                                                             | Closed full bundle,404 missing; R                                         | `desk.mjs:727`         |
| `POST reviews/<id>/live`                 | `{}`                                                                                                | `{review}` move live; W                                                   | `desk.mjs:735`         |
| `POST reviews/<id>/feedback`             | `{threads:[ids]}`                                                                                   | `{feedback}` selected unsent threads, doesn't send; R                     | `desk.mjs:736`, `:410` |
| `POST reviews/<id>/peek`                 | `{origin:<local Wheelhouse origin>}`                                                                | `{url}` one-use ticket; creates thumbnail listener/session; C             | `desk.mjs:740`, `:620` |
| `POST reviews/<id>/close`                | `{sent?:[comment ids],held?:[thread ids],points?:[...]}`                                            | Close result `{review,bundle,feedback}`; W, records selected/held/summary | `desk.mjs:741`, `:437` |
| `POST reviews/<id>/delivered`            | `{sent?:[comment ids]}`                                                                             | `{review}` mark delivered (or cleanup remote comments); W                 | `desk.mjs:750`, `:483` |

Other desk routes: `/_review/health` returns service/version health, `/_review` root desk page; unmatched paths go to its local ReviewServer (`desk.mjs:670`). Per-review thumbnail port serves `/_review/peek/<ticket>` (GET swaps one-use2min ticket for session cookie,302; W session creation), then static files GET/HEAD or live-app forwarded methods with peek session and fixed frame origin; closing review shuts port. `review/peek.mjs:1`, `:134`, `:176`. It can forward state-changing live-app requests; not a universally read-only image endpoint.

### Review server HTTP (deployed or desk-local)

Defined in `review/server.mjs`, not src/routes. Owner endpoints use `Authorization: Bearer <owner-token>` and fixed namespace `/_review/api/`; reviewer endpoints need per-review signed session cookies plus same-Origin for mutations. All secret credentials/passcodes should be kept out of console logs. Health/assets are public; closed review APIs give401/404. Source-only inventory; no deployment requests made.

| Method/path                                          | Inputs                                                                                                               | Output / mode                                                                                                   | Definition                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /_review/health`                                | None                                                                                                                 | service/version health; R                                                                                       | `server.mjs:363`                                    |
| `GET /_review/assets/<name>`                         | Known packaged asset                                                                                                 | JS/CSS client bytes; R                                                                                          | `server.mjs:370`, `:392`                            |
| `GET /_review/api/info`                              | Bearer                                                                                                               | service,version,publicUrl,signIn; R                                                                             | `server.mjs:872`                                    |
| `GET /_review/api/reviews`                           | Bearer                                                                                                               | `{reviews}`; C expiry sweep can persist cleanup                                                                 | `server.mjs:880`                                    |
| `POST /_review/api/reviews`                          | Bearer; `{title,task?,project?,source:{kind:static/live,start?,spa?},signIn?,invitees?,passcode?,comments?}` <=4 MiB | 201 `{review,passcode,link}`; W; static starts draft/live starts open                                           | `server.mjs:886`, `:980`                            |
| `GET /_review/api/reviews/<rid>`                     | Bearer                                                                                                               | `{review,comments}`; R                                                                                          | `server.mjs:892`                                    |
| `DELETE /_review/api/reviews/<rid>`                  | Bearer                                                                                                               | `{ok:true}` close/delete; W                                                                                     | `server.mjs:894`                                    |
| `PUT /_review/api/reviews/<rid>/files/<path>`        | Bearer; raw file bytes                                                                                               | file upload result; W                                                                                           | `server.mjs:900`, `:1048`                           |
| `DELETE /_review/api/reviews/<rid>/comments/<id>`    | Bearer                                                                                                               | `{ok:true,removed}` any owner-selected thread/replies; W                                                        | `server.mjs:903`                                    |
| `GET /_review/api/reviews/<rid>/attachments/<id>`    | Bearer                                                                                                               | Attachment bytes; R                                                                                             | `server.mjs:914`                                    |
| `PUT /_review/api/reviews/<rid>/attachments/<id>`    | Bearer; raw bytes for imported attachment metadata                                                                   | upload result; W                                                                                                | `server.mjs:920`                                    |
| `POST /_review/api/reviews/<rid>/open`               | Bearer                                                                                                               | `{review}` draft->open; W                                                                                       | `server.mjs:921`                                    |
| `POST /_review/api/reviews/<rid>/close`              | Bearer                                                                                                               | `{review,comments,bundle}` removes access/files/session/upload state; W                                         | `server.mjs:930`                                    |
| `GET /_review/api/reviews/<rid>/tunnel/next`         | Bearer; long poll                                                                                                    | queued live HTTP request or204; C dequeues job, not a passive health check                                      | `server.mjs:939`                                    |
| `POST /_review/api/reviews/<rid>/tunnel/answer/<id>` | Bearer; `{status,headers:[[k,v]],body:<base64>,error?}`                                                              | `{ok:true}` or404; W resolve live request                                                                       | `server.mjs:956`                                    |
| `GET/HEAD /_review/<rid>[/]`                         | Session optional                                                                                                     | sign-in or review shell, may set current-review cookie; C                                                       | `server.mjs:427`                                    |
| `GET /_review/<rid>/enter`                           | Session                                                                                                              | 302 to prototype start, set current cookie; C                                                                   | `server.mjs:440`                                    |
| `POST /_review/<rid>/signin`                         | Form method/name/passcode OR email; same-Origin check                                                                | Set session/303 or mail sign-in link; W                                                                         | `server.mjs:451`, `:472`                            |
| `GET /_review/<rid>/magic`                           | Sign-in link ticket query                                                                                            | confirmation page; R (does not consume until POST)                                                              | `server.mjs:452`                                    |
| `POST /_review/<rid>/magic`                          | Ticket form confirmation                                                                                             | Consume ticket/set session/303; W                                                                               | `server.mjs:453`, `:550`                            |
| `POST /_review/<rid>/signout`                        | Session/same origin                                                                                                  | clear session/cookie,303; W                                                                                     | `server.mjs:456`                                    |
| `GET /_review/<rid>/api/comments`                    | Session                                                                                                              | review/me/limits/comments; R                                                                                    | `server.mjs:595`                                    |
| `POST /_review/<rid>/api/comments`                   | Session/origin; `{body,parent?,anchor?,attachments?}`                                                                | 201 `{comment}`; W                                                                                              | `server.mjs:608`; `review/comments.mjs` readComment |
| `PATCH /_review/<rid>/api/comments/<id>`             | Own session/origin; `{body,attachments?}`                                                                            | `{comment}`; W; own comments only                                                                               | `server.mjs:637`                                    |
| `DELETE /_review/<rid>/api/comments/<id>`            | Own session/origin                                                                                                   | `{ok:true,removed}`; W;409 when others replied                                                                  | `server.mjs:659`                                    |
| `POST /_review/<rid>/api/attachments`                | Session/origin; raw bytes, content-type,x-file-name, optional x-voice-note:1,x-voice-seconds                         | 201 `{attachment}`; W                                                                                           | `server.mjs:666`, `:705`                            |
| `GET/HEAD /_review/<rid>/api/attachments/<id>`       | Session, on-comment or own pending upload                                                                            | Attachment bytes; R                                                                                             | `server.mjs:670`                                    |
| `DELETE /_review/<rid>/api/attachments/<id>`         | Own pending attachment/session/origin                                                                                | `{ok:true}`; W                                                                                                  | `server.mjs:678`                                    |
| `GET /_review/<rid>/api/me`                          | Session                                                                                                              | `{name,current}`; R                                                                                             | `server.mjs:686`                                    |
| `POST /_review/<rid>/api/current`                    | Session/origin                                                                                                       | `{ok:true}`, wr_cur cookie; W                                                                                   | `server.mjs:689`                                    |
| Other paths outside `/_review/`                      | Current-review signed session cookie                                                                                 | static prototype GET/HEAD; live app forwards HTTP methods through connector with bodies bounded; R/W per target | `server.mjs:374`, `:805`                            |

Closed reviews delete prototype/uploads/sessions/unused sign-in links. Local bundle preserves comments and only attachment metadata. Rate limits apply to auth/comments/uploads. Reviewer limits:4 attachments/comment,10 MB ordinary file,5 MB/5min voice,100 MB/review; static site limits separate (5000 files,25 MiB per file,200 MiB total desk-side). A thumbnail/sign-in/share link or a key-bearing status is a credential surface, not material to paste into agent context unfiltered (`README.md:69`; `review/desk.mjs:54`; `review/attachments.mjs`).

## Development and release surfaces

These are source/development operations, not health checks against a running install. Run only for an intended development or release task. Definitions `package.json:40`, guide `docs/development.md:3`:

| Invocation                              | Effect                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm ci`, `npm link`                    | W dependency installation/global CLI linking in a clone                                                   |
| `npm run dev`                           | W Vite dev server; can start/show Firstmate on first request; supply actual WHEELHOUSE_FIRSTMATE_DIR/HOME |
| `npm run build`                         | W Vite web build then CLI bundles                                                                         |
| `npm run build:cli`                     | W esbuild dist/cli.js and dist/wh-vault.js                                                                |
| `npm run preview`                       | W Vite preview server                                                                                     |
| `npm run prepare`                       | W svelte-kit sync (also lifecycle during dependency install)                                              |
| `npm run prepack`, `npm pack --dry-run` | W build artifacts through prepack, even a dry-run pack; inspect package list                              |
| `npm run check`                         | C generated SvelteKit sync + svelte-check + CLI tsc                                                       |
| `npm run lint`                          | R formatting/ESLint checks                                                                                |
| `npm run format`                        | W Prettier writes                                                                                         |
| `npm test`, `npm run test:unit`         | C unit/DOM Vitest projects, no real Keychain                                                              |
| `npm run test:integration`              | W lab subprocesses/git/tmux/services then smoke; requires isolated setup                                  |
| `npm run test:smoke`                    | W rebuild then CLI smoke against fake Firstmate                                                           |

`.github/workflows/ci.yml` checks/types/lint/unit/pack/global tarball smoke and integration. `.github/workflows/release.yml` publishes on matching vX.Y.Z tag push or GitHub release, tests and packs first, npm provenance/public access, prereleases next tag; never push/publish for routine local maintenance. See `docs/development.md:48` and `:52`. Separate Shared review deployment templates/CLI are catalogued above. Dev dry-run installs still CLONE a repository (`docs/development.md:24`), so that switch is not a blanket read-only mode.

## Help evidence

The commands below all exited0 against installed Wheelhouse/wh-vault 0.5.0. For compactness, retained output is the exact Usage and option declaration lines, with descriptions/defaults documented in the CLI tables. No command action was executed. Installed help agrees with the source inventory; help alone does not establish runtime equivalence of every feature.

`wheelhouse --help` → exit0

```text
Usage: wheelhouse [options] [command]
  -V, --version      output the version number
  -h, --help         display help for command
```

`wheelhouse open --help` → exit0

```text
Usage: wheelhouse open [options]
  --firstmate <dir>      Firstmate code directory (default: the checkout you are
  --home <dir>           Firstmate operational home (default: $FM_HOME, else the
  --port <n>             port to listen on (127.0.0.1 only) (default: 4310)
  --state-dir <dir>      where Wheelhouse keeps its own records (default:
  --tmux-socket <name>   a tmux server of its own (tmux -L <name>) for the
  --config-dir <dir>     the captain-owned Wheelhouse config, with per-project
  --plugins-dir <dir>    where installed plugins live (default:
  --no-browser           do not open the browser
  --no-skip-permissions  start Firstmate without --dangerously-skip-permissions,
  -h, --help             display help for command
```

`wheelhouse plugin --help` → exit0

```text
Usage: wheelhouse plugin [options] [command]
  --plugins-dir <dir>       where installed plugins live (default:
  --config-dir <dir>        the Wheelhouse config whose plugins.json keeps
  -h, --help                display help for command
```

`wheelhouse upgrade --help` → exit0

```text
Usage: wheelhouse upgrade [options]
  --check              only say whether there is a newer version
  -y, --yes            upgrade (and restart, even mid-work) without asking
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from,
  -h, --help           display help for command
```

`wheelhouse gateway --help` → exit0

```text
Usage: wheelhouse gateway [options] [command]
  --config-dir <dir>             the Wheelhouse config directory (default:
  -h, --help                     display help for command
```

`wheelhouse remote --help` → exit0

```text
Usage: wheelhouse remote [options] [command]
  --config-dir <dir>  the Wheelhouse config directory (default:
  -h, --help          display help for command
```

`wh-vault --help` → exit0

```text
Usage: wh-vault [options] [command]
  -V, --version                output the version number
  --config-dir <dir>           the Wheelhouse config directory whose vault
  -h, --help                   display help for command
```

`wheelhouse plugin install --help` → exit0

```text
Usage: wheelhouse plugin install [options] <repo>
  -y, --yes                  install without asking; settings take their
  -s, --setting <key=value>  answer one of its settings (repeatable)
  -h, --help                 display help for command
```

`wheelhouse plugin list --help` → exit0

```text
Usage: wheelhouse plugin list [options]
  -h, --help  display help for command
```

`wheelhouse plugin update --help` → exit0

```text
Usage: wheelhouse plugin update [options] <id>
  --ref <ref>                a tag, branch or commit to move to
  -y, --yes                  update without asking; new settings take their
  -s, --setting <key=value>  answer one of its settings (repeatable)
  -h, --help                 display help for command
```

`wheelhouse plugin remove --help` → exit0

```text
Usage: wheelhouse plugin remove [options] <id>
  -y, --yes   restart a running Wheelhouse without asking, even mid-work
  -h, --help  display help for command
```

`wheelhouse plugin enable --help` → exit0

```text
Usage: wheelhouse plugin enable [options] <id>
  -y, --yes   restart a running Wheelhouse without asking, even mid-work
  -h, --help  display help for command
```

`wheelhouse plugin disable --help` → exit0

```text
Usage: wheelhouse plugin disable [options] <id>
  -y, --yes   restart a running Wheelhouse without asking, even mid-work
  -h, --help  display help for command
```

`wheelhouse gateway connect --help` → exit0

```text
Usage: wheelhouse gateway connect [options] <channel>
  -h, --help  display help for command
```

`wheelhouse gateway on --help` → exit0

```text
Usage: wheelhouse gateway on [options] [channel]
  -h, --help  display help for command
```

`wheelhouse gateway off --help` → exit0

```text
Usage: wheelhouse gateway off [options] [channel]
  -h, --help  display help for command
```

`wheelhouse gateway unbind --help` → exit0

```text
Usage: wheelhouse gateway unbind [options] [channel]
  -h, --help  display help for command
```

`wheelhouse gateway titles-only --help` → exit0

```text
Usage: wheelhouse gateway titles-only [options] <state> [channel]
  -h, --help  display help for command
```

`wheelhouse gateway status --help` → exit0

```text
Usage: wheelhouse gateway status [options]
  --port <n>  the port the running Wheelhouse listens on (default: 4310)
  -h, --help  display help for command
```

`wheelhouse remote connect --help` → exit0

```text
Usage: wheelhouse remote connect [options]
  --gateway <url>  the gateway, such as https://cloud.example.com (remembered;
  --name <name>    the name this machine gets there (default: its host name)
  -h, --help       display help for command
```

`wheelhouse remote status --help` → exit0

```text
Usage: wheelhouse remote status [options]
  -h, --help  display help for command
```

`wheelhouse remote disconnect --help` → exit0

```text
Usage: wheelhouse remote disconnect [options]
  -h, --help  display help for command
```

`wheelhouse remote on --help` → exit0

```text
Usage: wheelhouse remote on [options]
  -h, --help  display help for command
```

`wheelhouse remote off --help` → exit0

```text
Usage: wheelhouse remote off [options]
  -h, --help  display help for command
```

`wheelhouse remote run --help` → exit0

```text
Usage: wheelhouse remote run [options]
  --port <n>       the port the local Wheelhouse listens on (default: 4310)
  --gateway <url>  the gateway to pair with, when this machine is not paired yet
  --name <name>    the name this machine gets there (default: its host name)
  -h, --help       display help for command
```

`wh-vault set --help` → exit0

```text
Usage: wh-vault set [options] <name>
  -h, --help  display help for command
```

`wh-vault import --help` → exit0

```text
Usage: wh-vault import [options] <file>
  -h, --help  display help for command
```

`wh-vault list --help` → exit0

```text
Usage: wh-vault list [options]
  --all       every secret, with the projects it is granted to and when it was
  --json      machine-readable output
  -h, --help  display help for command
```

`wh-vault grant --help` → exit0

```text
Usage: wh-vault grant [options] <name> <projects...>
  -h, --help  display help for command
```

`wh-vault revoke --help` → exit0

```text
Usage: wh-vault revoke [options] <name> <projects...>
  -h, --help  display help for command
```

`wh-vault remove --help` → exit0

```text
Usage: wh-vault remove [options] <name>
  -h, --help  display help for command
```

`wh-vault run --help` → exit0

```text
Usage: wh-vault run [options] <command...>
  --only <names>  hand over only these names (comma-separated, or repeat --only)
  -h, --help      display help for command
```

`wh-vault audit --help` → exit0

```text
Usage: wh-vault audit [options]
  --project <id>   only this project
  --task <id>      only this Firstmate task
  --name <name>    only uses of this secret
  --event <event>  only run, set, remove, grant or revoke
  --limit <n>      at most this many (default 50)
  --json           machine-readable output
  -h, --help       display help for command
```
