---
name: manage-wheelhouse
description: >-
  Administer or diagnose Wheelhouse, the web UI the captain uses to talk to Firstmate: health, restart, upgrade, plugins (marketplace, settings, roles, companion services), vault secrets by name, what stays the captain's (Cloud, consent, answers), the chat formats Wheelhouse renders, Wheelhouse inbox cards and replies to relayed notes, and the agent material it installs. Use for Wheelhouse administration, when handling a note Wheelhouse relayed, and after a Wheelhouse or Firstmate upgrade reports material drift. For previews use wheelhouse-preview; for passage steps use wheelhouse-passage.
---

# Manage Wheelhouse

Wheelhouse is a local web app on loopback (default `http://127.0.0.1:4310`). The captain reads Firstmate's replies there as rendered Markdown, in a browser or on a phone, not in this terminal. Drive it with the `wheelhouse` agent commands below, never by scraping its pages or editing its files by hand.

The agent commands find the running Wheelhouse themselves (`--url`, else `$WHEELHOUSE_URL`, else the only one running) and authenticate with its agent token, which they never print. `--json` gives a stable `wheelhouse.<command>.v1` payload. Exit codes: 0 ok, 1 failed, 2 usage, 3 not running, 4 the captain's call (it prints the page to open: pass that link on, do not work around it), 5 changed since you read it (read again, then retry).

Every command, flag and HTTP route, with who may call it, is in the generated [operations reference](references/operations.md); read only the section you need. Chat formats are in [chat](references/chat.md).

## Health and recovery

- `wheelhouse status` shows the version, Firstmate, installed agent material and updates; `wheelhouse doctor` lists problems, each with what to do. Start there; stale or unknown is not success.
- `wheelhouse restart` restarts Wheelhouse's own server; Firstmate and its crew keep running. It first says what a restart would interrupt; restart mid-work (`--yes`) only when the captain asked. Never kill Wheelhouse's server process (`pkill`, `kill`): its watcher restarts it, and the captain loses whatever it was doing. If it is not running, `wheelhouse open --no-browser` starts it, with the same `--port`, `--config-dir`, `--state-dir` and `--plugins-dir` it ran with.
- `wheelhouse upgrade --check`, then `wheelhouse upgrade` when the captain wants it: it follows the update source (the npm package or a clone) and restarts. Rebuilding a clone a running Wheelhouse serves from breaks it until the restart, so let `upgrade` do both. Never reset or stash a clone's local changes to force an upgrade.

## Plugins and services

- Find: `wheelhouse plugin search <words>`; look before installing: `wheelhouse plugin inspect <org/repo[@ref]>` (the exact commit and what it may do).
- Install, update, enable, disable, remove: `wheelhouse plugin install|update|enable|disable|remove …`. Each restarts every Wheelhouse sharing that plugins directory; review the plugin's capabilities and settings with the captain first.
- Settings and where a plugin is on: `wheelhouse plugin config <id>` shows them; `--on`, `--off` or `--default`, with `--project <id>` for one project, and `--set key=value` change them without a restart. Never put a secret value in a setting: settings name vault secrets.
- The review surface (how the captain reviews work): `wheelhouse plugin role review.surface <id|builtin>`, only on the captain's ask. wheelhouse-preview says how to use whichever is active.
- A plugin's companion service: `wheelhouse service status|start <plugin> <service> [--project <id>]`.

## Secrets by name

`wh-vault` keeps secrets by name; values never pass through you.

- `wh-vault list --all --json`, `wh-vault grant <NAME> <project…>`, `wh-vault revoke <NAME> <project…>`, `wh-vault audit --name <NAME> --json`.
- Use a secret only as `wh-vault run --only <NAME> -- <command…>`, which puts it in that one command's environment. Never print, decode, echo or copy a value, and never probe one to see whether it works.
- A missing value is the captain's to enter: ask with a `vault-request` block (see [chat](references/chat.md)), never in words. `wh-vault set` is the captain's, at their own terminal.

## The captain's own calls

The agent token refuses these, and so should you: approving passage consent or command checks, Cloud, gateway pairing and remote access, setup, secret values, answering inbox cards, and messages sent as the captain. Tell the captain what is waiting and give the page link the command printed. `wheelhouse inbox` lists what waits on the captain (read-only). `wheelhouse remote status` is read-only; everything else under `remote` exposes Wheelhouse beyond this computer and is the captain's.

## Notes Wheelhouse relays

A captain's message from Wheelhouse reaches Firstmate as an inbox note. Answer it with Firstmate's own `fm-inbox.sh reply <note-id> -` (the reply text on stdin) or `fm-inbox.sh reply <note-id> <text…>`, naming the original note, so Wheelhouse attaches the answer to it. One reply per note. Never send your answer through Wheelhouse's message route: that would come back to you as the captain's words. [Chat](references/chat.md) covers project markers, decision forms, held decisions and the messages Wheelhouse sends on the captain's behalf.

## Installed agent material

Wheelhouse installs these skills for Firstmate and its crew, a block of worker rules in the Firstmate home's `config/brief-include.md`, and context for the Firstmate session it starts. The captain turns each on or off in Settings → Agent material. `wheelhouse skills status` shows each item and any Firstmate drift.

- `modified` (someone edited a copy) or `foreign` (a copy Wheelhouse did not write): `wheelhouse skills diff <id>` shows both sides; then `accept`, `keep` or `adopt` on the captain's say.
- Drift (Firstmate no longer has a command or contract this material relies on): read the Firstmate change the status names before trusting the affected wording; the fix ships in a Wheelhouse release.
- Never edit a managed copy to change how Wheelhouse behaves; Wheelhouse flags or replaces it on its next sync.
