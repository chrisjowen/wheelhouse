# Passage files

A project can extend the built-in passage with steps of its own, such as **Deployed**, **Released** or **On npm**, and the checks that tell Wheelhouse when a task has reached them. A passage has two parts: **checks** observe something (a GitHub deployment, a release, an HTTP endpoint), and **stages** are rules over those observations and Firstmate's own facts.

Wheelhouse reads passage files from two places, layered over its built-in passages:

1. **The project's `.wheelhouse.yaml`**, read with `git cat-file` from the tip of the default branch (`origin/HEAD`, else `origin/main` or `origin/master`) of Firstmate's clone of the project, `<home>/projects/<id>`. Never from a working tree, another branch or a task's worktree, so a crewmate cannot declare or change the check that clears its own work.
2. **The captain-owned file** `<config dir>/projects/<id>.yaml`, which wins over the project's file. Use it for repositories you should not commit to (Firstmate itself, upstream projects), and for HTTP credentials. The config directory is `--config-dir`, else `$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`, and it must be outside the Firstmate home. The Firstmate home's own configuration is never read.

Both files are re-read every minute. A project with neither file uses the built-in passage, exactly as before. A file that does not validate is left out, its errors are listed on the project's passage page and flagged in the project header, and the passage falls back to the layers below it; a broken file never blanks the dashboard.

**Enable before it runs.** A project file's network checks (GitHub, npm and HTTP) stay off until you enable that file on the project's passage page, which lists every check it will run. Wheelhouse records the file's sha256 in its state directory, and a changed file is off again until you enable the new version. Checks in the captain-owned file, and the local `git.contains` and `status.note` checks, need no enabling. [Command checks](#command-checks), from either file, have a switch of their own.

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

## Stages

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

## Checks

| Type                | Parameters                                                                                          | Outcomes                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `github.deployment` | `environment`, `ref: pr.head \| merge.commit`, optional `repo`                                      | `success`, `failure`, `in_progress`, `inactive`, `absent` |
| `github.workflow`   | `workflow` (file name or id), `ref`, optional `event`, `repo`                                       | `success`, `failure`, `in_progress`, `absent`             |
| `github.release`    | `contains: merge.commit \| pr.head`, optional `tag_pattern` (e.g. `v*`), `repo`                     | `included`, `not_yet`                                     |
| `npm.published`     | `package`, `version_from: <github.release check>` (its tag, minus a leading `v`)                    | `published`, `latest`, `absent`                           |
| `http`              | `url`, `method: GET \| HEAD`, `expect: { status, json_pointer, equals }`                            | `ok`, `mismatch`, `error`                                 |
| `git.contains`      | `repo: firstmate-root \| project-clone`, optional `ref`, `commit`                                   | `yes`, `no`                                               |
| `status.note`       | `prefix: preview` (the worker's `preview <url>` status line)                                        | `present`, `absent`                                       |
| `command`           | `run: [program, args…]`, optional `cwd`, `timeout`, `env`, `when`, `ref` ([below](#command-checks)) | `passed`, `failed`                                        |

Every check also takes `label` and `interval` (at least `30s`; GitHub and HTTP checks default to `60s`, releases and npm to `5m`). `repo` defaults to the task's pull request repository, else the project clone's origin. A deployment that succeeded and was later replaced (`inactive`) also counts as `success`. `equals` takes `merge.commit`, `pr.head`, `task.id` or a literal. In the captain-owned file only, an `http` check may set `headers_from_env: { <Header>: <ENV_VAR> }`.

How checks run:

- **In the background, never on the fleet's hot path.** Each fleet round records which checks a task could still use (a step it has not reached, a failed step that may recover, or the current step's evidence), and a scheduler runs them on their interval, two at a time. A check that needs a commit waits for it: the PR head while a pull request is recorded, the merge commit (from `gh pr view`) once it merged.
- **Terminal results are cached.** A result that cannot change, such as a successful deployment of the merge commit, is not checked again. Tasks that landed more than 30 days ago are not checked, and `give_up_after` stops checking earlier. A step reached through checks is recorded in Wheelhouse's state directory, so it stays reached after a restart even when its checks can no longer see it (a newer commit is live). A step the task has moved past keeps how it was shown (done or skipped, with its note) when its `skip_when` or note depends on checks that no longer run.
- **Unknown is honest.** A check that errors or times out has no outcome: its step stays where it was on what the check last observed, with a note saying why, and is never treated as not reached. `not` over a check that has observed nothing does not hold.
- **Observation only, with fixed queries.** GitHub reads are `gh api` GETs; commits are 40-hex values Wheelhouse looked up itself and passes as separate arguments, never text spliced into a string. HTTP checks are GET or HEAD only, http(s) only, with no cookies, at most 3 redirects, a 10 s timeout and a 64 KiB body cap; `headers_from_env` headers are dropped once a redirect leaves the URL's origin (another host, port or scheme). `git.contains` runs `git --no-optional-locks merge-base --is-ancestor`. `WHEELHOUSE_NO_GH=1` turns the GitHub reads off.
- **Only command checks run programs**, and only once you allow them (below).

## Command checks

A `command` check runs a program on this machine, in a temporary checkout of the project made from Firstmate's clone, and passes when it exits 0. It is how a passage can do something rather than only observe it, such as a local deploy after the merge:

```yaml
checks:
  local-deploy:
    type: command
    label: Local deploy
    run: [pnpm, 'deploy:local'] # the program, then each argument
    when: merged # run only after the merge
    timeout: 20m
    env: [KUBECONFIG]
stages:
  - id: deployed-locally
    label: Deployed locally
    after: landed
    reached_when: local-deploy.passed
    failed_when: local-deploy.failed
    evidence: ['check:local-deploy']
```

| Field     | Meaning                                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`     | The program and its arguments, as a list. It is started directly, never through a shell, so `&&`, pipes, `$VARS` and globs are passed as plain text. A single string is an error.                                                                                                |
| `cwd`     | The folder to run in, relative to the top of the checkout (default `.`). No `..`, and a folder that resolves outside the checkout through a link is refused.                                                                                                                     |
| `timeout` | How long it may run (default `5m`, at most `60m`); a run that takes longer is stopped and counts as `failed`.                                                                                                                                                                    |
| `env`     | Names of environment variables passed through from Wheelhouse's own environment. Nothing else is passed except `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL` and `TMPDIR`, plus `WHEELHOUSE_TASK_ID`, `WHEELHOUSE_PROJECT` and `WHEELHOUSE_COMMIT`, the commit it runs on. |
| `when`    | Run only while this condition over Firstmate facts holds, such as `merged` or `pr.recorded`. Without it, the command runs as soon as a task could use it, even before the merge.                                                                                                 |
| `ref`     | `merge.commit` or `pr.head`: wait until that commit is known, run on it, once per commit. Without it, the command runs on the tip of the default branch.                                                                                                                         |

How command checks run:

- **Off until you allow them.** The project's passage page lists every command line exactly as it will run (program and arguments, folder, time limit, environment, when) with **Allow these commands to run**. Wheelhouse records a digest of exactly those command lines, from whichever file declares them, and changing a command line turns them off again until you allow the new version. Enabling a project file's network checks does not allow its commands.
- **Allowing them trusts the project's own scripts.** Consent covers the command line, not what it calls: a `package.json` script or a deploy script in the repository runs as it is at the commit the command runs on, and it can change through a merged pull request without turning the commands off.
- **On a pinned commit, never in the clone's working tree.** Each run gets its own temporary checkout of the commit (the task's merge commit or pull request head with `ref`, else the tip of the default branch), which is removed afterwards, also after a failure or a time-out. A commit that cannot be checked out (for example one the clone has not fetched yet) has no outcome, and says why.
- **Never for old work.** A task that landed before you allowed the commands is never run, so allowing a deploy does not replay it over recent history.
- **One at a time, on their own queue.** A long command never delays the observational checks. A failed run is tried again on the check's `interval` (default `10m`) while the step is still to come; a pass is final for that task (and commit).
- **Output is kept.** The last 16 KiB of what it printed (stdout and stderr together, colour codes removed) shows under the check on the task page. A program that cannot be started has no outcome, and says why.

## Editing a passage in Wheelhouse

**Edit passage**, on a project's passage page, opens the passage editor. It edits one file at a time:

- **Repository file**: the project's `.wheelhouse.yaml` in Firstmate's clone of the project (`<home>/projects/<id>`). Saving changes that file in the repository's working tree and does not commit it; Wheelhouse keeps applying the version on the default branch, so the change takes effect once it is committed there (ask Firstmate to ship it). The editor says when the clone's file and the default branch's differ.
- **Your Wheelhouse config**: the captain-owned file, which takes effect within a minute of saving.

The steps are listed in passage order. Built-in steps can be renamed and given their own evidence, link and note, but not moved, removed or given new conditions; steps the file adds can be renamed, moved up and down (the editor writes `after:` for you), removed, and given checks. Each check has a form with its own fields. Conditions are edited as "when" or "unless" lines combined with all or any; anything more involved is edited in the **YAML** view, which edits the same file. Edits keep the file's comments and the lines you did not touch.

The editor validates the file as you type with the same strict validator Wheelhouse uses, and only saves a file without problems. **Review and save** shows the line-by-line changes first, and refuses to overwrite a file that changed since the editor loaded it.

**Test** evaluates the edited file against one of the project's recent tasks: each check runs once now and the editor shows where the task would be and what every check found. Command checks run in a test only when you tick the box that lists them, on the same pinned checkout as a real run; if the file's commands changed since they were listed, the test refuses to run them and asks you to look again. Nothing from a test is saved or recorded.
