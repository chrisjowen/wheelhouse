---
id: service.wheelhouse
type: service
title: Wheelhouse (local web UI and CLI)
tags:
- wheelhouse
- ui
- cli
attributes:
  language: typescript
  lifecycle: experimental
links:
- rel: depends_on
  target: system.firstmate
  evidence:
  - source: code
    path: src/lib/server/firstmate/install.ts
    lines: 105-117
    symbol: resolveInstall
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/install.ts#L105-L117
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Refuses a directory without bin/fm-fleet-snapshot.sh as not a Firstmate checkout.
  - source: docs
    path: README.md
    lines: 7-11
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L7-L11
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Requires a Firstmate checkout and its operational home.
- rel: consumes
  target: api.firstmate-scripts
  evidence:
  - source: code
    path: src/lib/server/firstmate/adapter.ts
    lines: 167-240
    symbol: createScriptAdapter
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/adapter.ts#L167-L240
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: snapshot/ready/peek/note/receipts wrap the fm-* scripts.
- rel: depends_on
  target: datasource.firstmate-home
  evidence:
  - source: code
    path: src/lib/server/runtime.ts
    lines: 80-82
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/runtime.ts#L80-L82
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Reads state/fleet-ledger.jsonl and data/projects.md from the home.
  - source: docs
    path: README.md
    lines: 88-100
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L88-L100
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Table of everything Wheelhouse reads from Firstmate.
- rel: depends_on
  target: datasource.wheelhouse-message-store
  evidence:
  - source: code
    path: src/lib/server/store/store.ts
    lines: 47-51
    symbol: defaultStateDir
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/store/store.ts#L47-L51
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: exposes
  target: api.wheelhouse-http
  evidence:
  - source: docs
    path: README.md
    lines: 115-128
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L115-L128
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: API endpoint table.
- rel: depends_on
  target: system.github
  evidence:
  - source: code
    path: src/lib/server/firstmate/evidence.ts
    lines: 539-545
    symbol: readGhPr
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/evidence.ts#L539-L545
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Falls back to `gh pr view` when Firstmate has no cached PR observation; optional.
  - source: docs
    path: README.md
    lines: '12'
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/README.md#L12
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: The GitHub CLI is listed as optional.
- rel: depends_on
  target: system.no-mistakes
  evidence:
  - source: code
    path: src/lib/server/firstmate/evidence.ts
    lines: 119-127
    symbol: EvidenceReader.constructor
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/firstmate/evidence.ts#L119-L127
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
    note: Reads ~/.no-mistakes/evidence and ~/.no-mistakes/logs by default.
- rel: depends_on
  target: library.firstmate-adapter
  evidence:
  - source: code
    path: src/lib/server/runtime.ts
    lines: 80-93
    symbol: getRuntime
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/runtime.ts#L80-L93
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: depends_on
  target: library.collector
  evidence:
  - source: code
    path: src/lib/server/runtime.ts
    lines: '86'
    symbol: collector.start
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/runtime.ts#L86
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: depends_on
  target: library.message-store
  evidence:
  - source: code
    path: src/lib/server/runtime.ts
    lines: '83'
    symbol: messaging.messenger
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/runtime.ts#L83
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: depends_on
  target: library.plugin-system
  evidence:
  - source: code
    path: src/lib/server/runtime.ts
    lines: 87-93
    symbol: PluginRegistry
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/src/lib/server/runtime.ts#L87-L93
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: implements
  target: feature.web-sessions
  evidence:
  - source: code
    path: src/lib/server/sessions/terminal.ts
    commit: '967deff'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/967deff/src/lib/server/sessions/terminal.ts
    observedAt: '2026-10-12'
    observedBy: claude
    session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
    note: WebSocket terminal handler for browser-based captain sessions
- rel: depends_on
  target: library.sveltekit
  evidence:
  - source: manifest
    path: package.json
    lines: '40'
    key: devDependencies.@sveltejs/kit
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L40
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: depends_on
  target: library.commander
  evidence:
  - source: manifest
    path: package.json
    lines: 31-33
    key: dependencies.commander
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L31-L33
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
- rel: documented_in
  target: document.mvp-spec
  evidence:
  - source: docs
    path: docs/spec.md
    lines: 1-28
    commit: '3318721'
    urls:
    - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/docs/spec.md#L1-L28
    observedAt: '2026-10-11'
    observedBy: claude
    session: 07235ad1
evidence:
- source: code
  path: cli/index.ts
  lines: 21-22
  symbol: DEFAULT_PORT
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/cli/index.ts#L21-L22
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: CLI serves on 127.0.0.1, default port 4310.
- source: code
  path: cli/index.ts
  lines: 158-165
  symbol: command('open')
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/cli/index.ts#L158-L165
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: '`wheelhouse open` is the default command.'
- source: config
  path: svelte.config.js
  lines: 1-12
  symbol: adapter-node
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/svelte.config.js#L1-L12
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Built with adapter-node into build/.
- source: manifest
  path: package.json
  lines: '3'
  key: version
  commit: '3318721'
  urls:
  - https://github.com/chrisjowen/wheelhouse/blob/33187211223390ba67dfad8602713dab473b64df/package.json#L3
  observedAt: '2026-10-11'
  observedBy: claude
  session: 07235ad1
  note: Version 0.1.0.

- source: code
  path: src/routes/bridge/+page.svelte
  commit: a6ee35a
  observedAt: '2026-10-11'
  observedBy: claude
  session: 8351d016-e8c7-446a-8237-a9dab55a7367
  note: Bridge page component successfully merged after rebase onto 4fea579; focused thread behavior and decision-as-question feature in place.
- source: code
  path: src/lib/server/sessions/terminal.ts
  lines: 936
  symbol: Terminal.connect
  commit: '01099af'
  observedAt: '2026-10-12'
  observedBy: claude
  session: d4f37d29-8251-44b0-a85d-ec4d63c4dcbb
  note: >
    WebSocket close reason now truncates by UTF-8 byte length (max 123 bytes)
    instead of UTF-16 code units to prevent RangeError when pty startup fails
    with paths containing non-ASCII characters (commit 01099af).
- source: conversation
  path: src/lib/server/sessions/
  observedAt: '2026-10-11'
  observedBy: claude
  session: 567905b6-f805-4148-8cdb-487135a4eb6d
  note: >
    Re-reviewed in no-mistakes phase: validated sessions feature implementation streams to browser
    (not opening terminal). Confirmed UTF-8 close reason fix for unhandled rejections on pty startup
    failures. Team decision confirmed: keep trust pre-registration (Firstmate-requested).

- source: conversation
  session: 0f320365-b59e-4b94-89dc-471c1a1d4043
  observedAt: '2026-10-25'
  observedBy: claude
  note: >
    Test phase (no-mistakes gate-step) verified Wheelhouse server functionality against commit
    05aa69c (docket-chart-ui-trim). Tested with local Firstmate environment and browser. Confirmed:
    server starts and serves Chart page; Chart fills window with resizable inspector panel on right;
    Firstmate rail resizing works; all smoke and unit tests pass. No regressions in existing
    features or integration with Firstmate.

provenance:
  capturedBy: claude
---

# Wheelhouse (local web UI and CLI)

The one runnable thing in the repository: a SvelteKit 2 app built with
adapter-node and launched by a Commander CLI (`wheelhouse open`, the default
command). It attaches to a Firstmate session that is already running, binds
`127.0.0.1` (default port 4310), and opens the browser. Pages: Harbour (fleet
overview), task pages with evidence, and the Bridge (messaging Firstmate).

It reads Firstmate only through its integration scripts and its operational
home, keeps its own message record in a Wheelhouse state directory, and
optionally reads GitHub (via `gh`) and no-mistakes run logs for PR/CI evidence.
Closing it leaves Firstmate and its crew running.

Lifecycle is recorded as `experimental`: version 0.1.0, private package, and the
README says this release covers only the "watch the crew" and "talk to
Firstmate" slices of the MVP. It runs on the operator's machine; there is no
deployed environment.
