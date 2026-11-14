# The vault: secrets by name

`wh-vault` gives Firstmate's crew the secrets a project needs (deploy tokens, API keys) without any agent handling a value. Values live in the macOS login Keychain on a Mac, and on Linux in the login keyring (the Secret Service) or, only if you opt in, a plaintext env file (see [On Linux](#on-linux)). Agents handle only names. A command run with `wh-vault run -- <command>` gets its project's granted secrets in its own environment and nowhere else. Its output comes back with those values hidden, and the use is logged by name. Wheelhouse's **Vault** page shows names, grants and use, never a value. You can add, grant, revoke and remove secrets there or in a terminal, and add one from the Firstmate chat, including one Firstmate asks for (see [In Wheelhouse](#in-wheelhouse)).

`wh-vault` ships with Wheelhouse: installing `@chrisjowen/wheelhouse` puts both `wheelhouse` and `wh-vault` on your `PATH`. It works on macOS and Linux (see [Backends](#backends)).

## What it protects, and what it does not

Workers run as you, the same OS user, often with permission prompts turned off. **Grants limit accidents and how far a prompt injection can reach. They do not stop a worker that sets out to get a secret.** A process running as you can call `security find-generic-password` (on Linux `secret-tool lookup`, or read the opt-in env file) itself, set `FM_TASK_ID` to another task's id, edit the vault file, or read another process's environment. Real isolation would mean running workers as a separate OS user or in a VM. The vault does not do that.

| Risk                                                                                                            | Covered | How                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A plaintext `.env` that other users can read, copied into backups or committed by mistake                       | Yes     | Values are in the Keychain, encrypted by macOS, or the Linux keyring, encrypted by it. Nothing is written into worktrees or Firstmate's state. The opt-in env file is the exception: see [On Linux](#on-linux). |
| Every worker gets every key, so injected text in any task (an issue, a web page) can leak one it never needed   | Yes     | A project gets only the names granted to it, and only inside one command, never in the session's environment.                                                                                                   |
| A value ends up in text: a brief, chat, a status line, a PR body or a transcript (which also goes to the model) | Mostly  | Agents handle names only. `run` hides each exact value in the command's output. A copy that is encoded, partial or changed is not caught (see [Masking](#masking)).                                             |
| Wheelhouse: any local process can read its pages and token, and installed plugins share its process             | Partly  | No page or endpoint shows or releases a value. A value you add on the Vault page or in the chat passes through Wheelhouse's process once. Grants can change there (see below).                                  |
| A task misuses a secret it was granted                                                                          | Partly  | Grant narrowly. Every use is in the log, by task and project.                                                                                                                                                   |
| A same-user process that sets out to get secrets                                                                | **No**  | Outside what a same-user design can stop.                                                                                                                                                                       |

Grants can change from Wheelhouse's Vault page as well as in a terminal. Any process on this computer, a worker included, can load a Wheelhouse page, read its session token and send requests as if it were you, so any local process that can reach Wheelhouse with that token could grant itself a secret there. A worker running as you could already run `wh-vault grant` itself, so this adds a second way in, not a new kind of risk. Wheelhouse still has no page or endpoint that shows a value or releases one to a command.

## Store secrets

On Wheelhouse's **Vault** page, **Add a secret** asks for a name, a value and, optionally, the projects that may use it; the key button in the Firstmate chat opens the same form as a popup (see [In Wheelhouse](#in-wheelhouse)). In a terminal:

```sh
wh-vault set VERCEL_TOKEN            # asks for the value without showing it; or pipe it in
pbpaste | wh-vault set VERCEL_TOKEN  # from the clipboard
wh-vault import ~/firstmate/.env     # every NAME=value line, then delete the file yourself
```

A name is an environment variable name: letters, digits and underscores, up to 128 characters. `set` replaces any value already stored under that name. `import` reads the usual `.env` forms (`export` prefixes, `#` comments, quoted values). It reports lines it cannot read by line number only, since a line may hold a value. It never deletes the file: it prints the `rm` command once the values are stored.

Each value is one Keychain item: a generic password with the service `wheelhouse-vault` and the secret's name as its account. Values go to `security` on its standard input, never on a command line other processes can see. A value can be up to about 1,900 bytes, which fits tokens and keys but not most PEM files. A value with line breaks or characters outside printable ASCII is stored base64-encoded, so it can be about a quarter shorter.

On Linux, values go to the Secret Service keyring or the opt-in env file instead: see [On Linux](#on-linux).

## Grant them to projects

On the Vault page, open a secret and tick or untick its projects. In a terminal:

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

## On Linux

On Linux, `wh-vault` keeps values in the **Secret Service**: the login keyring a desktop session runs (GNOME Keyring, KWallet, KeePassXC), which encrypts them and unlocks with your login. It reaches it through libsecret's `secret-tool` (the `libsecret-tools` package on Debian and Ubuntu, `libsecret` on Fedora and Arch). Each value is one keyring item with the attributes `service wheelhouse-vault` and `account <name>`, labelled `wheelhouse-vault <name>`. Values go to `secret-tool store` on its standard input, never on a command line. A value can be up to 8,191 bytes; `secret-tool` would cut a longer one short, so `wh-vault set` refuses it. Names, grants, `list`, `run`, masking and the log work exactly as on a Mac.

`wh-vault backend` says where this vault keeps its values and whether a value can be stored there now, and why not when it cannot. It reads no value. Nothing can be stored, and it says which, when:

- `secret-tool` is not installed;
- there is no D-Bus session (`DBUS_SESSION_BUS_ADDRESS` unset and no desktop login), as on most servers;
- no keyring daemon is running in that session, or it has no default keyring;
- the keyring is locked and cannot ask to be unlocked here. Unlock it, by logging in to the desktop or in a keyring manager, and try again. A locked keyring also stops `run` and `remove`, which say so rather than run without values or leave a value behind.

Whether the default keyring is locked is read with glib's `gdbus`, as the keyring's `Locked` property, which holds no value. Without `gdbus`, a locked keyring shows as a value that is not there.

### Without a keyring: the env file

A server with no desktop login usually has no keyring. There you can opt in to keeping values in an env file instead:

```sh
wh-vault backend env-file        # while the vault holds no secret
wh-vault backend secret-service  # back to the keyring, while it holds none
```

**The env file is plaintext at rest.** It is protected only by its file permissions: anything that runs as you, and anyone with root or a copy of your disk or backups, can read every value in it. Prefer the Secret Service wherever a keyring exists. `wh-vault` never picks the env file on its own: without the opt-in and without a keyring, it says plainly that values cannot be stored here and, while the vault holds no secret, how to opt in. When the vault already holds secrets in the keyring, it says to use `wh-vault` from a session that can reach it, such as the desktop session.

The file is `values.env` in the vault folder (below), outside any repository, one `NAME="value"` line per secret in the double-quoted form `wh-vault import` reads. `wh-vault` creates it 0600 in the 0700 vault folder, sets both again on every write, and writes it whole to a new private file that then replaces it, so a reader never sees half of it. A values file that others can read, that belongs to someone else or that is a link is refused, not used. Values reach it only from `wh-vault`'s own memory, never through a command line or a log. The vault file records the choice (`"backend": "env-file"`), so `wh-vault` in every terminal, and Wheelhouse, use the same one. `wh-vault` does not move values between backends: to switch, remove the secrets first and store them again.

## The usage log

```sh
wh-vault audit                              # newest first
wh-vault audit --task lumen-share-links     # one task's uses
wh-vault audit --project lumen --event run --json
```

Each line records when, which task and project, which names, the program run (without its arguments) and how it ended: `ok` with its exit status, `denied`, `unavailable` (the Keychain or keyring would not answer) or `failed` (the command did not start). It also records `set`, `remove`, `grant` and `revoke`. No line ever holds a value. `run` refuses to hand out values if it cannot write the log.

## Where things live

The vault folder in Wheelhouse's config directory holds names, grants and the log, never values: `$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`, or `--config-dir`.

```
<config dir>/vault/          0700
  vault.json                 0600  each secret's name, projects, and when it was created and last set
  audit.jsonl                0600  the usage log, one JSON line per event
  values.env                 0600  on Linux, only with `wh-vault backend env-file`: the values, in plaintext
```

Except for that opt-in file, the folder holds no value.

## In Wheelhouse

The bundled **Vault** plugin reads the vault by running `wh-vault list --all --json` and `wh-vault audit --json`. Neither command reads a value. It is on by default.

- **Vault** (a menu page): every secret, the projects it is granted to, when it was set and last used, and recent use. It is there even when the vault is empty, so you can add the first secret from it.
  - **Add a secret**: a name, a value and, optionally, the projects that may use it. Storing a name that already exists replaces its value.
  - Opening a secret's row shows its projects as tick boxes (a tick grants it, an untick revokes it), **Replace value**, and **Remove…**, which asks first and deletes the value from the Keychain (or keyring, or env file) along with its grants.
- **Secrets** (a project tab): the names granted to that project and its recent use, with a link to the Vault page to change them. It does not show for a project with no grants and no use.
- **Secrets used** (a tab on a task's page): each command the task ran with `wh-vault run`, and how it ended.
- **Add a secret from the chat**: see [From the chat](#from-the-chat).

The plugin itself stays read-only, like every plugin. The Vault page is drawn by Wheelhouse's own panel, and its buttons go to Wheelhouse, not to the plugin: a POST to `/api/vault`, which, like every Wheelhouse request that changes something, must come from the page's own origin with this launch's session token. Wheelhouse then runs the bundled `wh-vault`, one change at a time, as `wh-vault set`, `grant`, `revoke` or `remove`, so the vault file, the stored value and the usage log come out exactly as they do from a terminal. Changes made there are logged with no task.

A value you type there, or in the chat's popup, is sent once, in that request, to Wheelhouse on this computer. Wheelhouse passes it to `wh-vault set` on its standard input, the same way `pbpaste | wh-vault set NAME` does, and keeps nothing. It is never on a command line, in a log, in Wheelhouse's state, in `plugins.json` or in an answer, and the page forgets it as soon as it is sent. No page shows a stored value again. For that moment the value is in Wheelhouse's process, where installed plugins also run. To keep a value out of Wheelhouse altogether, store it in a terminal instead.

The page runs only the `wh-vault` bundled with Wheelhouse. Until that is built (`npm run build`, when running from a checkout), the Vault page does not show. The page says where values go (your Mac's login Keychain, the Linux keyring, or the env file) and, when this computer cannot store a value, says why at the top and turns off **Add a secret** and **Replace value**. Wheelhouse checks before it hands a value to `wh-vault set`, and refuses with 503 when it cannot: on a Mac, that it is one; on Linux, what `wh-vault backend --json` says, which reads no value (Wheelhouse passes `wh-vault` the `DBUS_SESSION_BUS_ADDRESS` and `XDG_RUNTIME_DIR` it was started with, so it reaches the same keyring as your terminal); anywhere else, nothing can be stored.

### From the chat

The key button beside the paperclip under the Firstmate chat opens **Add a secret** as a popup: a name, a value in a hidden field, and tick boxes for the projects that may use it (optional). **Store secret** stores it as the Vault page does (`POST /api/vault`, Origin and session token checked, the value to `wh-vault set` on its standard input). The popup asks Wheelhouse first whether this computer can store a value (`GET /api/vault`, which names no secret); when this computer cannot store one it says why, and the value field stays off. A name that is not an environment variable name is refused before anything is sent.

The popup sends with `replace: false`, so a name the vault already holds is refused with 409 and nothing is stored. The popup empties the value field and asks "A secret named <name> already exists. Replace it?" with **Replace** and **Cancel**. **Replace** brings back the hidden field, empty, for you to type the value again, and **Replace its value** then stores it with `replace: true`; **Cancel** closes the popup. Once a request is answered, stored or not, the field is emptied, and when the popup is cancelled or closed its form leaves the page. While a request is running the popup cannot be closed, Escape included.

When a secret is stored, the chat sends Firstmate one message naming it and the projects that can use it, never the value:

```text
Stored secret VERCEL_TOKEN in the vault. lumen can use it.
```

Without a Firstmate session to send to (or while it waits on a menu, a sign-in or its terminal), the chat shows that line above the message box instead, saying Firstmate was not told.

#### When Firstmate asks for a secret

Firstmate asks for a secret by putting a fenced `vault-request` block in a reply:

````text
```vault-request
name: VERCEL_TOKEN
purpose: Deploy lumen to production
projects: lumen
```
````

`name` is required and must be a secret name. `purpose` (one line, up to 300 characters) and `projects` (project ids, separated by commas or spaces) are optional. Each line is `field: words`, and each field appears at most once. The chat shows the reply without the block and, under it, a card: **Firstmate asks for VERCEL_TOKEN**, the purpose, and **Add VERCEL_TOKEN…**. Clicking it opens the popup with the name filled in, the purpose under its title and the named projects ticked (only those Wheelhouse knows; it says which others Firstmate named). Nothing opens or is sent until you click, and you type the value: a block never carries one. A block with any other line (such as `value:`), a bad name or project, or a repeated field is not a request and shows as the code block it is. A reply may hold several blocks, anywhere in it. Once a `Stored secret <name> in the vault.` message follows a request, in the transcript, in Wheelhouse's record of what it sent to Firstmate's inbox, or still being sent, its card shows **Stored in the vault** (and offers **Store again…**).

### API keys for the agent

When the [setup wizard](guide.md#setting-up-firstmate) sets up Codex or Pi with an API key, you paste the key into the wizard's agent step once (`POST /api/setup`, Origin and session token checked, from this computer only). Wheelhouse stores it as the Vault page does, under a name of the agent's own: `WHEELHOUSE_AGENT_OPENAI_API_KEY` or `WHEELHOUSE_AGENT_ANTHROPIC_API_KEY`. It never touches `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, which a project's tasks may use. It grants the key to no project, so no task's `wh-vault run` gets it. When the vault already holds that name, the wizard stores nothing and asks first: **Replace it and sign in** replaces the value, and **Keep the one there** leaves it. It then gives the key to the agent's own sign-in once:

- Codex: `codex login --with-api-key`, with the key on its standard input.
- Pi: an `api_key` entry in Pi's `auth.json` (`$PI_CODING_AGENT_DIR`, else `~/.pi/agent`), written whole to a private file (0600) that then replaces it, keeping every other entry.

The agent keeps that copy, as it keeps a subscription sign-in. The key never goes on a command line, into the page's answer, a log or the chat. The Vault page shows the secret's name like any other. To change the key, run the wizard's agent step again, or replace the value on the Vault page and sign the agent in again from the wizard.

On a Linux server with no keyring, the vault can store a value only after you opt in to the env file (see [Without a keyring: the env file](#without-a-keyring-the-env-file)); until then the wizard says so and stores nothing.

## Backends

`wh-vault` asks a backend only for values: `get`, `set` and `remove` by name (`cli/vault/backend.ts`). Names, grants, masking and the log stay the same whatever holds the values. `cli/vault/select.ts` picks it by platform: the macOS login Keychain on a Mac (`keychain`, and on any platform other than Linux, as before), and on Linux the Secret Service (`secret-service`) or, once opted in, the env file (`env-file`). The vault file records which backend holds its values, and `wh-vault backend` shows it and whether a value can be stored there now. Another one, such as 1Password through its `op` CLI, would fit behind the same interface.
