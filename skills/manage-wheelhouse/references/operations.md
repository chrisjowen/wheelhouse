# Wheelhouse operations reference

Generated from Wheelhouse 0.37.0 by `scripts/gen-operations.mjs`; do not edit it by hand. It lists every command with its `--help`, and every HTTP route with who may call it. Read only the section you need; SKILL.md says which command to reach for.

Route access: **read** needs no token (a GET from this computer); **agent token** takes `Authorization: Bearer <token>` from the running record, which the `wheelhouse` agent commands send for you; **page only** needs the open page’s session, so use a command or ask the captain; **captain only** is the captain’s own call and refuses the agent token with the page to make it on. Paths marked *experimental* answer 404 until that feature is on in Settings → Experimental features.

## `wheelhouse` commands

### wheelhouse

```text
Usage: wheelhouse [options] [command]

A local companion to Firstmate: watch the crew at work from a web UI.

Options:
  -V, --version      output the version number
  -h, --help         display help for command

Commands:
  open [options]     Start Wheelhouse, start (or show) the Firstmate session, and open it in the
                     browser; with no Firstmate yet, open the setup wizard.
  plugin [options]   Install and manage plugins from GitHub repositories.
  upgrade [options]  Upgrade Wheelhouse from its update source (the npm package, or a clone from
                     GitHub) and restart it.
  remote [options]   Reach this Wheelhouse from anywhere through a Wheelhouse Cloud gateway (off
                     until you start it on the Remotes page, or `remote run`).
  skills [options]   The agent skills Wheelhouse installs for Firstmate and its crew: what is
                     installed, what changed, and settling local edits.
  status [options]   Show the running Wheelhouse: version, Firstmate, installed agent skills and
                     updates.
  doctor [options]   Check the running Wheelhouse for problems, each with what to do about it.
  restart [options]  Restart the running Wheelhouse (Firstmate and its crew keep running); says
                     first what a restart would stop.
  service            A plugin's companion service: whether it is up, and starting it.
  passage            A project's passage (the steps its tasks walk) and its passage files.
  preview            Previews the captain sees embedded in Wheelhouse.
  inbox [options]    List what waits on the captain in Wheelhouse's inbox (read-only: the captain
                     answers there).
  help [command]     display help for command
```

### wheelhouse open

```text
Usage: wheelhouse open [options]

Start Wheelhouse, start (or show) the Firstmate session, and open it in the browser; with no
Firstmate yet, open the setup wizard.

Options:
  --firstmate <dir>         Firstmate code directory (default: the checkout you are in, else the one
                            setup remembered; with none, the page opens the setup wizard)
  --home <dir>              Firstmate operational home (default: $FM_HOME, else the one setup
                            remembered, else the code directory)
  --port <n>                port to listen on (default: 4310)
  --host <address>          the address to listen on: 127.0.0.1, ::1, or 0.0.0.0 or :: (every
                            interface) for a cloud IDE (Ona, Codespaces) that forwards only such
                            listeners, where anyone who can reach the port can use Wheelhouse
                            (default: $WHEELHOUSE_HOST, else 127.0.0.1)
  --allowed-hosts <hosts>   Host names Wheelhouse answers besides loopback, comma-separated, each
                            exact or *.suffix, such as *.example.dev for a cloud IDE's port forward;
                            their pages are served at https://<host> (http:// when X-Forwarded-Proto
                            says so) (default: $WHEELHOUSE_ALLOWED_HOSTS, else none)
  --preview-proxy <on|off>  serve each preview port at /_p/<port>/ on Wheelhouse's own address (HTTP
                            and WebSockets, sandboxed, X-Frame-Options dropped), for a cloud IDE
                            that frames only Wheelhouse; only ports Wheelhouse shows or
                            --preview-ports names, never its own (default:
                            $WHEELHOUSE_PREVIEW_PROXY, else off)
  --preview-ports <ports>   more ports the preview proxy may serve, comma-separated (default:
                            $WHEELHOUSE_PREVIEW_PORTS, else none)
  --state-dir <dir>         where Wheelhouse keeps its own records (default: $WHEELHOUSE_STATE_DIR,
                            else $XDG_STATE_HOME/wheelhouse, else ~/.local/state/wheelhouse)
  --tmux-socket <name>      a tmux server of its own (tmux -L <name>) for the Firstmate session
                            (default: $WHEELHOUSE_TMUX_SOCKET, else tmux's default server, which the
                            crew share)
  --session-backend <name>  what runs the Firstmate session: tmux, or herdr (experimental) (default:
                            $WHEELHOUSE_SESSION_BACKEND, else the setup wizard's choice, else herdr
                            when Firstmate's config/backend is herdr, else tmux)
  --herdr-session <name>    the herdr session the Firstmate session runs in with the herdr backend
                            (default: $WHEELHOUSE_HERDR_SESSION, else wheelhouse)
  --config-dir <dir>        the captain-owned Wheelhouse config, with per-project passage files in
                            projects/<id>.yaml (default: $WHEELHOUSE_CONFIG_DIR, else
                            $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)
  --plugins-dir <dir>       where installed plugins live (default: $WHEELHOUSE_PLUGINS_DIR, else
                            ~/.wheelhouse/plugins)
  --preview-url <pattern>   where a hosted dev environment serves this computer's ports, with {port}
                            once, such as https://{port}.example.dev, or a path on Wheelhouse's own
                            address such as /_p/{port}; previews and links to addresses on this
                            computer open there ("off" turns it off; default:
                            $WHEELHOUSE_PREVIEW_URL, else /_p/{port} with the preview proxy on, else
                            Gitpod's or Codespaces' own, detected)
  --no-browser              do not open the browser
  --enable <features>       enable experimental features for this launch: fleet, events, remotes,
                            hosted-second-mates, discussion, lanes, livereview, soundings
  --gateway <url>           register this Wheelhouse with a Gateway (default: the saved profile,
                            else https://fleetyard.io; requires Remotes enabled)
  --harness <name>          Firstmate tool: claude, codex, opencode, pi, grok (default: environment,
                            saved choice, or interactive picker; noninteractive fallback: claude)
  --no-skip-permissions     start Firstmate without --dangerously-skip-permissions, so Claude Code
                            asks before tools run (answer in the terminal drawer)
  -h, --help                display help for command
```

### wheelhouse plugin

```text
Usage: wheelhouse plugin [options] [command]

Install and manage plugins from GitHub repositories.

Options:
  --plugins-dir <dir>               where installed plugins live (default: $WHEELHOUSE_PLUGINS_DIR,
                                    else ~/.wheelhouse/plugins)
  --config-dir <dir>                the Wheelhouse config whose plugins.json keeps plugin settings
                                    (default: $WHEELHOUSE_CONFIG_DIR, else
                                    $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)
  -h, --help                        display help for command

Commands:
  install [options] <repo>          Install a plugin from org/repo, or org/repo@<tag, branch or
                                    commit>.
  list                              List installed plugins, their versions and pinned commits.
  update [options] <id>             Fetch the ref the plugin was installed from again (or --ref),
                                    and replace it.
  remove [options] <id>             Delete an installed plugin.
  enable [options] <id>             Turn an installed plugin on.
  disable [options] <id>            Turn an installed plugin off without removing it.
  search [options] [query]          Search the marketplace's plugins (by name, description or
                                    keyword).
  inspect [options] <repo>          Look a plugin up without installing it: what it is, the exact
                                    commit and what it may do.
  config [options] <id>             Show or change a plugin's settings, and where it is on; with no
                                    change, show them.
  role [options] <role> <provider>  Choose the plugin that takes a role (review.surface), or builtin
                                    for Wheelhouse’s own.
  help [command]                    display help for command
```

### wheelhouse plugin install

```text
Usage: wheelhouse plugin install [options] <repo>

Install a plugin from org/repo, or org/repo@<tag, branch or commit>.

Options:
  -y, --yes                  install without asking; settings take their defaults (for scripts)
  -s, --setting <key=value>  answer one of its settings (repeatable)
  -h, --help                 display help for command
```

### wheelhouse plugin list

```text
Usage: wheelhouse plugin list [options]

List installed plugins, their versions and pinned commits.

Options:
  -h, --help  display help for command
```

### wheelhouse plugin update

```text
Usage: wheelhouse plugin update [options] <id>

Fetch the ref the plugin was installed from again (or --ref), and replace it.

Options:
  --ref <ref>                a tag, branch or commit to move to
  -y, --yes                  update without asking; new settings take their defaults (for scripts)
  -s, --setting <key=value>  answer one of its settings (repeatable)
  -h, --help                 display help for command
```

### wheelhouse plugin remove

```text
Usage: wheelhouse plugin remove [options] <id>

Delete an installed plugin.

Options:
  -y, --yes   restart a running Wheelhouse without asking, even mid-work
  -h, --help  display help for command
```

### wheelhouse plugin enable

```text
Usage: wheelhouse plugin enable [options] <id>

Turn an installed plugin on.

Options:
  -y, --yes   restart a running Wheelhouse without asking, even mid-work
  -h, --help  display help for command
```

### wheelhouse plugin disable

```text
Usage: wheelhouse plugin disable [options] <id>

Turn an installed plugin off without removing it.

Options:
  -y, --yes   restart a running Wheelhouse without asking, even mid-work
  -h, --help  display help for command
```

### wheelhouse plugin search

```text
Usage: wheelhouse plugin search [options] [query]

Search the marketplace's plugins (by name, description or keyword).

Arguments:
  query        words to look for (all plugins when left out)

Options:
  --url <url>  the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --refresh    read the registries again now
  --json       print wheelhouse.plugin-search.v1
  -h, --help   display help for command
```

### wheelhouse plugin inspect

```text
Usage: wheelhouse plugin inspect [options] <repo>

Look a plugin up without installing it: what it is, the exact commit and what it may do.

Arguments:
  repo         org/repo, or org/repo@<tag, branch or commit>

Options:
  --url <url>  the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --json       print wheelhouse.plugin-inspect.v1
  -h, --help   display help for command
```

### wheelhouse plugin config

```text
Usage: wheelhouse plugin config [options] <id>

Show or change a plugin's settings, and where it is on; with no change, show them.

Arguments:
  id                 the plugin id

Options:
  --url <url>        the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --on               turn it on (for every project, or --project)
  --off              turn it off (for every project, or --project)
  --default          go back to its default (for every project, or --project)
  --project <id>     change it for one project only
  --set <key=value>  answer one of its settings (repeatable; key= clears it)
  --json             print wheelhouse.plugin-config.v1
  -h, --help         display help for command
```

### wheelhouse plugin role

```text
Usage: wheelhouse plugin role [options] <role> <provider>

Choose the plugin that takes a role (review.surface), or builtin for Wheelhouse’s own.

Arguments:
  role         the role: review.surface
  provider     the plugin id, or builtin

Options:
  --url <url>  the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --json       print wheelhouse.plugin-role.v1
  -h, --help   display help for command
```

### wheelhouse upgrade

```text
Usage: wheelhouse upgrade [options]

Upgrade Wheelhouse from its update source (the npm package, or a clone from GitHub) and restart it.

Options:
  --check              only say whether there is a newer version
  -y, --yes            upgrade (and restart, even mid-work) without asking
  --source <source>    switch the update source of the running Wheelhouse to published (npm) or
                       github (a clone), and restart from it
  --url <url>          the running Wheelhouse (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it (default:
                       $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --config-dir <dir>   the Wheelhouse config that keeps the update source, when none is running
                       (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse, else
                       ~/.config/wheelhouse)
  -h, --help           display help for command
```

### wheelhouse remote

```text
Usage: wheelhouse remote [options] [command]

Reach this Wheelhouse from anywhere through a Wheelhouse Cloud gateway (off until you start it on
the Remotes page, or `remote run`).

Options:
  --config-dir <dir>  the Wheelhouse config directory (default: $WHEELHOUSE_CONFIG_DIR, else
                      $XDG_CONFIG_HOME/wheelhouse, else ~/.config/wheelhouse)
  -h, --help          display help for command

Commands:
  connect [options]   Pair this machine with a gateway: shows a code to type there and a fingerprint
                      to check.
  status              Show whether this machine is connected, since when, the passkeys it trusts to
                      sign its sessions, and its relay sessions.
  pins                Show the passkeys this machine trusts to sign its sessions, and any change of
                      them the gateway asked for.
  disconnect          Revoke this machine on its gateway and delete its key here.
  on                  Turn Wheelhouse Cloud back on for this paired machine.
  off                 Turn Wheelhouse Cloud off: the connection closes and nothing is relayed, but
                      the pairing is kept.
  run [options]       Keep the connection up now, without starting it on the Remotes page, relaying
                      to the Wheelhouse on --port; pairs first when this machine is not paired yet.
  help [command]      display help for command
```

### wheelhouse remote connect

```text
Usage: wheelhouse remote connect [options]

Pair this machine with a gateway: shows a code to type there and a fingerprint to check.

Options:
  --gateway <url>  the gateway, such as https://cloud.example.com (remembered; default
                   https://fleetyard.io)
  --name <name>    the name this machine gets there (default: its host name)
  -h, --help       display help for command
```

### wheelhouse remote status

```text
Usage: wheelhouse remote status [options]

Show whether this machine is connected, since when, the passkeys it trusts to sign its sessions, and
its relay sessions.

Options:
  -h, --help  display help for command
```

### wheelhouse remote pins

```text
Usage: wheelhouse remote pins [options] [command]

Show the passkeys this machine trusts to sign its sessions, and any change of them the gateway asked
for.

Options:
  -h, --help    display help for command

Commands:
  approve [id]  Approve the change of trusted passkeys the gateway asked for, named by its id (at
                least 8 characters, as `pins` shows it): this machine trusts them from now on.
  reject [id]   Reject the change of trusted passkeys the gateway asked for, named by its id (at
                least 8 characters, as `pins` shows it): this machine keeps trusting the passkeys it
                does.
```

### wheelhouse remote pins approve

```text
Usage: wheelhouse remote pins approve [options] [id]

Approve the change of trusted passkeys the gateway asked for, named by its id (at least 8
characters, as `pins` shows it): this machine trusts them from now on.

Options:
  -h, --help  display help for command
```

### wheelhouse remote pins reject

```text
Usage: wheelhouse remote pins reject [options] [id]

Reject the change of trusted passkeys the gateway asked for, named by its id (at least 8 characters,
as `pins` shows it): this machine keeps trusting the passkeys it does.

Options:
  -h, --help  display help for command
```

### wheelhouse remote disconnect

```text
Usage: wheelhouse remote disconnect [options]

Revoke this machine on its gateway and delete its key here.

Options:
  -h, --help  display help for command
```

### wheelhouse remote on

```text
Usage: wheelhouse remote on [options]

Turn Wheelhouse Cloud back on for this paired machine.

Options:
  -h, --help  display help for command
```

### wheelhouse remote off

```text
Usage: wheelhouse remote off [options]

Turn Wheelhouse Cloud off: the connection closes and nothing is relayed, but the pairing is kept.

Options:
  -h, --help  display help for command
```

### wheelhouse remote run

```text
Usage: wheelhouse remote run [options]

Keep the connection up now, without starting it on the Remotes page, relaying to the Wheelhouse on
--port; pairs first when this machine is not paired yet.

Options:
  --port <n>       the port the local Wheelhouse listens on (default: 4310)
  --gateway <url>  the gateway to pair with, when this machine is not paired yet (default: the one
                   set, else https://fleetyard.io)
  --name <name>    the name this machine gets there (default: its host name)
  -h, --help       display help for command
```

### wheelhouse skills

```text
Usage: wheelhouse skills [options] [command]

The agent skills Wheelhouse installs for Firstmate and its crew: what is installed, what changed,
and settling local edits.

Options:
  --config-dir <dir>            the Wheelhouse config whose agent-material/ keeps the record
                                (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse,
                                else ~/.config/wheelhouse)
  -h, --help                    display help for command

Commands:
  status [options]              Show each item and its state (missing and outdated ones are what
                                `sync` would install or update), and any Firstmate drift.
  sync [ids...]                 Install missing items and update unchanged ones to this version;
                                naming items turns them on again.
  diff <id>                     Compare an item with what Wheelhouse wrote there and with this
                                version.
  accept [options] <id>         Replace a locally edited item with this version (the edited copy is
                                backed up).
  keep <id>                     Keep a locally edited item as it is until a later version changes it
                                again.
  adopt [options] <id>          Replace a copy Wheelhouse did not install with the bundled version,
                                and manage it from now on (the copy is backed up).
  uninstall [options] [ids...]  Remove items Wheelhouse installed (all of them, or those named) and
                                stop installing them; edited copies are left.
  help [command]                display help for command
```

### wheelhouse skills status

```text
Usage: wheelhouse skills status [options]

Show each item and its state (missing and outdated ones are what `sync` would install or update),
and any Firstmate drift.

Options:
  --json      print the full status as JSON (wheelhouse-skills-status.v1)
  -h, --help  display help for command
```

### wheelhouse skills sync

```text
Usage: wheelhouse skills sync [options] [ids...]

Install missing items and update unchanged ones to this version; naming items turns them on again.

Options:
  -h, --help  display help for command
```

### wheelhouse skills diff

```text
Usage: wheelhouse skills diff [options] <id>

Compare an item with what Wheelhouse wrote there and with this version.

Options:
  -h, --help  display help for command
```

### wheelhouse skills accept

```text
Usage: wheelhouse skills accept [options] <id>

Replace a locally edited item with this version (the edited copy is backed up).

Options:
  -y, --yes   replace without asking
  -h, --help  display help for command
```

### wheelhouse skills keep

```text
Usage: wheelhouse skills keep [options] <id>

Keep a locally edited item as it is until a later version changes it again.

Options:
  -h, --help  display help for command
```

### wheelhouse skills adopt

```text
Usage: wheelhouse skills adopt [options] <id>

Replace a copy Wheelhouse did not install with the bundled version, and manage it from now on (the
copy is backed up).

Options:
  -y, --yes   replace without asking
  -h, --help  display help for command
```

### wheelhouse skills uninstall

```text
Usage: wheelhouse skills uninstall [options] [ids...]

Remove items Wheelhouse installed (all of them, or those named) and stop installing them; edited
copies are left.

Options:
  -y, --yes   remove without asking
  -h, --help  display help for command
```

### wheelhouse status

```text
Usage: wheelhouse status [options]

Show the running Wheelhouse: version, Firstmate, installed agent skills and updates.

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --json               print wheelhouse.status.v1
  -h, --help           display help for command
```

### wheelhouse doctor

```text
Usage: wheelhouse doctor [options]

Check the running Wheelhouse for problems, each with what to do about it.

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --json               print wheelhouse.doctor.v1
  -h, --help           display help for command
```

### wheelhouse restart

```text
Usage: wheelhouse restart [options]

Restart the running Wheelhouse (Firstmate and its crew keep running); says first what a restart
would stop.

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  -y, --yes            restart without asking, even mid-work
  -h, --help           display help for command
```

### wheelhouse service

```text
Usage: wheelhouse service [options] [command]

A plugin's companion service: whether it is up, and starting it.

Options:
  -h, --help                           display help for command

Commands:
  status [options] <plugin> <service>  Say whether the service is up.
  start [options] <plugin> <service>   Start the service and wait until it is up or has failed.
  help [command]                       display help for command
```

### wheelhouse service status

```text
Usage: wheelhouse service status [options] <plugin> <service>

Say whether the service is up.

Arguments:
  plugin               the plugin id
  service              the service, as the plugin names it

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --project <id>       for one project
  --json               print wheelhouse.service.v1
  -h, --help           display help for command
```

### wheelhouse service start

```text
Usage: wheelhouse service start [options] <plugin> <service>

Start the service and wait until it is up or has failed.

Arguments:
  plugin               the plugin id
  service              the service, as the plugin names it

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --project <id>       for one project
  --json               print wheelhouse.service.v1
  -h, --help           display help for command
```

### wheelhouse passage

```text
Usage: wheelhouse passage [options] [command]

A project's passage (the steps its tasks walk) and its passage files.

Options:
  -h, --help                           display help for command

Commands:
  show [options] <project>             Show the project's passage: its steps, where each comes from,
                                       and what waits on the captain.
  get [options] <project>              Print a passage file (its digest goes to stderr, for `passage
                                       apply --base`).
  check [options] <project> <yaml>     Check a passage file as it would apply, without saving it.
  apply [options] <project> <yaml>     Save a passage file, only if it is unchanged since you read
                                       it (exit 5 when it changed).
  add-step [options] <project> <step>  Add Released, On npm or Deployed to the passage from a
                                       preset, checked and saved like `passage apply`.
  help [command]                       display help for command
```

### wheelhouse passage show

```text
Usage: wheelhouse passage show [options] <project>

Show the project's passage: its steps, where each comes from, and what waits on the captain.

Arguments:
  project              the project id

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --json               print wheelhouse.passage-show.v1
  -h, --help           display help for command
```

### wheelhouse passage get

```text
Usage: wheelhouse passage get [options] <project>

Print a passage file (its digest goes to stderr, for `passage apply --base`).

Arguments:
  project              the project id

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --file <which>       which passage file: captain (your Wheelhouse config, applies within a minute)
                       or project (the repository’s .wheelhouse.yaml, applies once committed)
                       (default: "captain")
  --json               print wheelhouse.passage-get.v1
  -h, --help           display help for command
```

### wheelhouse passage check

```text
Usage: wheelhouse passage check [options] <project> <yaml>

Check a passage file as it would apply, without saving it.

Arguments:
  project              the project id
  yaml                 the passage file to check, or - for stdin

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --file <which>       which passage file: captain (your Wheelhouse config, applies within a minute)
                       or project (the repository’s .wheelhouse.yaml, applies once committed)
                       (default: "captain")
  --json               print wheelhouse.passage-check.v1
  -h, --help           display help for command
```

### wheelhouse passage apply

```text
Usage: wheelhouse passage apply [options] <project> <yaml>

Save a passage file, only if it is unchanged since you read it (exit 5 when it changed).

Arguments:
  project              the project id
  yaml                 the passage file to save, or - for stdin

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --base <digest>      the digest `passage get` printed, or new for a file that does not exist yet
  --file <which>       which passage file: captain (your Wheelhouse config, applies within a minute)
                       or project (the repository’s .wheelhouse.yaml, applies once committed)
                       (default: "captain")
  --json               print wheelhouse.passage-apply.v1
  -h, --help           display help for command
```

### wheelhouse passage add-step

```text
Usage: wheelhouse passage add-step [options] <project> <step>

Add Released, On npm or Deployed to the passage from a preset, checked and saved like `passage
apply`.

Arguments:
  project               the project id
  step                  the step to add: released, on-npm, deployed

Options:
  --url <url>           the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>   the plugins directory the running Wheelhouse loads from, to find it and its
                        token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --package <name>      on-npm: the npm package the project publishes
  --environment <name>  deployed: the GitHub deployment environment, such as Production
  --workflow <file>     deployed: the GitHub Actions workflow that deploys, such as deploy.yml
  --after <step>        the step it follows (default: landed for released, released for on-npm, the
                        last step for deployed)
  --file <which>        which passage file: captain (your Wheelhouse config, applies within a
                        minute) or project (the repository’s .wheelhouse.yaml, applies once
                        committed) (default: "captain")
  --dry-run             print the file it would save, and save nothing
  --json                print wheelhouse.passage-add-step.v1
  -h, --help            display help for command
```

### wheelhouse preview

```text
Usage: wheelhouse preview [options] [command]

Previews the captain sees embedded in Wheelhouse.

Options:
  -h, --help             display help for command

Commands:
  check [options] [url]  Say whether a preview shows embedded now (exit 0) or why not (exit 1): a
                         task’s reported preview, or an address Wheelhouse has shown.
  help [command]         display help for command
```

### wheelhouse preview check

```text
Usage: wheelhouse preview check [options] [url]

Say whether a preview shows embedded now (exit 0) or why not (exit 1): a task’s reported preview, or
an address Wheelhouse has shown.

Arguments:
  url                  the preview address, on this computer

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --task <id>          the task whose reported preview to check
  --json               print wheelhouse.preview-check.v1
  -h, --help           display help for command
```

### wheelhouse inbox

```text
Usage: wheelhouse inbox [options]

List what waits on the captain in Wheelhouse's inbox (read-only: the captain answers there).

Options:
  --url <url>          the Wheelhouse to talk to (default: $WHEELHOUSE_URL, else the one running)
  --plugins-dir <dir>  the plugins directory the running Wheelhouse loads from, to find it and its
                       token (default: $WHEELHOUSE_PLUGINS_DIR, else ~/.wheelhouse/plugins)
  --json               print wheelhouse.inbox.v1
  -h, --help           display help for command
```

## `wh-vault` commands

### wh-vault

```text
Usage: wh-vault [options] [command]

Secrets for Firstmate’s crew by name, never by value: values stay in the macOS login Keychain, or
the Secret Service keyring on Linux, and a project’s granted secrets reach one command at a time.

Options:
  -V, --version                output the version number
  --config-dir <dir>           the Wheelhouse config directory whose vault folder holds the vault
                               (default: $WHEELHOUSE_CONFIG_DIR, else $XDG_CONFIG_HOME/wheelhouse,
                               else ~/.config/wheelhouse)
  -h, --help                   display help for command

Commands:
  set <name>                   Store a value under NAME in the keychain, typed without echo (or
                               piped on stdin); replaces any value already there.
  import <file>                Store every NAME=value line of a .env file in the keychain, then show
                               how to delete the file.
  list [options]               The secret names granted to this project (a Firstmate task’s, else
                               the origin remote’s), or with --all every secret and its grants.
                               Never values.
  grant <name> <projects...>   Let commands run for these projects receive NAME.
  revoke <name> <projects...>  Stop commands run for these projects receiving NAME.
  remove <name>                Delete NAME’s value from the keychain and its grants from the vault.
  run [options] <command...>   Run one command with this project’s granted secrets in its
                               environment, hiding their values in its output and logging the use by
                               name.
  backend [options] [id]       Where this vault keeps its values and whether a value can be stored
                               there now; with an id, keep them in that backend instead (keychain or
                               secret-service or env-file), while the vault holds no secret. Never
                               values.
  audit [options]              The usage log, newest first: who used which names, when, for what and
                               how it ended. Never values.
  help [command]               display help for command
```

### wh-vault set

```text
Usage: wh-vault set [options] <name>

Store a value under NAME in the keychain, typed without echo (or piped on stdin); replaces any value
already there.

Options:
  -h, --help  display help for command
```

### wh-vault import

```text
Usage: wh-vault import [options] <file>

Store every NAME=value line of a .env file in the keychain, then show how to delete the file.

Options:
  -h, --help  display help for command
```

### wh-vault list

```text
Usage: wh-vault list [options]

The secret names granted to this project (a Firstmate task’s, else the origin remote’s), or with
--all every secret and its grants. Never values.

Options:
  --all       every secret, with the projects it is granted to and when it was set and used
  --json      machine-readable output
  -h, --help  display help for command
```

### wh-vault grant

```text
Usage: wh-vault grant [options] <name> <projects...>

Let commands run for these projects receive NAME.

Options:
  -h, --help  display help for command
```

### wh-vault revoke

```text
Usage: wh-vault revoke [options] <name> <projects...>

Stop commands run for these projects receiving NAME.

Options:
  -h, --help  display help for command
```

### wh-vault remove

```text
Usage: wh-vault remove [options] <name>

Delete NAME’s value from the keychain and its grants from the vault.

Options:
  -h, --help  display help for command
```

### wh-vault run

```text
Usage: wh-vault run [options] <command...>

Run one command with this project’s granted secrets in its environment, hiding their values in its
output and logging the use by name.

Arguments:
  command         the command and its arguments, after --

Options:
  --only <names>  hand over only these names (comma-separated, or repeat --only)
  -h, --help      display help for command
```

### wh-vault backend

```text
Usage: wh-vault backend [options] [id]

Where this vault keeps its values and whether a value can be stored there now; with an id, keep them
in that backend instead (keychain or secret-service or env-file), while the vault holds no secret.
Never values.

Options:
  --json      machine-readable output
  -h, --help  display help for command
```

### wh-vault audit

```text
Usage: wh-vault audit [options]

The usage log, newest first: who used which names, when, for what and how it ended. Never values.

Options:
  --project <id>   only this project
  --task <id>      only this Firstmate task
  --name <name>    only uses of this secret
  --event <event>  only run, set, remove, grant or revoke
  --limit <n>      at most this many (default 50)
  --json           machine-readable output
  -h, --help       display help for command
```

## HTTP routes

| Route | Method | Access |
| --- | --- | --- |
| `/api/wheelhouse/restart` | GET, POST | agent token (served by the `wheelhouse` watcher, not the app; `wheelhouse restart` calls it) |
| `/_p/<port>/…` | any, and WebSockets | read: the preview on `127.0.0.1:<port>`, sandboxed, only while `--preview-proxy on` (`$WHEELHOUSE_PREVIEW_PROXY`), and only for a port Wheelhouse shows or `--preview-ports` names, never its own (served by the server's preview proxy, not the app) |
| `/api/apps/[op]` | POST | captain only |
| `/api/cloud` | GET | read (experimental: remotes) |
| `/api/cloud` | POST | captain only (experimental: remotes) |
| `/api/cloud/previews` | GET | read (experimental: remotes) |
| `/api/crew` | GET | read |
| `/api/crew` | POST | page only |
| `/api/crew/messages` | POST | page only |
| `/api/documents` | GET | read |
| `/api/documents/briefing` | POST | page only |
| `/api/events` | GET | read |
| `/api/features` | GET | read |
| `/api/features` | POST | page only |
| `/api/files` | GET | read |
| `/api/firstmate/chat` | GET | read |
| `/api/firstmate/chat/archive` | GET | read |
| `/api/firstmate/chat/archive` | POST | page only |
| `/api/firstmate/chat/history` | GET | read |
| `/api/firstmate/chat/search` | GET | read |
| `/api/firstmate/cleared` | GET | read |
| `/api/firstmate/cleared` | POST | page only |
| `/api/firstmate/commands` | GET | read |
| `/api/firstmate/dismiss` | POST | captain only |
| `/api/firstmate/input` | POST | captain only |
| `/api/firstmate/interrupt` | POST | captain only |
| `/api/firstmate/messages` | GET | read |
| `/api/firstmate/messages` | POST | captain only |
| `/api/firstmate/pick` | POST | captain only |
| `/api/firstmate/reactions` | GET | read |
| `/api/firstmate/reactions` | POST | page only |
| `/api/firstmate/signin` | POST | page only |
| `/api/firstmate/start` | POST | page only |
| `/api/firstmate/uploads` | POST | page only |
| `/api/firstmate/uploads/[day]/[id]/[name]` | GET | read |
| `/api/fleet` | GET | read |
| `/api/fleet/membership` | GET | read |
| `/api/fleet/membership` | POST | captain only |
| `/api/health` | GET | read |
| `/api/inbox` | GET | read |
| `/api/inbox` | POST | captain only |
| `/api/inbox/following` | POST | captain only |
| `/api/inbox/report` | GET | read |
| `/api/inbox/talk` | POST | captain only |
| `/api/insights` | GET | read |
| `/api/library/doc` | GET | read |
| `/api/library/promote` | POST | page only |
| `/api/live` | POST | page only (experimental: discussion) |
| `/api/live/[id]/end` | POST | page only (experimental: discussion) |
| `/api/live/[id]/events` | GET | read (experimental: discussion) |
| `/api/live/[id]/interrupt` | POST | page only (experimental: discussion) |
| `/api/live/[id]/say` | POST | page only (experimental: discussion) |
| `/api/live/image` | POST | page only (experimental: discussion) |
| `/api/live/scouts` | GET | read (experimental: discussion) |
| `/api/live/settings` | GET | read (experimental: discussion) |
| `/api/live/settings` | POST | page only (experimental: discussion) |
| `/api/material` | GET | read |
| `/api/material` | POST | page only |
| `/api/plugins` | GET | read |
| `/api/plugins/[plugin]/config` | GET | read |
| `/api/plugins/[plugin]/config` | POST | agent token |
| `/api/plugins/[plugin]/feedback` | POST | page only |
| `/api/plugins/[plugin]/feedback/summary` | POST | page only |
| `/api/plugins/[plugin]/icon/[icon]` | GET | read |
| `/api/plugins/[plugin]/load` | POST | agent token |
| `/api/plugins/[plugin]/ui/[...path]` | GET | read |
| `/api/plugins/[plugin]/update` | POST | agent token |
| `/api/plugins/inspect` | POST | agent token |
| `/api/plugins/install` | POST | agent token |
| `/api/plugins/marketplace` | GET | read |
| `/api/plugins/marketplace/icon/[name]` | GET | read |
| `/api/plugins/marketplace/registries` | POST | page only |
| `/api/plugins/roles` | POST | agent token |
| `/api/plugins/updates` | GET | read |
| `/api/plugins/updates` | POST | page only |
| `/api/previews/check` | GET | read |
| `/api/projects/[id]/passage` | GET | read |
| `/api/projects/[id]/passage/commands` | POST | captain only |
| `/api/projects/[id]/passage/consent` | POST | captain only |
| `/api/projects/[id]/passage/draft` | POST | agent token |
| `/api/projects/[id]/passage/file` | GET | read |
| `/api/projects/[id]/passage/file` | PUT | agent token |
| `/api/projects/[id]/passage/test` | POST | captain only |
| `/api/quota-keys` | GET | read |
| `/api/quota-keys` | POST | page only |
| `/api/second-mate-setup` | GET | read (experimental: hosted-second-mates) |
| `/api/second-mate-setup` | POST | captain only (experimental: hosted-second-mates) |
| `/api/second-mates/[id]/link` | GET | read |
| `/api/second-mates/[id]/link` | POST | captain only |
| `/api/second-mates/[id]/peek` | GET | read |
| `/api/services` | GET | read |
| `/api/services` | POST | agent token |
| `/api/setup` | GET | read |
| `/api/setup` | POST | captain only |
| `/api/slots` | GET | read |
| `/api/soundings` | GET | read (experimental: soundings) |
| `/api/soundings` | POST | page only (experimental: soundings) |
| `/api/soundings/beacon` | POST | page only (experimental: soundings) |
| `/api/soundings/settings` | POST | page only (experimental: soundings) |
| `/api/tasks/[id]` | GET | read |
| `/api/tasks/[id]/artifacts/[...name]` | GET | read |
| `/api/tasks/[id]/chat` | GET | read |
| `/api/tasks/[id]/diff` | GET | read |
| `/api/tasks/[id]/livereview` | POST | page only (experimental: livereview) |
| `/api/tasks/[id]/output` | GET | read |
| `/api/tasks/[id]/preview` | GET | read |
| `/api/tasks/[id]/preview/helper` | POST | page only |
| `/api/vault` | GET | read |
| `/api/vault` | POST | captain only |
| `/api/voice` | GET | read |
| `/api/voice` | POST | page only |
| `/api/voice/hear` | POST | page only |
| `/api/voice/speak` | POST | page only |
| `/api/wh-events` | GET | read (experimental: events) |
| `/api/wh-events` | POST | page only (experimental: events) |
| `/api/wheelhouse/source` | POST | agent token |
| `/api/wheelhouse/update` | GET | read |
| `/api/wheelhouse/update` | POST | agent token |
| `/api/wheelhouse/upgrade` | POST | agent token |
| `/library/[shelf]/[folder]/[slug]/files/[...path]` | GET | read |
| `/projects` | GET | read |
| `/r/[task]` | GET | read |
| `/records/[project]/[task]/files/[...path]` | GET | read |
| `/tasks/[id]/live` | GET | read (experimental: livereview) |
| `/tasks/[id]/review` | GET | read |
