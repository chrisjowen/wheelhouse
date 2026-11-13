---
name: manage-wheelhouse
description: >-
  Operate Wheelhouse, the local Firstmate web UI: check health, restart or upgrade, configure plugins and vault grants, edit project passages, publish preview cards, format chat decisions, handle inbox replies, and manage Cloud or Discord connections. Use for Wheelhouse administration and Firstmate-to-Wheelhouse integration, not general crew supervision.
---

Use the running instance's URL and directories; defaults are `http://127.0.0.1:4310`, config `~/.config/wheelhouse`, plugins `~/.wheelhouse/plugins`. Identify the actual Firstmate code directory and operational home separately. Config/state must be outside that home. Respect the requested scope: restart, install, upgrade, grants, messages, command checks and remote exposure change state. Handle secrets by name only.

The [operations inventory](references/operations.md) pins the full CLI, routes, inputs/outputs, effects and code references to Wheelhouse 0.5.0. Read only its relevant section. For another version, check `wheelhouse --version`, `wheelhouse --help` and command help. [Wheelhouse docs](https://github.com/chrisjowen/wheelhouse/tree/main/docs) may describe newer behavior.

### Inspect and recover

- Health: `GET /api/health`; inspect configured, compatibility, supervisor, collector staleness, ledger, messaging and passages. `GET /api/fleet`, `/api/inbox`, `/api/firstmate/messages`, `/api/plugins` supply current evidence. Don't treat stale/unknown as success. CLI has no `status`, `doctor`, `stop` or `restart` subcommand at this version.
- Start when intended: `wheelhouse open --firstmate <code-dir> --home <home-dir> --no-browser`, with actual `--port`, `--config-dir`, `--state-dir`, `--plugins-dir`, `--tmux-socket` if customized. It can start Firstmate when no session owns the lock. `--no-skip-permissions` retains Claude permission prompts.
- Restart one existing instance: read matching `<plugins-dir>/.running/<pid>.json` in memory, select its URL, then `GET <url>/api/wheelhouse/restart` with `Authorization: Bearer <record.token>` for `{busy}`. When the requested restart is appropriate, POST that exact route/header, no body; expect 202 then health returns. Never print token. Watcher retains port/options. Firstmate/crew keep running; Wheelhouse in-flight work/terminals can be interrupted. [Restart details](references/operations.md#restart-and-upgrade).
- Upgrade a clone: `wheelhouse upgrade --check` checks/fetches only; `wheelhouse upgrade` fast-forwards a clean default-branch clone, npm ci/builds and restarts. `--plugins-dir <dir>` selects restart discovery; `--yes` also accepts busy restarts. Npm install: `npm install -g @chrisjowen/wheelhouse`, then restart intended running instance. The UI uses the selected update source (`published` npm release or `github` clone): `GET/POST /api/wheelhouse/update`, `POST /api/wheelhouse/upgrade` (202, monitor update). Change source in local Settings → Updates, or `POST /api/wheelhouse/source {source:"published"|"github"}` (reinstall/relink and restart; 409 when unavailable). The CLI upgrade remains clone-only. Don't reset/stash local changes to force upgrade.

Read-only GET APIs normally need no token. SvelteKit mutations require matching `Origin` AND `x-wheelhouse-session` from the served page layout, JSON content-type, plus `Idempotency-Key` where named. Restart uses its separate Bearer token. [Authenticated request recipe](references/operations.md#authenticated-request-recipe) obtains session in memory without printing it; reacquire after restart. Use CLI/files when simpler.

### Plugins

```sh
wheelhouse plugin list
wheelhouse plugin install <org/repo[@ref]>
wheelhouse plugin update <id> --ref <tag-or-branch-or-commit>
wheelhouse plugin enable <id>
wheelhouse plugin disable <id>
wheelhouse plugin remove <id>
```

Group flags `--plugins-dir <dir> --config-dir <dir>` must match the install. Install/update take repeatable `--setting key=value`; optional `--yes` skips review/prompts. Every CLI mutation can restart ALL instances sharing that plugins directory. Review manifest, source/commit/settings/capabilities and restart impact before applying the requested change.

For live scope/settings use `<config>/plugins.json` or `POST /api/plugins/<id>/config` with ONE of `{enabled:true|false|null}`, `{project:"<id>",enabled:true|false|null}`, `{settings:{...}}`; GET same route for current page. Global boolean clears project overrides; null restores default, preserving project overrides. File format is `{ "plugins": { "<id>": { "enabled": true, "projects": {}, "settings": {} } } }`; omit fields to restore defaults, don't store null. These reload without restart. CLI disabled load state is different and needs enable/restart. Never overwrite malformed existing config or put secret values in settings.

[Plugin inventory](references/operations.md#plugins-and-services) covers inspect/install/update HTTP flows, services, feedback, SDK and host routes. `GET /api/services?plugin=<id>&service=<id>[&project=<id>]` inspects; `POST /api/services {plugin,service,project?}` launches when intended. Wheelhouse is an MCP Apps host, with no built-in MCP management server/tool set; external plugin tools must be discovered, not guessed.

### Vault by name

```sh
wh-vault list --all --json
wh-vault grant <NAME> <project-id> [other-project-id...]
wh-vault revoke <NAME> <project-id> [other-project-id...]
wh-vault audit --name <NAME> --json
wh-vault run --only <NAME> -- <program> <args...>
```

Pass `wh-vault --config-dir <dir>` before subcommand for custom config. `run` resolves project from task record then origin remote; grants are project IDs, not arbitrary paths. It executes the child and logs use; list/audit don't read values. `set <NAME>` takes hidden input/stdin and replaces; `remove <NAME>` deletes value/grants. macOS login Keychain is the only value backend at this version. Masking catches exact output values, not encoded/partial/file copies; don't probe secrets to check availability.

For a missing value, ask through a native chat card; never ask the captain to paste a value into conversation:

````text
```vault-request
name: DEPLOY_TOKEN
purpose: Deploy the requested release
projects: project-id
```
````

Only name/purpose/projects fields, no value. Captain enters it in the hidden popup. The resulting `Stored secret <NAME> in the vault...` message carries names/grants only. `GET /api/vault` reports canStore; `POST /api/vault` supports set/grant/revoke/remove. [Vault contracts](references/operations.md#wh-vault-cli).

### Add a passage step such as Deployed

Read [passage inventory](references/operations.md#passages) and [passage format](https://github.com/chrisjowen/wheelhouse/blob/main/docs/passages.md) before editing conditions/checks.

1. Inspect `GET /api/projects/<id>/passage` and `/passage/file?target=captain`.
2. Edit `<actual-config-dir>/projects/<id>.yaml` for a captain-owned override. Example shape: `version:1`, `extends:ship`, named check, new stage `id:deployed`, `after:landed`, `reached_when:<check>.success`, `evidence:[check:<check>]`. Use actual check type/outcome/environment, not a fabricated deploy indicator.
3. `POST /api/projects/<id>/passage/draft {target:"captain",text}` validates without executing checks. Review then `PUT /api/projects/<id>/passage/file {target:"captain",text,baseDigest}`; retain loaded digest (null only new file). 409 means reread/concurrent edit,422 validation error. Direct file edits must preserve existing config. Reload within a minute and inspect effective passage/errors.

Repository `.wheelhouse.yaml` is read from remote-tracking DEFAULT BRANCH of Firstmate's project clone, never task worktree or clone's uncommitted file. Repo target editor saves working copy only; ship it onto the read branch to apply. Captain file wins over repo, which wins over built-in. Built-in steps can change presentation/evidence, not reached/skip/failure rules.

Repo network checks need file-digest consent (`POST .../passage/consent {digest}`); local git/status and captain network checks don't. Command checks from EITHER file need separate exact-command-digest approval (`POST .../passage/commands {digest}`), even for captain config. Use displayed digests only after intended review. Null revokes. Command checks and `/passage/test` can EXECUTE/deploy; use draft for syntax-only validation. A fresh pinned checkout has no dependencies or .env. Never fabricate reached/consent state files.

### Preview cards, decisions and threads

To show a task preview, use its normal Firstmate status/ledger writer with text `preview http://127.0.0.1:<actual-preview-port>/<path>` after the status colon. Use actual numeric `[at=<epoch>]`. Keep full PR URLs. Follow the owning home's status/ledger protocol. A Firstmate reply linking a live loopback URL outside code also creates a preview card; name task id/full PR URL to associate it. Wheelhouse embeds loopback only. `GET /api/tasks/<id>/preview` checks a reported preview; `/api/previews/check?url=<encoded-url>` checks only an origin Wheelhouse has shown. [Preview/parser details](references/operations.md#status-lines-and-previews).

Tag replies/sections with a standalone `<!-- project: <project-id-or-topic-slug> -->`; respect incoming `[project <slug>]`. Use `<task>@<mate>` composite IDs for second-mate task APIs; do not strip the mate suffix.

End a reply with a native form, with no words after the closing fence:

````text
```decision-form
Which release should ship?
- Small release: Essential changes first (recommended)
- Full release: Include the optional workflow
```
````

Two short options without detail produce buttons; more/long/detail options produce choice/Decide; `- (written)` asks free text. Answer arrives `Decided: <words> — for: “<question>”` plus optional note. A form does not itself create a captain-held task or resolve a key. Discuss messages saying “not an answer yet” are discussion only. Read actual cards via `/api/inbox`; answer intended card using POST `{cardId,choice:approve|fix|skip|close,note?,picks?,decided?}` and stable Idempotency-Key. Respect Firstmate's own decision ownership/recording rules. [Chat contracts](references/operations.md#firstmate-status-chat-and-inbox-contracts).

### Messages and inbox replies

`POST /api/firstmate/messages {text,taskId?}` with stable Idempotency-Key sends a captain note;201 new,200 replay,202 uncertain/pending. Reuse key/body after uncertain delivery. Task prefix becomes `Re: <task>`; `<task>@<mate>` goes to owning mate's inbox. Preview/plugin feedback stays on the same task; send to existing authoring worker if live, else new run on the same PR according to Firstmate's routing rules.

As Firstmate, answer an incoming note through its OWN `fm-inbox.sh reply`, naming the original note ID, so browser/Discord attach it. Wheelhouse provides no reply-as-Firstmate endpoint. This repo does not define reply argument syntax: inspect `<firstmate-code>/bin/fm-inbox.sh --help` in the owning installation, use the documented reply form, then verify `fm-inbox.sh receipts --after <cursor>` or GET `/api/firstmate/messages`. Don't send the reply back to yourself via the captain-message route. A drained/acknowledged note is not yet a reply. [Inbox evidence and syntax boundary](references/operations.md#inbox-notes-and-replies).

### Connections and shared reviews

Discord: `wheelhouse gateway status --port <actual-ui-port>`; connect token by hidden/stdin `wheelhouse gateway connect discord`; pair account on local Settings Gateway. `on/off [discord]`, `unbind [discord]`, `titles-only on|off [discord]` change channel state. Token never goes in arguments/chat.

Cloud: `wheelhouse remote status`; pair `remote connect [--gateway <url>] [--name <name>]`; Start on local `/remotes` or `remote run --port <actual-ui-port>` starts relay. `remote on/off` toggles permission, `disconnect` revokes/deletes key. Page API `/api/cloud`: GET status; POST `{action:start|stop|disconnect}`, `{action:"gateway",gateway}`, or `{action:"approve-pins"|"reject-pins",ref}` (a passkey change the gateway asked for; the captain's call, local only, also `remote pins approve|reject`). Pairing/Start exposes the UI remotely and requires that intent; pairing alone doesn't set page started. Remotes/setup controls refuse Cloud-relayed callers. [Cloud inventory](references/operations.md#cloud-and-remotes).

For bundled Shared review use its [dedicated inventory](references/operations.md#bundled-shared-review) and plugin README. Reviews start local; go-live publishes. Its hand-written CLI's `--help` does NOT prevent recognized commands running; use `help`/source. Filter `status`, `list`, `show` output: they can contain desk keys/passcodes. Don't paste those credentials into transcripts. CLI close prints feedback rather than sending the UI's Firstmate note.
