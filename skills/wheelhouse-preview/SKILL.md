---
name: wheelhouse-preview
description: >-
  Show the captain work in Wheelhouse: serve a page, app, prototype or report as a preview, report it on a status line, keep it alive across relaunches, check it embeds, and use the review surface the captain chose. Use before showing the captain anything that runs or is visual, and before writing a brief for visual work or a scout report.
---

# Show the captain work in Wheelhouse

The captain reviews work inside Wheelhouse: a preview of a running page sits on its task, and loopback links in Firstmate's replies become preview boxes in the chat. Wheelhouse embeds only addresses on this computer (`http://127.0.0.1:<port>/…` or `localhost`).

## Serve it

- Give each preview a port of its own on 127.0.0.1, never Wheelhouse's port, and start it in the background so it outlives your command (for example `nohup <server> > <log> 2>&1 &`, saving its PID). A static report or page can be served with any small static server.
- Let Wheelhouse frame it. A server that sends `X-Frame-Options`, or a `Content-Security-Policy` whose `frame-ancestors` leaves out Wheelhouse's address, shows as "refused to connect" in the Preview tab. Remove the header, or add Wheelhouse's origin (`wheelhouse status` shows its address) to `frame-ancestors`.
- Check it before anyone is told: `curl -fsS <url>` shows it serves, and `wheelhouse preview check <url>` says whether Wheelhouse can embed it and, if not, why (exit 1 with the header that blocks it). Only then report or link it.

## Report a preview

- A worker reports it by appending its own status line, with the task's normal status writer and a real epoch:

  ```text
  note [at=<epoch>]: preview http://127.0.0.1:<port>/<path>
  ```

  Use the preview's own port and the deep link worth opening first. `wheelhouse preview check --task <id>` checks what a task reported.

- Firstmate links a preview in a reply as its plain loopback URL, outside code; the chat turns it into a preview box. Name the task id or its full pull request URL in the same reply so the box sits with that task.
- Report it again whenever its address changes.

## Keep it alive

- A preview stays up until the work merges or is closed, or the captain says the review is over.
- After any relaunch (a worker restarted, the computer slept, a crash), start it again on the same port, check it with `curl`, and append the note again.
- Stop only preview servers you started, by their saved PID; never stop Wheelhouse itself.

## Hosted dev environments

When Wheelhouse runs in a hosted environment (Codespaces, Gitpod, or one set with `wheelhouse open --preview-url <pattern>`), still report the loopback address: Wheelhouse opens it at the environment's own URL for that port.

## Review surface

Read this before showing the captain anything to review, and before writing a brief that says to use Lavish.

<!-- wheelhouse:review-surface -->

## Shared review

Shared review is a bundled plugin that lets people outside this computer review a preview through a link. Use it only when the captain asks to share something. Its commands are `node <wheelhouse-install>/plugins/shared-review/review/main.mjs <command>`; run `help` (not `<command> --help`, which runs the command) and read its README first. Every review starts local; `go-live` publishes it and is the captain's call. Its `status`, `list` and `show` output contains desk keys and passcodes: never paste that output into a reply, a status line or a log.
