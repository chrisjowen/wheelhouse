<img width="1774" height="887" alt="image" src="https://github.com/user-attachments/assets/7448e391-c189-4861-ad45-3cb51ceca553" />

# Wheelhouse

**Run a crew of AI coding agents without living in their terminals.**

Wheelhouse is the bridge for [Firstmate](https://github.com/kunchenguid/firstmate). Talk to Firstmate, see at a glance what your crew is doing and what is waiting on you, and review real results (screenshots, live previews, green CI) from one calm page on your own machine.

![Wheelhouse: the conversation with Firstmate on the left, with a question asked as buttons, and on the right what is waiting on you and what is under way](docs/screenshots/home.webp)

<sub>Screenshots show a demo crew working on made-up projects.</sub>

## Why Wheelhouse

Firstmate runs a whole crew of Claude Code workers for you. Keeping up with them usually means hopping between terminals, reading status logs and wondering what is stuck on you. Wheelhouse turns all of that into one page you can glance at: the people-shaped parts (questions, reviews, decisions) come to you, and everything else stays quietly visible.

## Talk to Firstmate like a teammate

Chat with Firstmate the way you would with a lead engineer. Its replies read as a conversation, its work folds into a single line you can open, and when it needs a call from you it asks with buttons. Mention any task with `#`, run Firstmate's commands with `/`, and see everything that needs you in the rail beside the chat.

Rather talk than type? Click the microphone (or press Ctrl/⌘+Shift+Space, and hold it for push-to-talk) to dictate into the chat, the Spec tab or preview feedback. Your words appear in the box as you speak, ready to edit, and nothing is sent until you send it. Dictation uses your browser's built-in speech recognition, so it needs no setup; in Chrome and Edge that means your voice is sent to the browser maker's speech service (Google, in Chrome) while the microphone is on, and Wheelhouse says so before you first use it.

## See the whole fleet at a glance

![Harbour: work waiting on you first, with screenshots, a live preview link and the pull request, then work under way](docs/screenshots/harbour.webp)

**Harbour** puts what needs you first: pull requests ready for review, with their screenshots, live preview and checks, and decisions only you can make. Below that, every piece of work says who is on it and what they are doing right now in plain words, with a live view of the worker's console and an honest estimate of the time left.

## Know exactly where every task is

![A task page: the automated checks step by step, with two failing tests and the start of their output](docs/screenshots/task.webp)

Every piece of work moves along a passage, from **Queued** to **Landed**. Open a task to see the files it changed, each automated check as it runs (what the review found, what got fixed, how long each step took), the pull request and its CI, and the full log.

## Follow the build while you are away

![The conversation between a worker and Firstmate: an instruction the worker has read, and the automated review's two questions with Firstmate's call on each](docs/screenshots/conversation.webp)

Every question the worker raised and every answer Firstmate gave for you is there in plain words, with who asked, who answered and how it ended. **Checks** shows what each automated step found: tests passed and failed, each failure with its output, and which docs changed. **Docs** lists every decision record and doc the work read or changed, readable right in Wheelhouse.

## Shape each project's passage

![The passage editor testing a new Deployed locally step on a landed task: where the task would be, and the local deploy's output](docs/screenshots/passage-editor.webp)

Add your own steps to a project's passage, such as a local Kubernetes deploy once work merges, in Wheelhouse's **passage editor**: steps in order, a form for each check, and a YAML view. **Test** shows where a real task would be with your edits before you save. Checks that run a command stay off until you allow exactly those commands.

## Review the real thing, not just the diff

![A live preview of the app under review, with feedback sent to the worker and Firstmate's reply beside it](docs/screenshots/preview.webp)

When a worker has the app running, Wheelhouse embeds it right in the task. Click around the actual change, type what should be different, and your feedback goes straight to the worker through Firstmate. Replies appear next to the page, so nothing covers what you are looking at.

## Write the spec before the work starts

![The Spec tab: a guided spec section by section, with the outline on the left and the assembled spec previewed on the right](docs/screenshots/spec.webp)

The **Spec** tab walks you through a full spec one short section at a time: the problem and goal, who it is for, their journeys, what is in and out, the requirements as a checklist, how it should look (with screenshots), the risks and what is still open. Every section is optional, drafts save as you type, and the preview shows exactly what Firstmate will read. When it is ready, **Send to Firstmate** delivers it to the chat as one message.

## Calls made while you were away, out in the open

![Decided for you: review questions Firstmate answered on your behalf, grouped by day, with each call and its reason](docs/screenshots/decisions.webp)

Firstmate answers routine review questions for you so the work never stalls waiting on you. **Decided for you** lists every one of those calls with its reasoning. Disagree? One click drafts the message that sets it right.

## Know where the time and the tokens go

![Where time went: each task's time split into building, review, CI and waiting on you](docs/screenshots/time.webp)

**Where time went** shows how long each task spent being built, in review and fixes, in CI and waiting on you, so you can see whether the crew or the queue is the bottleneck. **Headroom** shows how much of your Claude allowance is left, when it resets and who on your machine is using it, and warns you before the crew runs dry. All three live under the **Logbook** tab.

![Headroom: Claude allowance left this session and this week, and each task's share of recent use](docs/screenshots/headroom.webp)

## Yours, and only yours

- **Runs on your machine.** Wheelhouse listens on `127.0.0.1` only, and refuses requests from anywhere else.
- **Firstmate stays in charge.** Everything you type goes to Firstmate; Wheelhouse never stops, reconfigures or bypasses it, and closing Wheelhouse leaves your crew working.
- **Your voice only when you ask.** The microphone is on only while you dictate. The browser's speech service turns it into text (in Chrome, Google's servers do), and Wheelhouse itself never records or stores audio.
- **Honest about what it can't see.** Anything Firstmate doesn't record is labelled as unknown, never guessed.

## Get started

You need Node.js 22 or newer, a [Firstmate](https://github.com/kunchenguid/firstmate) home, and `tmux` and Claude Code on your `PATH`.

```bash
npm install -g @chrisjowen/wheelhouse
cd ~/firstmate        # your Firstmate checkout
wheelhouse open
```

Wheelhouse starts Firstmate (or finds the session already running) and opens in your browser. Run `wheelhouse open --help` for options, such as a different Firstmate home or port.

## Learn more

- [Guide](docs/guide.md): every page in detail, the Firstmate session, options and security.
- [Passage files](docs/passages.md): add steps such as **Deployed**, **Released** or a local deploy to a project's passage, in a file or in Wheelhouse's passage editor.
- [Plugins](docs/plugins.md): the built-in plugins and how to write one.
- [How Wheelhouse reads Firstmate](docs/architecture.md): its data sources, messaging and HTTP API.
- [Developing Wheelhouse](docs/development.md): running from a clone, tests and releases.
- [MVP spec](docs/spec.md).

## License

MIT
