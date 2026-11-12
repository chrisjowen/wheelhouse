<p align="center"><a href="https://wheelhouse.chrisjowen.net/">▶ Watch the intro video</a></p>

<img width="1774" height="887" alt="Wheelhouse: your bridge to Firstmate and the whole crew" src="https://github.com/user-attachments/assets/7448e391-c189-4861-ad45-3cb51ceca553" />

# Wheelhouse

**Run a crew of AI coding agents without living in their terminals.** ⚓

One calm page on your own machine to talk to [Firstmate](https://github.com/kunchenguid/firstmate), see what your crew is doing, and review real results.

## 🚀 Getting started

1. Install Wheelhouse:

   ```bash
   npm install -g @chrisjowen/wheelhouse
   ```

2. Open it:

   ```bash
   wheelhouse open
   ```

Wheelhouse opens in your browser at the local URL it prints. Without Firstmate yet, it opens a setup wizard: it clones [Firstmate](https://github.com/kunchenguid/firstmate) to a new or empty folder (or uses the one you have), checks the tools Firstmate needs with Firstmate's own check and installs the safe ones on your say-so, installs Claude Code and lets you sign in to it on the page, runs Firstmate's own checks, suggests plugins, and starts Firstmate. It remembers where Firstmate is, so `wheelhouse open` finds it from any folder; run it again from **Settings → Setup**. Already have Firstmate? Run `wheelhouse open` inside it.

The arrow-up icon in the header says when a newer version is out and upgrades and restarts Wheelhouse on a click. **Settings → Update** chooses where updates come from: the published npm release (the default) or a clone from GitHub (see [Keeping Wheelhouse up to date](docs/guide.md#keeping-wheelhouse-up-to-date)).

![Wheelhouse: the bridge down the left, with the main sections and the second mates; On deck beside it with its gauges and the work under way; and the conversation with Firstmate on the right, a long plan set apart as a briefing](docs/screenshots/home.png)

<sub>Screenshots show a demo crew working on made-up projects.</sub>

## ✨ What you get

- 💬 **Talk to Firstmate like a teammate.** Chat, answer with buttons, mention tasks with `#`, run commands with `/`, or just dictate. A live preview shows as a card under the reply about it, and every open decision as a card you can answer in place.

  ![The Firstmate chat: a reply that a pull request is ready, with its live preview as a card underneath, showing the app and links to the pull request and a full-size view](docs/screenshots/chat-preview.png)

  ![A decision in the Firstmate chat: Firstmate's message, then the card asking which onboarding design should ship, with a written answer, a note and Discuss to talk it through](docs/screenshots/chat-decision.png)

- 🗺️ **Harbour.** Every project at a glance: what needs you, what is moving and what landed. Open one for its work, each task with a live console.

  ![Harbour: a card per project, the one that needs you first, each with what waits on you, the work under way and its step, and what landed this week](docs/screenshots/harbour.png)

  ![A project page: lumen's banner with what needs you, a row of tabs for its work, issues, links, secrets and passage, and the tasks waiting on your move](docs/screenshots/project.png)

- 📡 **Radar.** Watch the whole fleet flow from Queued to Landed, live.

  ![Fleet radar: every task as a dot moving from Queued through Building, Testing and Pull request to Landed](docs/screenshots/radar.png)

- 🔔 **The ship's bell.** Rings for green PRs, questions, stuck workers and landed merges.

  ![The ship's bell: a question waiting and a pull request gone green, each with a one-click answer](docs/screenshots/bell.png)

- 📱 **From your phone.** Message Firstmate from Discord; its answers, alerts and decisions come back with buttons.

- ✅ **Decisions.** Only what Firstmate escalated to you, with its recommendation; what it settled itself waits, folded, under Handled by Firstmate.

  ![Decisions: Needs you, with a held question and Chat about this, and Handled by Firstmate opened to the questions Firstmate is settling itself](docs/screenshots/inbox.png)

- 🧭 **Task pages.** Every check, file, PR and log for a task in one place.

  ![A task page: the automated checks step by step, with two failing tests and the start of their output](docs/screenshots/task.png)

- 📜 **The conversation.** Every question a worker asked and how it was answered.

  ![The conversation between a worker and Firstmate: an instruction the worker has read, and the automated review's question with Firstmate's call on it](docs/screenshots/conversation.png)

- 🛠️ **Passage editor.** Add your own steps, like a local deploy after merge.

  ![The passage editor testing a new Deployed locally step on a landed task: where the task would be, and the local deploy's output](docs/screenshots/passage-editor.png)

- 🖥️ **Live preview.** Click around the real app and send feedback to the worker.

  ![A live preview full screen, with the preview helper beside it: the captain points at the expiry menu, the helper answers and suggests a line, and the feedback list waits to be sent to Firstmate](docs/screenshots/preview.png)

- 🤝 **Decided for you.** Every call Firstmate made on your behalf, with its reason.

  ![Decided for you: review questions Firstmate answered on your behalf, grouped by day, with each call and its reason](docs/screenshots/decisions.png)

- ⏱️ **Where time went & Headroom.** Spot the bottleneck and never run out of allowance.

  ![Where time went: each task's time split into building, review, CI and waiting on you](docs/screenshots/time.png)

  ![Headroom: Claude allowance left this session and this week, and each task's share of recent use](docs/screenshots/headroom.png)

- 📈 **Improvements.** Your harness gets better, only with your approval.

  ![Improvements: a harness review is due, proposals waiting for your call and the size of the harness](docs/screenshots/improvements.png)

- 🌙 **Day or night.** Warm paper by day, near-black navy after dark, gold for what needs you.

  ![Wheelhouse in dark mode: the same home page on near-black navy, with gold for what needs you](docs/screenshots/home-dark.png)

## 🔒 Yours, and only yours

- **Runs on your machine.** Wheelhouse serves only your own computer.
- **Firstmate stays in charge.** Close Wheelhouse and your crew keeps working.

## Details

### Requirements

Node.js 22 or newer, a Firstmate home (the setup wizard makes one), and `tmux` and Claude Code on your `PATH` (the wizard helps install them). Run `wheelhouse open --help` for options, such as a different Firstmate home or port. Wheelhouse starts Firstmate, or finds the session already running.

### Privacy and safety

- Wheelhouse listens on `127.0.0.1` only and refuses requests from anywhere else.
- Reaching Wheelhouse from Docker, a cloud workspace or another computer? A plugin such as [Localhost proxy](https://github.com/chrisjowen/localhost-proxy-wheelhouse) can open the crew's localhost previews and links through Wheelhouse's own port; see [Host routes and address rewrites](docs/plugins.md#host-routes-and-address-rewrites).
- Everything you type goes to Firstmate; Wheelhouse never stops, reconfigures or bypasses it.
- Dictation (Ctrl/⌘+Shift+Space, hold for push-to-talk) uses the browser's built-in speech recognition. The microphone is on only while you dictate; in Chrome and Edge your voice goes to the browser maker's speech service (Google, in Chrome). Wheelhouse never records or stores audio, and says so before first use.
- [Wheelhouse Cloud](docs/guide.md#wheelhouse-cloud) lets you use this Wheelhouse from any browser through a hosted gateway (`https://cloud.chrisjowen.net` by default, or your own): it is off until you press **Start** on the **Remotes** page, and the machine dials out, keeps its key, and relays only to Wheelhouse and its previews.
- The Discord gateway only connects out, hears only the account you pair, and keeps its bot token in the macOS Keychain (else a file only you can read). Nothing from it types into the Firstmate session or answers its prompts.
- Anything Firstmate doesn't record is labelled as unknown, never guessed.

### How the agents run

- **Decisions** shows only what Firstmate escalated to you, with its recommendation; everything it settled itself is folded under **Handled by Firstmate**, where you can take any of it over. **Chat about this** opens a question in the Firstmate chat with the form that fits it (one-tap answers, options to pick, or a written answer), which Firstmate can change as you talk it through; **Agree** sends its recommendation in one tap. Answers go to Firstmate as messages, and an answered card leaves at once. Keys: `j`/`k` move, `a` agree, `Enter` chat, `e` evidence, `l` later, `c` close.
- **Preview feedback** is talked through first: on a task's Live preview, a helper that sees only that preview (its page, screenshots, instructions and history) answers, asks and builds a feedback list you edit; **Send to Firstmate** sends the list as one message for the same task, and it shows in the chat.
- **Passage** checks that run a command stay off until you allow exactly those commands.
- **Shared reviews** (a bundled plugin, off until you turn it on) put a prototype or a worker's live app behind sign-in for several people to comment on the spot they mean; closing the review takes the link down and sends the comment threads the captain picks to Firstmate as one note for the task's worker, either as they are or tidied by the preview helper into points the captain edits and picks first (the comments stay in the review's bundle). Reviews start as local previews, and go live only on a review server you deploy and name in its settings; see [Shared review](plugins/shared-review/README.md).
- **Improvements** needs improve's Wheelhouse plugin: `wheelhouse plugin install chrisjowen/improve`.
- **Secrets** reach the crew by name with `wh-vault`, installed alongside `wheelhouse`: values stay in the macOS login Keychain, and `wh-vault run -- <command>` gives one command its project's granted secrets. The **Vault** page shows names, grants and use, never a value, and is where you add secrets and choose which projects may use each; the key button under the Firstmate chat adds one too. Grants limit accidents and prompt injection, not a worker set on getting a secret.

### Learn more

- [Guide](docs/guide.md): every page in detail, the Firstmate session, [setting up the Discord gateway](docs/guide.md#the-messaging-gateway), options and security.
- [Passage files](docs/passages.md): add steps such as **Deployed**, **Released** or a local deploy.
- [The vault](docs/vault.md): `wh-vault`, secrets by name for the crew, and what it does not protect.
- [Plugins](docs/plugins.md): the built-in and bundled plugins, how to write one, and how to install and update one from its own repository (`wheelhouse plugin install org/repo`, **Install plugin** on the Plugins page, or from a result in **Plugins** in the menu, after a review of what it is).
- [Plugin registries](docs/plugin-registry.md): the registry manifest the **Plugins** search reads, and how to run a registry of your own.
- [How Wheelhouse reads Firstmate](docs/architecture.md): its data sources, messaging and HTTP API.
- [Developing Wheelhouse](docs/development.md): running from a clone, tests and releases.
- [MVP spec](docs/spec.md).

## License

MIT
