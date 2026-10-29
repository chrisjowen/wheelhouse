# The vault: secrets by name

`wh-vault` gives Firstmate's crew the secrets a project needs (deploy tokens, API keys) without any agent handling a value. Values live in the macOS login Keychain. Agents handle only names. A command run with `wh-vault run -- <command>` gets its project's granted secrets in its own environment and nowhere else. Its output comes back with those values hidden, and the use is logged by name. Wheelhouse's **Vault** page shows names, grants and use. It never shows a value, and Wheelhouse's own process never holds one.

`wh-vault` ships with Wheelhouse: installing `@chrisjowen/wheelhouse` puts both `wheelhouse` and `wh-vault` on your `PATH`. It needs macOS for now (see [Backends](#backends)).

## What it protects, and what it does not

Workers run as you, the same OS user, often with permission prompts turned off. **Grants limit accidents and how far a prompt injection can reach. They do not stop a worker that sets out to get a secret.** A process running as you can call `security find-generic-password` itself, set `FM_TASK_ID` to another task's id, edit the vault file, or read another process's environment. Real isolation would mean running workers as a separate OS user or in a VM. The vault does not do that.

| Risk                                                                                                            | Covered | How                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A plaintext `.env` that other users can read, copied into backups or committed by mistake                       | Yes     | Values are in the Keychain, encrypted by macOS. Nothing is written into worktrees or Firstmate's state.                                                             |
| Every worker gets every key, so injected text in any task (an issue, a web page) can leak one it never needed   | Yes     | A project gets only the names granted to it, and only inside one command, never in the session's environment.                                                       |
| A value ends up in text: a brief, chat, a status line, a PR body or a transcript (which also goes to the model) | Mostly  | Agents handle names only. `run` hides each exact value in the command's output. A copy that is encoded, partial or changed is not caught (see [Masking](#masking)). |
| Wheelhouse: any local process can read its pages and token, and installed plugins share its process             | Yes     | Values never pass through Wheelhouse. No page or endpoint shows one, and nothing in Wheelhouse can grant or release one.                                            |
| A task misuses a secret it was granted                                                                          | Partly  | Grant narrowly. Every use is in the log, by task and project.                                                                                                       |
| A same-user process that sets out to get secrets                                                                | **No**  | Outside what a same-user design can stop.                                                                                                                           |

Wheelhouse has no button that grants a secret or approves a release. Any process on this computer, a worker included, can load a Wheelhouse page, read its session token and send requests as if it were you, so such a button would let a worker approve itself. Grants change only in a terminal.

## Store secrets

```sh
wh-vault set VERCEL_TOKEN            # asks for the value without showing it; or pipe it in
pbpaste | wh-vault set VERCEL_TOKEN  # from the clipboard
wh-vault import ~/firstmate/.env     # every NAME=value line, then delete the file yourself
```

A name is an environment variable name: letters, digits and underscores. `set` replaces any value already stored under that name. `import` reads the usual `.env` forms (`export` prefixes, `#` comments, quoted values). It reports lines it cannot read by line number only, since a line may hold a value. It never deletes the file: it prints the `rm` command once the values are stored.

Each value is one Keychain item: a generic password with the service `wheelhouse-vault` and the secret's name as its account. Values go to `security` on its standard input, never on a command line other processes can see. A value can be up to about 1,900 bytes, which fits tokens and keys but not most PEM files. A value with line breaks or characters outside printable ASCII is stored base64-encoded, so it can be about a quarter shorter.

## Grant them to projects

```sh
wh-vault grant VERCEL_TOKEN lumen atlas
wh-vault revoke VERCEL_TOKEN atlas
wh-vault remove VERCEL_TOKEN          # delete the value and its grants
wh-vault list --all                   # every secret, its projects, when it was set and last used
```

A project is named as Firstmate and Wheelhouse name it: its entry in Firstmate's project registry, which is also the folder name of its clone.

## Use them

Tell a task which names it can use, in its brief or the project's `AGENTS.md`:

```text
Secrets: VERCEL_TOKEN. Run commands that need it with `wh-vault run -- <command>`.
```

The task then runs:

```sh
wh-vault list                               # the names granted to this project
wh-vault run -- vercel deploy --prod        # every granted name, in this command only
wh-vault run --only VERCEL_TOKEN -- sh -c 'curl -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/v2/user'
```

`run` works out the project from the task's Firstmate record: `FM_TASK_ID` and the task's `state/<task>.meta`, found beside the steering inbox that `FM_TASK_INBOX` names (or under `FM_HOME`). Outside a Firstmate task, it uses the name of the repository the `origin` remote points to. A task id that no record matches falls back to the remote too. Without a project, or with nothing granted to it, `run` refuses and starts nothing.

The command's standard input is the terminal's. Its output reaches the terminal through a pipe, so the command does not see a terminal on standard output or standard error. Ctrl-C reaches the command as usual, and `run` passes SIGTERM and SIGHUP on to it.

| Exit status   | Meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| The command's | The command ran; 128 + the signal number if a signal ended it                                 |
| 125           | `wh-vault` refused (no project, a name not granted, nothing granted) or could not get a value |
| 126           | The command could not be run                                                                  |
| 127           | The command was not found                                                                     |

### Masking

`run` replaces every exact copy of a granted value in the command's output with `<concealed by wh-vault>`, as `op run` does, including a copy split across reads. It cannot catch a value that the command encodes (base64, URL-encoding, JSON escapes), reverses, prints in part, or writes to a file. Masking keeps a value out of a transcript by accident. It does not stop a command that sets out to reveal one.

## The Keychain and terminal sessions

The login Keychain answers a process only when it can reach your Mac login session. A terminal opened in that session (Terminal.app, iTerm, or a terminal server started from one) works. A terminal server started some other way, such as by `ssh` before you log in, can get **"User interaction is not allowed"** (`security` exit 36) for every read. Every pane it starts inherits that. Then `wh-vault run` stops with that message and logs the attempt as refused. It never runs the command without its secrets.

When that happens, run the command from a terminal in your login session, or restart the crew's terminal server from one.

An item that `wh-vault set` stored lets `security` read it without asking. For an item made some other way, such as in Keychain Access, macOS can ask whether `security` may use it. That dialog appears on your screen, and the read waits for an answer for up to two minutes.

## The usage log

```sh
wh-vault audit                              # newest first
wh-vault audit --task lumen-share-links     # one task's uses
wh-vault audit --project lumen --event run --json
```

Each line records when, which task and project, which names, the program run (without its arguments) and how it ended: `ok` with its exit status, `denied`, `unavailable` (the Keychain would not answer) or `failed` (the command did not start). It also records `set`, `remove`, `grant` and `revoke`. No line ever holds a value. `run` refuses to hand out values if it cannot write the log.

## Where things live

The vault folder in Wheelhouse's config directory holds names, grants and the log, never values: `$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`, or `--config-dir`.

```
<config dir>/vault/          0700
  vault.json                 0600  each secret's name, projects, and when it was created and last set
  audit.jsonl                0600  the usage log, one JSON line per event
```

## In Wheelhouse

The bundled **Vault** plugin reads the vault by running `wh-vault list --all --json` and `wh-vault audit --json`. Neither command reads a value. It is on by default and shows nothing until the vault holds a secret.

- **Vault** (a menu page): every secret, the projects it is granted to, when it was set and last used, the commands that change grants, and recent use.
- **Secrets** (a project tab): the names granted to that project and its recent use. It does not show for a project with no grants and no use.
- **Secrets used** (a tab on a task's page): each command the task ran with `wh-vault run`, and how it ended.

It runs the `wh-vault` bundled with Wheelhouse, else `wh-vault` on `PATH`. Set `bin` in its settings to use another:

```json
{ "plugins": { "vault": { "settings": { "bin": "/abs/path/to/wh-vault" } } } }
```

## Backends

`wh-vault` asks a backend only for values: `get`, `set` and `remove` by name (`cli/vault/backend.ts`). Names, grants, masking and the log stay the same whatever holds the values. The macOS login Keychain is the only backend today. Another one, such as 1Password through its `op` CLI, would fit behind the same interface, and the vault file records which backend holds its values.
