# Plugins

Plugins are "panels and providers". A provider reads data on the server; a contribution puts its output in one of the fixed slots below, drawn with Wheelhouse's built-in blocks, with a Svelte panel compiled into Wheelhouse (for a compiled-in or bundled plugin), with a custom element from an installed plugin's UI bundle, or as an MCP app from one of the plugin's own MCP servers. Plugins cannot add slots. A plugin is either compiled into Wheelhouse (under `src/lib/plugins/`; none ships today), bundled with it in the installed-plugin format (Project links, GitHub issues, Vault and Localhost proxy, under `plugins/`), or kept in a repository of its own and installed with `wheelhouse plugin install <org/repo>` or the Plugins page's **Install plugin** (see [Installed plugins](#installed-plugins)); all go through the same registry, checks and read-only context. The only iframes are MCP apps', drawn from a sandbox on another origin (see [MCP apps](#mcp-apps)).

| Slot               | About     | Where it shows                                                                                                                       |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `project.tab`      | a project | its own page at `/projects/<id>/<plugin>/<tab>`, a tab in the row under the project's banner on its pages                            |
| `harbour.card`     | a project | a card at the top of the project's work, on its Work tab                                                                             |
| `task.section`     | a task    | a section right after the passage step named by `placement.step` (under Stages), else a tab of its own, ordered by `placement.order` |
| `step.evidence`    | a task    | under the passage step named by `placement.step`                                                                                     |
| `bridge.card`      | the fleet | under a Firstmate reply in the chat that contains one of the card's URLs exactly                                                     |
| `home.card`        | the fleet | a tab of its own on the home page's rail, after Under way, Needs you and Landed, named by its title and counted by its `badge`       |
| `header.indicator` | the fleet | a small pill in the header on every page, drawn by the plugin's own panel or element only; it shows nothing when it renders nothing  |
| `nav.page`         | the fleet | its own page at `/plugins/<plugin>/<page>`, a top-level item in the left-hand menu after Logbook                                     |

**Isolation.** Each provider call runs with a timeout (3 s by default, at most 10 s) and its result is cached for the provider's `ttlMs` (a failure for at most 15 s); after that, the last good result is served, for up to 10 minutes, while one refresh runs. A provider that throws, times out or returns something malformed becomes "Not available" with the reason, in its own entry only; the rest of the page and every other plugin render as usual. A plugin's own panel mounts in the browser inside an error boundary, so a panel that throws is contained too; an installed plugin whose element's bundle fails to load says so in its own place. An installed plugin that cannot be read, is invalid or throws while it loads is listed as failed, with the reason, and the rest load as usual. Providers see copies of the fleet and read only through their context: `readFile` and `listDir` confined to the project clone, the task worktree or the Firstmate home (at most 64 KiB), `exec` in one of those with an argument array, no shell, a minimal environment and bounded time and output (at most 8 MiB), and `changedFiles` for the files a task in scope changed against its base branch. There is no way to write, message Firstmate or control workers (an MCP app can only ask to send Firstmate a message, which the captain reads and agrees to first; see [MCP apps](#mcp-apps)); the one thing Wheelhouse starts for a plugin is its declared companion service, on the captain's click (see [Companion services](#companion-services)). Commands run with your permissions: read-only is the plugin's contract, reviewed in Wheelhouse's own pull requests, not a sandbox.

**Versions.** Every plugin declares the plugin contract it was written against (`apiVersion`, in an installed plugin's manifest `wheelhouse.apiVersion`). Wheelhouse loads the current contract (1) and, once there is a 2, the one before it; it refuses any other, with the reason in `/api/plugins`, and never downgrades silently. Blocks are versioned schemas (`text.v1`, `kv.v1`, `table.v1`, `links.v1`, `image.v1`, `status.v1`, `graph.v1`, the last a nodes-and-links placeholder until a chart renderer lands). A block Wheelhouse does not know renders as a plain fallback, plugin text is always text, and links and images keep only http(s) URLs and same-origin paths.

**Turning plugins on and off.** A plugin is on by default only if it says so: for every project (`enabledByDefault`), or only for projects whose clone has a given file (`enabledWhenFile`). A plugin about Firstmate itself rather than one project can instead be on by default, for the fleet and every project, only while the Firstmate home has a given file (`enabledWhenHomeFile`); its fleet providers then see every task, unassigned ones too. Turn a plugin on or off, for every project or for one, from **Settings → Plugins** (see [The Plugins pages](#the-plugins-pages)); the page writes the choice to `plugins.json` in Wheelhouse's config directory (`$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`), which you can also edit by hand. A project's setting wins over the plugin's. Wheelhouse re-reads the file when it changes, so a change applies without a restart, and if it is invalid it keeps the defaults and reports why in `/api/plugins`.

```json
{ "plugins": { "project-links": { "enabled": true, "projects": { "firstmate": false } } } }
```

A plugin's `settings` object in the same file is handed to its providers as is (`ctx.settings`); each plugin documents its own. A bundled or installed plugin can also declare them in its manifest: `wheelhouse plugin install` then asks for each and writes the answers there, and the plugin's page in **Settings → Plugins** shows them as a form (see [Settings](#settings)).

## GitHub issues

The GitHub issues plugin (bundled, under [`plugins/github-issues/`](../plugins/github-issues/)) lists the open issues in each project's GitHub repository (its clone's `origin`) that match the captain's watch rule: by default, labelled `ready-for-pr` or assigned to you. It is off until you turn it on in **Settings → Plugins**. It reads with `gh issue list` (one call per label, and one for the assignee) and `gh api user` (for `@me`) in the project clone, asking only for each issue's number, title, URL, labels, assignees and when it changed, never its body. An issue whose URL Firstmate already records, on a backlog row in `data/backlog.md` (or the lines under it) or in a task's `data/<task>/contributions.json`, shows as **In hand** with a link to that task, found with one bounded `grep` in the Firstmate home; the others offer **Hand to Firstmate**, which fills the chat's message box with the issue's URL, repository and title (`/?draft=`) and sends nothing until you do.

- **Issues** (home rail tab): every enabled project's watched issues, the tab counting those not in hand.
- **Issues** (project tab, at `/projects/<id>/github-issues/issues`): the project's repository, its rule and mode, and its watched issues.

Its page in **Settings → Plugins** sets the plugin-wide watch rule and mode: **Labels to watch** (separated by commas; empty for none), **Assigned to** (empty for none) and **When a new issue turns up** (**Just list it**, **Ring the ship’s bell** or **Hand it to Firstmate**), each saved to `plugins.json` and applied without a restart; a label over 50 characters, or an assignee that is not a login, is refused with the reason rather than saved. A project's own rule or mode is set by hand under `settings.projects` in that file, and the page keeps it. The settings, all optional, plugin-wide or under `projects` for one project (a project's own value wins):

```json
{
	"plugins": {
		"github-issues": {
			"enabled": true,
			"settings": {
				"labels": ["ready-for-pr"],
				"assignee": "@me",
				"mode": "list",
				"projects": { "wheelhouse": { "labels": ["ready-for-pr", "bug"], "mode": "auto" } }
			}
		}
	}
}
```

`labels` are the labels to watch (`[]` for none), and `assignee` a GitHub login written without `@` (`octocat`), or `@me` (null for none); a label or assignee it cannot watch makes the plugin use its default rule; an issue matches when it has one of the labels or that assignee. `mode` says what happens when a matching issue is newly seen:

| `mode`           | What Wheelhouse does                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list` (default) | lists it, and nothing else                                                                                                                                                                   |
| `bell`           | rings the ship's bell once (**New issue**), with **Hand to Firstmate**, **Open issue** and **Watched issues**                                                                                |
| `auto`           | hands it to Firstmate once, unless it is already in hand: a note through `fm-inbox.sh note`, like any message, with the issue's URL, repository and title and a request id made from its URL |

Plugins cannot write, ring the bell or message Firstmate, and this one is no exception: `bell` and `auto` are Wheelhouse's own issue watcher (`src/lib/server/issues/`), which reads this plugin's `watch` provider once a minute (only the built-in plugin with this id; an installed plugin is never read this way), takes the mode from `plugins.json` itself, and builds every alert and note from the issue's URL, repository, number and title. Issues that already match when a project's `bell` or `auto` watch starts (its first good read, or after its mode, labels or assignee change) are its baseline, not news; a read the plugin made under labels or an assignee other than `plugins.json` now gives decides nothing, and the watcher waits for one made under the new rule. The issues each project has seen are kept in Wheelhouse's state directory (`issue-watch.json`, beside the message store), so a restart rings and sends nothing twice and issues that arrived meanwhile are still news; one that leaves the rule and comes back is not news again, and setting a project back to `list` forgets its record. A handoff waits, and is tried again a minute later, while Firstmate's records cannot be read (so nothing is known to be in hand), messaging is off, or Firstmate refused it; it is never sent a second time once Firstmate has it.

## Vault

The Vault plugin, bundled in the installed-plugin format under `plugins/vault/`, shows what [`wh-vault`](vault.md) holds, by name only: a **Vault** page in the menu (every secret, the projects it is granted to, when it was set and last used, and recent use), a **Secrets** tab on each project that has grants or use, and a **Secrets used** tab on each task that ran a command with `wh-vault run`. It reads by running `wh-vault list --all --json` and `wh-vault audit --json`, neither of which reads a value. It is on by default, and its page shows even while the vault is empty. It runs only the `wh-vault` bundled with Wheelhouse.

The plugin stays read-only. Its Vault page names a compiled-in panel (`vault/overview`, `src/lib/components/wh/vault/`), which only a plugin bundled with Wheelhouse may do. That panel adds a secret, replaces a value, grants, revokes and removes through Wheelhouse itself (`POST /api/vault`, origin and session token checked like every other change), which runs the bundled `wh-vault`. A value typed there passes through Wheelhouse's process on its way to `wh-vault set`. After each change Wheelhouse drops the plugin's cached answers, so its tabs read the vault afresh. See [The vault](vault.md#in-wheelhouse).

## Localhost proxy

The Localhost proxy plugin, bundled under `plugins/localhost-proxy/`, makes the addresses the crew reports on Wheelhouse's own computer work when Wheelhouse is opened from somewhere else: from a Docker container or a cloud workspace through a forwarded port, or from another computer. It is off until you turn it on in **Settings → Plugins**; off, Wheelhouse behaves exactly as without it. It adds nothing to the pages and reads nothing: it is the switch and the settings for Wheelhouse's own proxy (`src/lib/server/localproxy/`), which answers only while the plugin is on (its own switch, or for any project), and only as the built-in plugin with this id.

**How addresses change.** While it is on, every http address on `127.0.0.1` or `localhost` that Wheelhouse shows or embeds opens through Wheelhouse: a live preview's frame and **Open in new tab**, and every link on its pages (in Firstmate's replies, status notes, decision cards and plugin panels), rewritten as you follow it, so the text still reads as the crew wrote it. `http://localhost:5173/app?x=1` becomes `http://5173.localhost:4310/app?x=1`, where 4310 is the port the browser reached Wheelhouse on (so it follows a forwarded port), and Wheelhouse passes the request on to port 5173 on its own loopback (`127.0.0.1`, else `::1`). Browsers send any `*.localhost` name to the viewer's own loopback (Chrome, Edge and Firefox do; a browser that does not cannot open them), so only Wheelhouse's port needs forwarding. An address on Wheelhouse's own port, an `https` address and an address anywhere else are left as they are.

**Why a host name per port, not a path.** A proxied app gets its own origin, as on its own port: `/assets/app.js`, `/@vite/client` and other root paths, client-side routes, cookies and storage work unchanged, and Vite's hot reload WebSocket connects to the page's own host, so it reaches the app through the proxy too. A path such as `/proxy/5173/` would have broken every root path the app uses, and served the app from Wheelhouse's own origin, where its scripts could read Wheelhouse's pages and session token. Here each app is cross-origin to Wheelhouse's pages and to every other app: like an MCP app's sandbox, it cannot reach Wheelhouse's page, token or API.

**What passes through.** Requests and responses, including bodies, streams and WebSockets, pass through untouched except that the app sees its own address (`Host`, and `Origin` and `Referer` from its own proxied page, become `localhost:<port>`), so a dev server that checks its host (Vite does) answers as usual; a redirect to an address on Wheelhouse's computer comes back through the proxy (the app's own address becomes the proxied one); and a cookie's `Domain` is dropped, so it stays with the proxied address. Absolute addresses inside a page's HTML or scripts are not rewritten: an app that links to `http://localhost:5173/` in its own markup leaves the proxy there.

**Which ports it opens.** Only a port the crew has reported an address on since Wheelhouse started (in a task's preview or status notes, a decision card or Firstmate's replies), or one its settings list; any other shows a page saying so, with how to allow it and a direct link for use on Wheelhouse's own computer. It never opens the port Wheelhouse itself answers on, or its MCP app sandboxes, even when listed. The settings, on its page in **Settings → Plugins**:

| Setting                                      | Default | What it does                                                                     |
| -------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| **Open ports the crew reports** (`reported`) | on      | opens the ports the crew has reported; off, only the listed ones                 |
| **More ports to allow** (`ports`)            | none    | ports to open even when nobody reported them, separated by commas (`3000, 8080`) |

```json
{ "plugins": { "localhost-proxy": { "enabled": true, "settings": { "ports": ["3000", "8080"] } } } }
```

**What turning it on exposes.** The proxy answers on Wheelhouse's port, so whoever can reach that port can reach every port it opens, as they could from Wheelhouse's computer itself; when Wheelhouse's port is forwarded to another computer, so are those apps. It adds the protections Wheelhouse's own routes have where a browser is concerned: it answers only `<port>.localhost` host names, which a DNS-rebinding page cannot send; it refuses a request that changes anything (anything but GET, HEAD and OPTIONS), and every WebSocket, unless it comes from the proxied page's own origin, so another site open in the browser, or another proxied app, cannot post to an app or open its socket through it; and it never takes the address to reach from the request, so it reaches only loopback ports on Wheelhouse's computer, never another host. It adds no sign-in of its own: an app that has none is open to anyone who can reach Wheelhouse. There is no TLS, and it does not reach other hosts or open tunnels. Wheelhouse's companion services and MCP sandboxes keep their own addresses.

## Improve

[improve](https://github.com/chrisjowen/improve), the captain's harness-improvement plugin for Claude Code, ships its own Wheelhouse plugin in its repository (its **Improvements** page, **Harness** rail tab, header indicator and proposal section); improve's own docs describe them. Install it like any other plugin:

```sh
wheelhouse plugin install chrisjowen/improve
```

While the Firstmate home has improve's `.harness/improve.json` and no plugin with the id `improve` is installed, the Plugins page (and `/plugins/improve/improvements`) shows an **Install the improve plugin** card with that command, and `/api/plugins` lists it under `suggested`.

## Companion services

A plugin can declare the local web UI its pages link to as a companion service (`services` in the manifest): improve's review UI, a project's docket viewer. Its `resolve(ctx)` works out, through the same context as a provider, the exact command (an argument array, no shell), the directory it runs in, where it serves and a health check for the fleet or one project (only a 2xx answer counts; an optional `identity` names a JSON field the service's answer must carry, or match a given value, so another server on the port reads as occupied, with no Launch, rather than as this one), plus any setup steps and a command to start it by hand; or says why it cannot run. The command comes from the plugin's own code, never from a repository's files. Wheelhouse shows whether the service answers and, only when the captain clicks **Launch** (a POST to `/api/services` with the session token, never on page load), starts it detached, so it keeps running after Wheelhouse stops, waits until it answers and opens it. It starts only services on this computer that listen on loopback alone (`binds: 'loopback'`); one that listens on every interface shows its status and its command but no Launch. Launch output goes to `services/<plugin>-<service>[-<project>].log` in Wheelhouse's state directory, started afresh at each launch. A resolver gets a stable port of its own from `ctx.servicePort(preferred, avoid)`, which Wheelhouse keeps in its state directory per Firstmate home. Pages show a service with `ServiceLaunch` (`src/lib/components/wh/plugins/`); an installed plugin's custom element starts its own with `this.host.launch` (see [The host API](#the-host-api)).

## MCP apps

A plugin can draw an [MCP app](https://modelcontextprotocol.io/extensions/apps) (the `io.modelcontextprotocol/ui` extension, stable spec 2026-01-26) in any slot but the header and Bridge cards, and under a Firstmate tool call in the chat (see [MCP apps in the chat](#mcp-apps-in-the-chat)): the HTML UI an MCP server offers for one of its tools, the same UI Claude Desktop or ChatGPT draws in a conversation. Wheelhouse is the app's host, with its own MCP client. It connects only to MCP servers that plugins declare, each reached over HTTP on one of the plugin's own companion services, so the server starts with the same **Launch**, on the captain's click, and needs no other consent. It does not reach the captain's Claude Code MCP servers, servers on other computers, servers that need signing in, or servers over stdio.

```js
export default {
	providers: [
		{
			id: 'status-args',
			scope: 'fleet',
			ttlMs: 60_000,
			// The tool's arguments, from the fleet, project or task in scope.
			fetch: async (ctx) => available({ name: `${ctx.tasks.length} tasks` }, 'the fleet')
		}
	],
	contributions: [
		{
			slot: 'nav.page',
			id: 'status',
			title: 'Demo status',
			provider: 'status-args',
			render: { app: { server: 'demo', tool: 'show_status' } }
		}
	],
	services: [{ id: 'mcp', title: 'the demo MCP server', scope: 'fleet', resolve /* … */ }],
	mcpServers: [{ id: 'demo', title: 'Demo server', service: 'mcp', path: '/mcp' }]
};
```

- `mcpServers` lists each server: its `id` and `title`, the `service` it runs on, and `path`, its Streamable HTTP endpoint on that service's address (`/mcp` here), which cannot lead off that address. An installed plugin's manifest lists the same ids with their services, `"mcpServers": [{ "id": "demo", "service": "mcp" }]`, and `wheelhouse plugin install` shows them.
- A contribution with `render: { app: { server, tool } }` draws that tool's app. Its provider returns the tool's arguments, a JSON object. A server on a per-project service fills only project and task slots.

When the entry shows, Wheelhouse connects to the server, advertising the UI extension so that a server that checks for it offers its UI tools; finds the tool's `_meta.ui.resourceUri` and reads that `ui://` resource, which must be `text/html;profile=mcp-app`; calls the tool itself with the provider's arguments (there is no model in between); and draws the app, handing it the arguments and then the result. While the server's service is not running, the entry says so, with a button that starts it, or the command to start it by hand.

**The sandbox.** The app runs in a frame from a Wheelhouse sandbox. Each MCP server (for each project its service runs for) gets a sandbox of its own: a server on loopback with a port the system picks, started the first time one of its apps opens. So an app is on another origin from Wheelhouse's pages and from every other server's apps: it cannot reach the page, its session token, Wheelhouse's API or another server's app, and only Wheelhouse's page may frame it. The apps of one server share its sandbox's origin, so their browser storage is not private from each other. The app's HTML runs under a Content-Security-Policy built from the origins its resource declares (`_meta.ui.csp`): with none, no network at all. Wheelhouse signs that policy with a key only the sandbox holds, kept in memory and never sent to a page, and the sandbox serves no policy it did not sign, so an app cannot load itself again under a wider one. A declared entry must be a plain origin (`https://api.example.com`, `https://*.example.com`, with a port if it needs one), so `*`, a bare scheme or a keyword is dropped; forms post nowhere, and no browser plugins load. Under the app, Wheelhouse says which origins it may reach. Camera, microphone, location and clipboard permissions are never granted.

**What an app may ask.** Each request goes through Wheelhouse, which logs every tool call an app makes, and each app's policy when it opens, in its own output:

| Request                                                 | What Wheelhouse does                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/call`                                            | Runs only tools on the app's own server whose `_meta.ui.visibility` includes `app` (both `model` and `app` when it says nothing). One marked `readOnlyHint` runs; any other runs only once the captain agrees to that one call, shown with its arguments. |
| `resources/read`                                        | Reads from the app's own server only.                                                                                                                                                                                                                     |
| `ui/message`                                            | Shows it to the captain first; once agreed, sends it to Firstmate as a message from the captain, marked as from the app.                                                                                                                                  |
| `ui/open-link`                                          | Opens http(s) links only, in a new tab.                                                                                                                                                                                                                   |
| `ui/request-display-mode`                               | `inline`, or `fullscreen` when the app declares it; not `pip`.                                                                                                                                                                                            |
| `ui/update-model-context`, `ui/download-file`, sampling | Refuses them: there is no model to give context to, and no downloads in this first slice.                                                                                                                                                                 |

**Theming.** The app learns the theme (`light` or `dark`, and each change) and Wheelhouse's colours under the spec's style variables: `--color-background-primary` is `--background`, `--color-background-secondary` `--card`, `--color-text-primary` `--foreground`, `--color-text-secondary` `--muted-foreground`, `--color-border-primary` `--border`, `--color-text-info` `--sea`, with `--font-sans` and `--border-radius-md` (`--radius`); `src/lib/apps/context.ts` has the rest. Wheelhouse's own fonts do not load in the sandbox, so the app falls back to its own.

### MCP apps in the chat

An MCP app can also show in the chat, under the Firstmate reply whose work called its tool. When Firstmate's transcript shows a finished call to an MCP tool that one plugin's declared server answers to, and that tool has a UI (`_meta.ui.resourceUri`), the reply gets a closed card naming the tool and its server; opening it draws the app as a slot would, from the same server's sandbox under the same signed policy, and closing it takes the app down. Every other tool call stays text in the reply's activity, as before.

- **Which server.** Claude Code names an MCP server's tools `mcp__<server>__<tool>`, and a server a Claude Code plugin brings `mcp__plugin_<plugin>_<server>__<tool>`. A call counts when `<server>` is a plugin server's `id`, or `plugin_<plugin id>_<server id>`, exactly one plugin's server answers to it, and that plugin is on; so a plugin that wants its app in the chat has Firstmate's Claude Code reach the same server under its `id`. Wheelhouse never reads Claude Code's MCP settings, never reaches a server no plugin declares, and asks about a call only once it has a result. A server on a per-project service is the one for the project the call's `project` argument names (a Firstmate project id); a call without one stays text.
- **What the app gets.** The call's own arguments, and the result Firstmate had, from the transcript: Wheelhouse reads the tool's UI from the server, and does not call the tool again. Claude Code's transcript keeps only a result's text content blocks, never its structured content or images, so a result that is one text block holding a JSON object (as MCP asks a tool with structured content to send) reaches the app with that object as its `structuredContent` too; a result over 2 MiB is not handed over. What the app then asks for (`tools/call`, `resources/read`, `ui/message`) goes through the same checks as in a slot.
- **While its server is stopped.** A call shows its card only if Wheelhouse has seen that tool's UI since it started; the card then offers to start the server, as a slot does.

#### Docket's search

Docket's own plugin ([chrisjowen/docket](https://github.com/chrisjowen/docket)) uses this to draw graph nodes in the chat when Firstmate searches a docket. The two sides agree on:

| Part                   | Agreed                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The server             | Declared in docket's plugin with `"id": "docket"` (Streamable HTTP on one of its companion services); Firstmate's Claude Code reaches it as `docket`, so the tool reads `mcp__docket__docket_search`             |
| The tool               | `docket_search`, `annotations.readOnlyHint: true`, arguments `{ query, project? }`; `project` is the Firstmate project id, which a per-project server needs                                                      |
| Its UI                 | `_meta.ui.resourceUri: "ui://docket/search.html"`, read as `text/html;profile=mcp-app`; `_meta.ui.csp` names no origins unless the app needs the network                                                         |
| Its result             | One text content block holding the matching graph nodes and links as one JSON object (with the same object as `structuredContent`); the app reads `structuredContent`, which Wheelhouse rebuilds from that block |
| Calls the app may make | Other tools on the same server offered to apps (`_meta.ui.visibility` including `app`); read-only ones run at once, any other only once the captain agrees                                                       |

[`tests/fixtures/mcp-app-demo/`](../tests/fixtures/mcp-app-demo/) is a complete example in the installed-plugin format: a dependency-free MCP server with one app (`mcp/server.mjs`), and the plugin that runs it as its companion service and draws its app on a page of its own. Wheelhouse's tests load it.

**The Plugins page.** **Settings → Plugins** (`/settings/plugins`; `/plugins` leads there) lists every plugin, built in or installed, and where it is on, or why it was refused or failed; see [The Plugins pages](#the-plugins-pages). `GET /api/plugins` has the same.

## Installed plugins

An installed plugin lives in a repository of its own, laid out like a Claude Code plugin: a manifest in a dot-folder at the root, and its code in conventional folders.

```
<repo>/
  .wheelhouse-plugin/plugin.json   # the manifest
  wheelhouse/server/index.js       # ESM; default-exports the plugin's providers, contributions and services
  wheelhouse/ui/index.js           # optional ESM bundle that defines custom elements for rich panels
```

[`plugins/project-links/`](../plugins/project-links/) is the Project links plugin in this form, and [`plugins/github-issues/`](../plugins/github-issues/) the GitHub issues plugin. Wheelhouse ships the `plugins/` folder in its package and loads each plugin in it at startup through the same loader as an installed plugin (from `$WHEELHOUSE_BUNDLED_PLUGINS_DIR`, which `wheelhouse open` sets to the package's `plugins/`, else `plugins/` in the working directory, as under `npm run dev`); the Plugins page and `/api/plugins` show it as built in, with no repository or commit.

### The manifest

```json
{
	"$schema": "https://raw.githubusercontent.com/chrisjowen/wheelhouse/main/packages/plugin-sdk/plugin.schema.json",
	"name": "project-links",
	"displayName": "Project links",
	"version": "0.2.0",
	"description": "A project's repository, README and pull requests.",
	"author": { "name": "Chris Owen", "url": "https://github.com/chrisjowen" },
	"repository": "https://github.com/chrisjowen/wheelhouse-project-links",
	"license": "MIT",
	"keywords": ["github"],
	"wheelhouse": {
		"apiVersion": 1,
		"server": "wheelhouse/server/index.js",
		"ui": "wheelhouse/ui/index.js",
		"enabledByDefault": false,
		"contributions": [
			{ "id": "links", "slot": "project.tab" },
			{ "id": "summary", "slot": "harbour.card" }
		],
		"services": [],
		"settings": {
			"board": {
				"title": "Board URL",
				"description": "Where the team's board lives.",
				"required": true
			},
			"timeoutMs": { "title": "Timeout (ms)", "type": "number", "default": 8000 }
		},
		"mcpServers": []
	}
}
```

- `name` is the plugin's id (lower-case letters, digits and dashes) and its install directory; `version` is semver. `displayName`, `description`, `author` (text, or `{ name, email, url }`), `repository`, `homepage`, `license` and `keywords` are optional.
- `wheelhouse.apiVersion` is the plugin contract; a version this Wheelhouse does not load is refused, at install and at startup.
- `wheelhouse.server` (required) and `wheelhouse.ui` (optional) are `.js` or `.mjs` paths inside the repository.
- The enable rule is the manifest's own: `enabledByDefault`, `enabledWhenFile` or `enabledWhenHomeFile`, as in [Turning plugins on and off](#turning-plugins-on-and-off).
- `wheelhouse.contributions` lists every contribution's id and slot, `wheelhouse.services` every companion service's id and scope (`fleet` or `project`), and `wheelhouse.mcpServers` every MCP server's id and the service it runs on (see [MCP apps](#mcp-apps)). These are what `wheelhouse plugin install` shows before you agree, so the server entry must contribute exactly these: Wheelhouse refuses a plugin whose code adds, drops or moves one.
- `wheelhouse.settings` (optional) declares what the plugin needs to know, by key (a letter, then letters, digits and underscores; at most 20): each with a `title` for the question (else the key), a `description`, a `type` (`text`, the default, `number`, `boolean` or `list`, a list of short texts), whether it is `required`, a `default` of that type (for a `list`, a list of texts), and for a `text` setting optionally `options`, the values it may take, each `{ "value": "bell", "label": "Ring the ship’s bell" }` (the label is what pages show; the `default` must be one of the values). See [Settings](#settings).

Any other field is refused. The SDK's [`plugin.schema.json`](../packages/plugin-sdk/plugin.schema.json) is the same rules as a JSON Schema, for editors.

### The server entry

`wheelhouse/server/index.js` default-exports `{ providers, contributions, services?, mcpServers? }`, exactly as a compiled-in plugin's (see [Writing a plugin](#writing-a-plugin)); its id, name, version, contract and enable rule come from the manifest (if the export repeats `id`, `version` or `apiVersion`, they must agree). Wheelhouse imports it once, when it starts, with `import()`: no build step and no `npm install`, so bundle any dependencies into it (with esbuild, say), the SDK's builders included. It has the same read-only `ctx` and the same timeouts, caching and isolation as a compiled-in provider. A contribution renders `{ blocks: true }`, `{ element: '<id>-<name>' }` or `{ app: { server, tool } }` (see [MCP apps](#mcp-apps)); compiled-in panels (`component`) are for compiled-in plugins and those bundled with Wheelhouse only, never an installed one.

### Custom elements

A contribution with `render: { element: 'project-links-summary' }` is drawn by that custom element, which the plugin's UI bundle defines with `customElements.define`. The tag must start with the plugin's id and a dash. Wheelhouse serves the bundle, and any file beside it (split chunks, a stylesheet, images), from `/api/plugins/<id>/ui/<file>`, only from the directory of the manifest's `ui` entry. When the entry first shows, the page imports the bundle, waits up to 5 s for the tag to be defined, creates the element in the slot and sets three properties: `host`, the [host API](#the-host-api), first; `entry`, the slot entry (`key`, `slot`, `pluginId`, `contributionId`, `title`, `projectId`); and `data`, the provider's value (plain JSON). When the provider's value changes, Wheelhouse sets `data` on the same element again, so a setter can re-render. A bundle that fails to load, or never defines the tag, shows "Not available" with the reason in that place (in the header, nothing).

The element sits in the page itself, in light DOM or its own shadow root, and Wheelhouse's CSS variables reach it either way. Use them so it follows the light and dark themes; for example `color: var(--foreground)` and `a { color: var(--sea) }`:

| Variable                                                                     | What it is                               |
| ---------------------------------------------------------------------------- | ---------------------------------------- |
| `--background`, `--foreground`                                               | the page and its text                    |
| `--card`, `--card-foreground`, `--panel`                                     | cards and side panels                    |
| `--muted`, `--muted-foreground`                                              | quiet fills and secondary text           |
| `--accent`, `--accent-foreground`                                            | hover and selected fills                 |
| `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground` | buttons                                  |
| `--border`, `--hair`, `--input`, `--ring`                                    | rules, hairlines, inputs and focus rings |
| `--sea`                                                                      | the accent: links and highlights         |
| `--success`, `--warning`, `--danger`, `--destructive`, `--amber`, `--brass`  | tones                                    |
| `--radius`                                                                   | the corner radius                        |
| `--font-sans`, `--font-display`                                              | the body face and the serif heading face |

The bundle runs in Wheelhouse's pages with the page's own permissions, as Wheelhouse's code does. Show plugin text with `textContent`, not `innerHTML`, and keep links to http(s), as the built-in blocks do.

### The host API

`host` is what the page lets an element do: read and start its own plugin's companion services, the same as a compiled-in page's **Launch**. It names no plugin: the plugin is the element's own, fixed when the element is made, so an element cannot reach another plugin's services, and the page supplies the session token that starting a service needs, so the element does not handle it. This is a convenience, not a boundary: the element runs with the page's own permissions and could read the token itself.

```js
// in the element, e.g. a Launch button's click handler
const view = await this.host.service('ui'); // { state, url, launchable, reason, hint, … } or null
if (view?.launchable) await this.host.launch('ui', { open: `${view.url}/proposals?p=a.yaml` });
```

- `host.pluginId` is the element's plugin.
- `host.service(service, { project? })` answers whether the service is up, as `GET /api/services` does: a `ServiceView` (`state` is `running`, `stopped`, `starting`, `failed`, `occupied` or `unavailable`, with `url`, `reason`, `launchable` and `hint`, the command to start it by hand), or null when the plugin declares no such service there.
- `host.launch(service, { project?, open? })` starts it, as **Launch** does, and once it answers opens `open` (or the service's own address) in a new tab; it resolves to the service's view after the start. Call it from a click handler only, so the new tab is allowed and the start is the captain's.

`project` defaults to the entry's project (null in a fleet slot); a project-scoped service needs one and a fleet one none. There is no stop: a service Wheelhouse started keeps running after it stops, as one started from a compiled-in page does. The SDK types it as `PluginHost`.

### Installing and managing plugins

```sh
wheelhouse plugin install chrisjowen/wheelhouse-project-links@v0.2.0   # a tag, branch or commit; the default branch without one
wheelhouse plugin list                     # id, version, on or off, pinned commit, where from
wheelhouse plugin update project-links     # fetch the same ref again (or --ref <ref>) and replace it
wheelhouse plugin disable project-links    # keep it, but do not load it
wheelhouse plugin enable project-links
wheelhouse plugin remove project-links
```

`install` fetches the repository from GitHub with `git` at the ref given (a shallow fetch; a commit GitHub will not fetch shallowly is fetched in full), records the exact commit, drops the git metadata, checks the manifest and that its entries exist, then shows it: name, version, where it came from, the commit, author, contract, slots, services, MCP apps, UI bundle and when it is on, and that its code runs with your permissions. Nothing is kept until you agree; `--yes` agrees without asking, for scripts, and without a terminal to ask on it refuses unless given `--yes`. Once you agree, it asks for the settings the plugin declares (see [Settings](#settings)). Installing never runs the plugin's code. `update` shows the same, with the old and new version and commit, asks again, and asks for any setting the new version adds. Nothing updates by itself.

**Restarting to load a change.** Wheelhouse loads plugins once, when it starts, so `install`, `update`, `remove`, `enable` and `disable` each restart every Wheelhouse running from the same plugins directory once they have made their change, and say so (`Restarting Wheelhouse at http://127.0.0.1:4310/ to load project-links.`); with none running, they say the change loads at the next start. `wheelhouse open` runs the server under a small supervisor that starts it again with the same options on the port it first listened on (so `--port 0` keeps its address), without opening another browser tab; pages reconnect by themselves, and Firstmate's session and its crew keep running, since they belong to tmux, not to Wheelhouse.

A restart does stop what that Wheelhouse itself is running: PR review agents still answering, plugin services it is still starting (one already started keeps running), the script runs and Firstmate chat it has in flight, and every open terminal drawer, which reconnects. So when a running Wheelhouse has a PR review agent or a service launch in progress, the command lists them and asks before restarting it (the Plugins page lists them in its review); if you say no, it leaves that Wheelhouse running and tells you to restart it to load the change. `--yes` restarts it without asking, still listing what it stops.

#### From the Plugins page

The same can be done on the Plugins page (**Settings → Plugins**, `/settings/plugins`) of a Wheelhouse started by `wheelhouse open`:

- **Install plugin** takes an `org/repo` on GitHub and, optionally, a tag, branch or commit. **Look it up** fetches it as `install` does and shows the same: name, version, where it comes from, the exact commit, author, what it adds and runs, when it is on, that its code runs with your permissions, and what a restart would stop. The settings it declares are a form, each starting from what `plugins.json` already has, else its default; a required one must be filled. **Install and restart** fetches it again and keeps it only if it is still at the commit you were shown (else it asks you to look it up again), writes the settings, records it and restarts Wheelhouse, and the dialog says when it is loaded.
- Each installed plugin's row says whether it has something newer, from one `git ls-remote` of its repository: **New commits** when the branch it was installed from (the default branch without a ref) has moved past its commit; for one installed at a release tag such as `v0.2.0`, **v0.3.0 is out** when the repository has a newer release tag, whose **Move to v0.3.0** updates it to that tag; **Pinned to a commit** for one installed at a commit, which is never checked; **Could not check** with the reason. Wheelhouse checks when the page asks and the last check is more than six hours old; **Check for updates** checks now. **Update** looks the new version up and shows it as above, with the version and commit it has now, a compare link, and only the settings the new version adds, then updates and restarts.

Nothing is installed, updated or restarted until you agree, and nothing updates by itself. One change runs at a time. These requests are refused unless they come from Wheelhouse's own page with its session token, as every change is.

A running Wheelhouse keeps a record of its address and a token made for that start in `.running/<pid>.json` in the plugins directory, readable only by you; asking what it is running (a GET) and restarting it (a POST) both go to `/api/wheelhouse/restart` with that token, which nothing without the file can make.

Installed plugins live in `~/.wheelhouse/plugins/<id>/` (or `$WHEELHOUSE_PLUGINS_DIR`, or `--plugins-dir` on `wheelhouse open` and `wheelhouse plugin`), beside `installed.json`, which records each one's repository, ref, commit, version, install time and whether it is on. Which projects an installed plugin is on for is set on its page in **Settings → Plugins** (or in `plugins.json`), as for any plugin. An installed plugin with the id of a compiled-in or bundled one (such as `project-links`) is refused. Docket's own plugin installs this way: `wheelhouse plugin install chrisjowen/docket`.

### The Plugins pages

**Settings → Plugins** (`/settings/plugins`, from the gear in the header or the Logbook's **Plugins** tab) lists every plugin with a switch that turns it on or off for every project, saved to the plugin's `enabled` in `plugins.json`, and in plain words where it is on now. Turning it on or off for every project also removes each project's own choice (`projects`), so it asks first, naming them, whenever there are any, or where that differs from project to project (the switch then sits half-way); **Back to the default** removes `enabled` again and keeps the projects' choices. Each plugin has a page of its own (`/settings/plugins/<id>`):

- **Where it is on**: the same switch, with **Back to the default** (which removes `enabled`) once it has been used, and for each project Wheelhouse knows, **As the plugin**, **On** or **Off** (removing, or setting, `projects.<project>`).
- **Settings**: the settings its manifest declares, as the same form the install and update dialogs show, each starting from what `plugins.json` has, else its default. **Save settings** writes them to the plugin's `settings`, keeping anything else there (such as GitHub issues' per-project rules): an empty text is kept as empty, an empty list as none, and an empty number, yes-or-no or choice is removed so the plugin uses its default. A required setting must be filled.
- **About**: what it adds to the pages, where it comes from, its version and where it is on by default.

All of these apply without a restart, since Wheelhouse re-reads `plugins.json` as it changes; each says so when it is saved. The page writes the file only when you change something: it makes it (and the config directory) when there is none, changes only that plugin's entry and keeps everything else, writes through a temporary file, and makes one change at a time. A file that is not valid is never overwritten: until it is fixed, every plugin keeps its default and the pages change nothing. The requests (`POST /api/plugins/<id>/config` with `{ "enabled": true }`, `{ "project": "<id>", "enabled": null }` or `{ "settings": { "<key>": "<answer>" } }`) need the page's session token, as every change does.

An installed plugin turned off (`wheelhouse plugin disable`) is not loaded at all, since Wheelhouse loads plugins only when it starts, so its page offers **Load and restart**: it turns the plugin back on, as `wheelhouse plugin enable` does, and restarts Wheelhouse to load it (Firstmate and its crew keep running). A Wheelhouse not started by `wheelhouse open` cannot restart itself, so the page says to run `wheelhouse plugin enable <id>` instead.

### Settings

A plugin that needs to know something about your setup (a board's URL, a timeout) declares it in `wheelhouse.settings`, and `wheelhouse plugin install` lists the settings with the rest of the manifest. Once you agree to install, it asks for each in turn, with its description, offering its default in brackets (Enter takes that): a `number` must be one, a `boolean` is yes or no, and a required one with nothing to offer is asked again. It writes the answers to the plugin's `settings` in `plugins.json` in Wheelhouse's config directory (`--config-dir` on `wheelhouse plugin`), keeping everything else in the file, before it keeps the plugin; a plugins file that is not valid is left alone and nothing is installed. Settings already in the file, from an earlier install or set by hand, are kept and not asked again, and removing a plugin leaves its settings there.

```sh
wheelhouse plugin install acme/board --yes --setting board=https://board.acme.test   # for scripts
```

`--setting key=value` (repeatable) answers one up front. With `--yes` nothing is asked: each setting keeps its value, else takes its default, and a required one with neither refuses the install, naming the `--setting` to pass. To change a setting later, use the plugin's page in **Settings → Plugins**, or edit `plugins.json`; Wheelhouse re-reads it as it changes, so new settings reach the plugin's providers without a restart. A `list` setting is typed with commas between its items (`--setting labels=bug,ready-for-pr`), and one with `options` takes a value or its label. Settings are kept as plain JSON, so do not use them for secrets you would not keep in a file.

**Trust.** An installed plugin's server code runs inside Wheelhouse, and its UI bundle in Wheelhouse's pages, with your permissions. Wheelhouse hands it only read-only helpers and checks what it returns, but it does not sandbox it: install plugins you would run yourself, at a commit you have looked at.

### The SDK

[`packages/plugin-sdk`](../packages/plugin-sdk/) is `@chrisjowen/wheelhouse-plugin-sdk`: the contract's types (`WheelhousePlugin`, `ProviderContext`, `Block`, `PluginElement` and the rest), `PLUGIN_API_VERSION` and `SLOTS`, builders for blocks (`text`, `kv`, `table`, `links`, `image`, `status`, `graph`) and results (`available`, `unavailable`), `definePlugin` for editor types, and `plugin.schema.json`. It is plain ESM with no dependencies and no build step, kept in this repository so it changes with the contract; a test checks its types and values against Wheelhouse's own.

```js
import { available, definePlugin, text, unavailable } from '@chrisjowen/wheelhouse-plugin-sdk';

export default definePlugin({
	providers: [
		{
			id: 'readme',
			scope: 'project',
			ttlMs: 60_000,
			async fetch(ctx) {
				const readme = await ctx.readFile('README.md', { root: 'project', maxBytes: 8192 });
				if (readme === null) return unavailable('No README in the clone.');
				return available([text(readme.split('\n')[0])], 'the README');
			}
		}
	],
	contributions: [
		{
			slot: 'project.tab',
			id: 'readme',
			title: 'README',
			provider: 'readme',
			render: { blocks: true }
		}
	]
});
```

## Writing a plugin

These steps are for a compiled-in plugin; an installed plugin's server entry exports the same providers, contributions and services (see [Installed plugins](#installed-plugins)).

1. Make `src/lib/plugins/<id>/plugin.server.ts` exporting a `WheelhousePlugin` (`src/lib/server/plugins/types.ts`), and add it to `BUILTIN_PLUGINS` in `src/lib/server/plugins/builtin.ts`.

   ```ts
   export const myPlugin: WheelhousePlugin = {
   	apiVersion: PLUGIN_API_VERSION,
   	id: 'my-plugin', // lower-case letters, digits and dashes
   	name: 'My plugin',
   	version: '0.1.0',
   	providers: [
   		{
   			id: 'summary',
   			scope: 'project', // fleet | project | task: no wider than the slots it fills
   			ttlMs: 30_000,
   			async fetch(ctx) {
   				const readme = await ctx.readFile('README.md', { root: 'project', maxBytes: 8192 });
   				if (readme === null) return { available: false, reason: 'No README in the clone.' };
   				const blocks = [{ block: 'text.v1', text: readme.split('\n')[0] }];
   				return { available: true, value: blocks, source: 'the README', observedAt: null };
   			}
   		}
   	],
   	contributions: [
   		{
   			slot: 'project.tab',
   			id: 'readme',
   			title: 'README',
   			provider: 'summary',
   			render: { blocks: true }
   		}
   	]
   };
   ```

2. Read through the context only: `ctx.readFile`, `ctx.exec`, `ctx.changedFiles` and your `ctx.settings` (`src/lib/server/plugins/types.ts`). Return blocks (`render: { blocks: true }`; a `bridge.card` returns cards: `{ key, title, mentions: [url], blocks }`), or give the contribution `render: { component: '<id>/<panel>' }` and register a Svelte panel under that name in `src/lib/plugins/panels.ts`; it receives the provider's value as `data`. Keep provider values to plain JSON.
3. Use `when: 'provider-available'` to hide an entry quietly while its provider has nothing to show, and `badge(value)` to give it a count where the host shows one (a home.card's rail tab).
4. Test the provider through `PluginRegistry`, as `src/lib/server/plugins/bundled.test.ts` does for the bundled Project links, loaded through the loader. `src/lib/server/plugins/builtin.test.ts` checks that every compiled-in plugin loads and that its panels exist.
