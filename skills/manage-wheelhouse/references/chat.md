# Writing for the Wheelhouse chat

The captain reads Firstmate's replies in Wheelhouse as rendered Markdown, in a browser or on a phone. These are the formats Wheelhouse understands, and the habits that make a reply readable there.

## Habits

- **Plain outcomes, not internals.** Say what changed, what is waiting and what the captain can do, in the captain's terms. Leave out script names, status-file mechanics and task-engine jargon unless asked.
- **Links only once verified.** Link a page, preview or PR only after you have checked it loads (`curl`, or `wheelhouse preview check <url>` for a preview). Write a pull request as its full `https://` URL.
- **Never ask for a secret in words.** Ask with a `vault-request` block (below). Never ask the captain to paste a value into the chat, and never repeat one.
- **Questions that need the captain go to the inbox.** A real call the captain must make (a product choice, a risky or destructive step, anything that blocks work) is held as a captain-held task through Firstmate's own hold procedure, so it appears in the Wheelhouse inbox and survives the chat scrolling away. A quick question in passing can be a plain decision form.

## Project markers

Start a reply, or each section of a round-up, with an invisible marker on its own line:

```text
<!-- project: <project-id-or-topic> -->
<!-- project: <project-id>/<task-id> -->
```

The first files the text under a project, or under a topic named by any kebab-case slug (no need to register a project for a topic). The second also names the one task the section is about. A marker applies until the next one, even across reply parts; one inside a code block does nothing. The captain's messages arrive with `[project <id>]` or `[project <id>/<task-id>]` in front: answer in that thread. A second mate's task is `<task>@<mate>`; never drop the `@<mate>`.

## Decision forms

End a reply with a fenced form, with nothing after its closing fence:

````text
```decision-form
Which release should ship?
- Small release: Essential changes first (recommended)
- Full release: Include the optional workflow
- (written)
```
````

- The first line that is not a list item is the question. Each `- label: detail` is a choice; `(recommended)` marks the recommendation; `- (written)` asks for the captain's own words. Every form also offers Other.
- Two short choices without detail show as buttons; anything else shows as a list with Decide.
- The answer arrives as `Decided: <words> — for: “<question>”`, sometimes followed by a note, or `Dismissed — for: “<question>”` followed by `Reason: <why>`.
- A plain form is a quick question in the chat only. It does not hold anything or close a decision key.
- To ask a held decision in the chat, hold it first, then fence the form as ` ```decision-form id=<task-id> `: Wheelhouse shows that hold's own card, and the captain's answer arrives through the inbox, naming `Decision key: <task-id>`. A Dismiss asks you to close the held task as dismissed, not answered, with the captain's reason.
- A message that starts `About decision <id> (“<title>”), not an answer yet:` is the captain discussing a card. Discuss it; it is not an answer.

## Secrets

Ask for a missing secret with this block, which Wheelhouse shows as a button that opens a hidden input for the captain:

````text
```vault-request
name: DEPLOY_TOKEN
purpose: Deploy the requested release
projects: project-id
```
````

Only `name` (required), `purpose` (one line) and `projects` (ids, comma or space separated). A block with any other field, such as a value, is not shown as a request. Once the captain saves it, you receive `Stored secret <NAME> in the vault.` and which projects may use it; then use it only through `wh-vault run --only <NAME> -- <command…>`.

## Messages Wheelhouse sends for the captain

- **Attachments** arrive as `[attached file <absolute path> — <name>, <size>, <type>]`. Read the file with your own tools when the task needs it; Wheelhouse keeps uploads for a limited time.
- **About a task:** a message the captain sends from a task arrives as `Re: <task-id>` followed by the text. Feedback on a preview or from a review plugin belongs to that same task: pass it to the worker that built it if it is still running, else start a new run on the same pull request.
- **Crew discussion:** a note starting `Crew discussion with <task>:` means the captain spoke to that worker directly from its task page. The worker already has it; keep it in your picture of the task and do not relay it again.
- **Live mode:** `Scout request from a Live mode discussion` asks for a scout on the quoted question; use the task id it names (`live-scout-<ref>`) when you can and keep its `Live scout ref: <ref>` line in the brief, so Wheelhouse brings the report back into the call. `Hand-off from a Live mode discussion` is a note the captain sent on from the call: act on it as the captain's own words.

## Replies to notes

Answer a note Wheelhouse relayed with Firstmate's own `fm-inbox.sh reply <note-id> -` (the text on stdin), naming the original note, so the answer appears under it. A note that was drained or acknowledged has not been answered yet.
