<img width="1774" height="887" alt="image" src="https://github.com/user-attachments/assets/7448e391-c189-4861-ad45-3cb51ceca553" />

# Wheelhouse

**Run a crew of AI coding agents without living in their terminals.** ⚓

One calm page on your own machine to talk to [Firstmate](https://github.com/kunchenguid/firstmate), see what your crew is doing, and review real results.

## 🚀 Getting started

1. Clone Firstmate:

   ```bash
   git clone https://github.com/kunchenguid/firstmate.git
   ```

2. Install Wheelhouse:

   ```bash
   npm install -g @chrisjowen/wheelhouse
   ```

3. Open it from your Firstmate folder:

   ```bash
   cd firstmate
   wheelhouse open
   ```

Wheelhouse opens in your browser at the local URL it prints.

![Wheelhouse: the main sections in the menu down the left; On deck beside it with the work under way; and the conversation with Firstmate on the right, with a question asked as buttons](docs/screenshots/home.webp)

<sub>Screenshots show a demo crew working on made-up projects.</sub>

## ✨ What you get

- 💬 **Talk to Firstmate like a teammate.** Chat, answer with buttons, mention tasks with `#`, run commands with `/`, or just dictate.
- 🗺️ **Harbour.** What needs you first, then every task in flight with a live console.

  ![Harbour: work waiting on you first, with screenshots, a live preview link and the pull request, then work under way](docs/screenshots/harbour.webp)

- 📡 **Radar.** Watch the whole fleet flow from Queued to Landed, live.

  ![Fleet radar: every task as a dot moving from Queued through Building, Testing and Pull request to Landed](docs/screenshots/radar.webp)

- 🔔 **The ship's bell.** Rings for green PRs, questions, stuck workers and landed merges.

  ![The ship's bell: a question waiting and a pull request gone green, each with a one-click answer](docs/screenshots/bell.webp)

- ✅ **Decisions.** Every open question in one stack, answered in one tap.

  ![Decisions: every open question as a card, with Approve, Fix, Skip and Ask me later, and keyboard shortcuts](docs/screenshots/inbox.webp)

- 🧭 **Task pages.** Every check, file, PR and log for a task in one place.

  ![A task page: the automated checks step by step, with two failing tests and the start of their output](docs/screenshots/task.webp)

- 📜 **The conversation.** Every question a worker asked and how it was answered.

  ![The conversation between a worker and Firstmate: an instruction the worker has read, and the automated review's two questions with Firstmate's call on each](docs/screenshots/conversation.webp)

- 🛠️ **Passage editor.** Add your own steps, like a local deploy after merge.

  ![The passage editor testing a new Deployed locally step on a landed task: where the task would be, and the local deploy's output](docs/screenshots/passage-editor.webp)

- 🔍 **Guided PR review.** The important changes first, with why each was made.

  ![Pull request review: the review guide's summary, the changes to read first with why each was made, and a box to ask the review agent](docs/screenshots/review.webp)

- 🖥️ **Live preview.** Click around the real app and send feedback to the worker.

  ![A live preview of the app under review, with feedback sent to the worker and Firstmate's reply beside it](docs/screenshots/preview.webp)

- 📝 **Spec interview.** Get grilled on what you want, watch the spec write itself, send it to build.

  ![The Spec tab: the interviewer's questions and suggested answers on the left, the spec filling in on the right with what just changed marked](docs/screenshots/spec.webp)

- 🤝 **Decided for you.** Every call Firstmate made on your behalf, with its reason.

  ![Decided for you: review questions Firstmate answered on your behalf, grouped by day, with each call and its reason](docs/screenshots/decisions.webp)

- ⏱️ **Where time went & Headroom.** Spot the bottleneck and never run out of allowance.

  ![Where time went: each task's time split into building, review, CI and waiting on you](docs/screenshots/time.webp)

  ![Headroom: Claude allowance left this session and this week, and each task's share of recent use](docs/screenshots/headroom.webp)

- 📈 **Improvements.** Your harness gets better, only with your approval.

  ![Improvements: a harness review is due, proposals waiting for your call and the size of the harness](docs/screenshots/improvements.webp)

- 🌙 **Day or night.** A calm logbook look in light, deep navy after dark.

  ![Wheelhouse in dark mode: the same home page on deep navy](docs/screenshots/home-dark.webp)

## 🔒 Yours, and only yours

- **Runs on your machine.** Wheelhouse serves only your own computer.
- **Firstmate stays in charge.** Close Wheelhouse and your crew keeps working.

## Details

### Requirements

Node.js 22 or newer, a Firstmate home, and `tmux` and Claude Code on your `PATH`. Run `wheelhouse open --help` for options, such as a different Firstmate home or port. Wheelhouse starts Firstmate, or finds the session already running.

### Privacy and safety

- Wheelhouse listens on `127.0.0.1` only and refuses requests from anywhere else.
- Everything you type goes to Firstmate; Wheelhouse never stops, reconfigures or bypasses it.
- Dictation (Ctrl/⌘+Shift+Space, hold for push-to-talk) uses the browser's built-in speech recognition. The microphone is on only while you dictate; in Chrome and Edge your voice goes to the browser maker's speech service (Google, in Chrome). Wheelhouse never records or stores audio, and says so before first use.
- Anything Firstmate doesn't record is labelled as unknown, never guessed.

### How the agents run

- **Decisions** answers go to Firstmate as messages; a card reads "sent to Firstmate" until the question closes. Keys: `j`/`k` move, `a`/`f`/`s` answer, `l` ask later, `c` close, Enter for evidence.
- **PR review** runs your own `claude` read-only with no tools, on request. Each run shows its cost, and a guide is cached per PR version.
- **Spec interview** runs your local `claude` CLI headless and read-only, with your `grilling` skill if you have one. It uses Sonnet at low effort unless you set `--spec-model` and `--spec-effort`. **Quick form** fills the same spec by hand.
- **Passage** checks that run a command stay off until you allow exactly those commands.
- **Improvements** needs improve's Wheelhouse plugin: `wheelhouse plugin install chrisjowen/improve`.

### Learn more

- [Guide](docs/guide.md): every page in detail, the Firstmate session, options and security.
- [Passage files](docs/passages.md): add steps such as **Deployed**, **Released** or a local deploy.
- [Plugins](docs/plugins.md): the built-in and bundled plugins, how to write one, and how to install one from its own repository (`wheelhouse plugin install org/repo`).
- [How Wheelhouse reads Firstmate](docs/architecture.md): its data sources, messaging and HTTP API.
- [Developing Wheelhouse](docs/development.md): running from a clone, tests and releases.
- [MVP spec](docs/spec.md).

## License

MIT
