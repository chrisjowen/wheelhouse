# Plugins

Plugins are "panels and providers". A provider reads data on the server; a contribution puts its output in one of the fixed slots below, drawn with Wheelhouse's built-in blocks, with a compiled-in plugin's own Svelte panel, or with a custom element from an installed plugin's UI bundle. Plugins cannot add slots. A plugin is either compiled into Wheelhouse (Docket, Improve and Project links, under `src/lib/plugins/`) or kept in a repository of its own and installed with `wheelhouse plugin install <org/repo>` (see [Installed plugins](#installed-plugins)); both go through the same registry, checks and read-only context. There are no iframes.

| Slot               | About     | Where it shows                                                                                                                       |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `project.tab`      | a project | its own page at `/projects/<id>/<plugin>/<tab>`, linked beside the project's name, on `/harbour?project=<id>` and on `/projects`     |
| `harbour.card`     | a project | a card at the top of the project's Harbour section                                                                                   |
| `task.section`     | a task    | a section right after the passage step named by `placement.step` (under Stages), else a tab of its own, ordered by `placement.order` |
| `step.evidence`    | a task    | under the passage step named by `placement.step`                                                                                     |
| `bridge.card`      | the fleet | under a Firstmate reply in the chat that contains one of the card's URLs exactly                                                     |
| `home.card`        | the fleet | a tab of its own on the home page's rail, after Under way, Needs you and Landed, named by its title and counted by its `badge`       |
| `header.indicator` | the fleet | a small pill in the header on every page, drawn by the plugin's own panel or element only; it shows nothing when it renders nothing  |
| `nav.page`         | the fleet | its own page at `/plugins/<plugin>/<page>`, a top-level menu item in the header after Logbook                                        |

**Isolation.** Each provider call runs with a timeout (3 s by default, at most 10 s) and its result is cached for the provider's `ttlMs` (a failure for at most 15 s); after that, the last good result is served, for up to 10 minutes, while one refresh runs. A provider that throws, times out or returns something malformed becomes "Not available" with the reason, in its own entry only; the rest of the page and every other plugin render as usual. A plugin's own panel mounts in the browser inside an error boundary, so a panel that throws is contained too; an installed plugin whose element's bundle fails to load says so in its own place. An installed plugin that cannot be read, is invalid or throws while it loads is listed as failed, with the reason, and the rest load as usual. Providers see copies of the fleet and read only through their context: `readFile` and `listDir` confined to the project clone, the task worktree or the Firstmate home (at most 64 KiB), `exec` in one of those with an argument array, no shell, a minimal environment and bounded time and output (at most 8 MiB), and `changedFiles` for the files a task in scope changed against its base branch. There is no way to write, message Firstmate or control workers; the one thing Wheelhouse starts for a plugin is its declared companion service, on the captain's click (see [Companion services](#companion-services)). Commands run with your permissions: read-only is the plugin's contract, reviewed in Wheelhouse's own pull requests, not a sandbox.

**Versions.** Every plugin declares the plugin contract it was written against (`apiVersion`, in an installed plugin's manifest `wheelhouse.apiVersion`). Wheelhouse loads the current contract (1) and, once there is a 2, the one before it; it refuses any other, with the reason in `/api/plugins`, and never downgrades silently. Blocks are versioned schemas (`text.v1`, `kv.v1`, `table.v1`, `links.v1`, `image.v1`, `status.v1`, `graph.v1`, the last a nodes-and-links placeholder until a chart renderer lands). A block Wheelhouse does not know renders as a plain fallback, plugin text is always text, and links and images keep only http(s) URLs and same-origin paths.

**Turning plugins on and off.** A plugin is on by default only if it says so: for every project (`enabledByDefault`), or only for projects whose clone has a given file (`enabledWhenFile`). A plugin about Firstmate itself rather than one project can instead be on by default, for the fleet and every project, only while the Firstmate home has a given file (`enabledWhenHomeFile`); its fleet providers then see every task, unassigned ones too. Override that per plugin and per project in `plugins.json` in Wheelhouse's config directory (`$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`); a project's setting wins over the plugin's. Wheelhouse re-reads the file when it changes, and if it is invalid it keeps the defaults and reports why in `/api/plugins`.

```json
{ "plugins": { "project-links": { "enabled": true, "projects": { "firstmate": false } } } }
```

A plugin's `settings` object in the same file is handed to its providers as is (`ctx.settings`); each plugin documents its own.

## Docket

The Docket plugin draws a project's [docket](https://github.com/chrisjowen/team-memory) (the Markdown knowledge files under `.docket/`) as a read-only chart. It is on by default for projects whose clone has `.docket.yaml`, and reads the docket by running `docket graph --json` (docket's versioned graph export) in the project clone. It never writes to `.docket/`, and has no editing, asking or chat; above the chart, the project's docket viewer (`docket open`, its **viewer** service, on a port of its own per project) shows as a link while it runs, else with the command that starts it (`cd <docket> && docket open --port <port>`). When the installed docket's `docket open` takes `--host` (Wheelhouse asks `docket open --help`), **Launch** starts the viewer on 127.0.0.1; an older docket listens on every network interface, so Wheelhouse says so and does not start it.

- **Chart** (project tab, at `/projects/<id>/docket/chart`): the chart fills the window and fits itself to it, never shrinking past where its labels stay legible (it then scrolls in place); the details sit on the right in a resizable panel, as the Firstmate rail does on the home page: the vessels under way and the key, or what the docket records about the landmark you select. It draws owners' waters as bands with their flag, landmarks in dependency columns, environments as harbours on the coast, constraints as hatched restricted waters, and decisions as notices to mariners. A link is charted (solid) when evidence backs it, position approximate (dashed, PA) on some evidence, and existence doubtful (dotted, ED) when stated without evidence; a link to nothing the docket describes is unsurveyed. Each landmark shows when its evidence was last surveyed, faded after six months. Tasks under way are vessels on what they touch. Select a landmark to inspect its links and evidence.

The Chart is the plugin's only contribution: it adds no Harbour card and no task section. Its vessels come from a deterministic join: a changed file touches an exhibit when it is the `path` of evidence recorded on the exhibit or one of its links (a path ending in `/` covers a directory). An exhibit with no file evidence cannot be placed. Settings, all optional:

```json
{
	"plugins": {
		"docket": {
			"settings": {
				"bin": "/abs/path/to/docket",
				"roots": { "wheelhouse": "/abs/path/to/team-memory/examples/acme-platform" },
				"timeoutMs": 8000
			}
		}
	}
}
```

`bin` is the docket CLI (otherwise `docket` on `PATH`); a docket too old for `docket graph --json` is said plainly on the Chart. `roots` draws another docket for a project, such as docket's `examples/acme-platform`, until the project keeps its own; turn the plugin on for that project with `"projects": { "wheelhouse": true }`. `timeoutMs` bounds `docket graph` (at most 9500). `ports` sets a project's viewer port (`{ "wheelhouse": 4400 }`); otherwise Wheelhouse picks one the first time, starting from a port between 4381 and 4780 worked out from the project id and skipping any port another service holds or something on this computer already listens on, and keeps it for that project until the project leaves the fleet.

## Improve

The Improve plugin shows [improve](https://github.com/chrisjowen/improve), the captain's harness-improvement plugin for Claude Code, as it studies this Firstmate home. It is on by default only while the home has improve's `.harness/improve.json`, and shows nothing unless that file turns improve's Firstmate adapter on (`adapters.firstmate.enabled`). It reads improve's state without reimplementing it: it runs improve's adapter CLI in the home (`detect`, `import` without `--save`, `inventory`, and dry runs of `route` and `decisions`) and improve's proposal check, and reads the proposals under `.harness/proposals/` and improve's records in `.harness/firstmate/`. It never passes `--apply` or `--save`. It runs `due` only once periodic review has started counting, because before that `due` records the start of the count.

- **Improvements** (a menu item in the header, at `/plugins/improve/improvements`): three tiles first (the review as a badge with its reason and when the last one ran; how many proposals wait for your call, private and shared; how many tasks improve read, with a bar of what it found by kind), then every proposal as a card, grouped by where it stands (waiting for your call, being drafted, approved, applied, rejected) with a count on each group. A card shows the kind of change as an icon (instructions, skill, script, preference, memory, settings), a short title and one line, chips for its status and for whether its files are private to you (your home's own records, which improve edits once you approve) or shared Firstmate code (which goes to Firstmate as a pull request), an evidence count, and, for one filed as a decision, a chip linking its Firstmate task. **Details** opens the rest: what it changes in full, its files, why, and the evidence. Beside the cards: the patterns that repeat most (each opens to the full question and its answers) and the harness's size. A card's title opens the proposal in improve's own review UI. When that UI is not running, **Launch improve's review UI** (and a card's title) starts it, on your click only: improve's own Vite server from improve's checkout, listening on 127.0.0.1 at the `uiUrl` port, for this home, after installing the UI's dependencies the first time; the proposal opens once it answers.
- **Harness** (a tab on the home page's rail, counting the proposals waiting): the same at a glance: the review badge, the number waiting, the evidence bar and the top three repeated patterns as chips, opening Improvements.
- **Indicator** (in the header, on wide screens): "Review due", "3 to decide", or both, only while a review is due or proposals wait.
- **Improvement** (a section on the task improve filed a proposal as): the proposal's card, opened, with the way back to Improvements.

Settings, all optional:

```json
{
	"plugins": {
		"improve": {
			"settings": {
				"adapter": "/abs/path/to/improve",
				"uiUrl": "http://127.0.0.1:5173"
			}
		}
	}
}
```

`adapter` is improve's checkout (or its `adapters/firstmate/cli.mjs`). Without it, Wheelhouse uses improve's installed copy, as Claude Code's `installed_plugins.json` records it, then the improve clone in the home (`projects/improve`), for an installed copy that predates the adapter. `uiUrl` is where improve's review UI runs (by default `http://127.0.0.1:5173`); Wheelhouse links a proposal to it as `/proposals?p=<file>` when the UI answers there.

## Companion services

A plugin can declare the local web UI its pages link to as a companion service (`services` in the manifest): improve's review UI, a project's docket viewer. Its `resolve(ctx)` works out, through the same context as a provider, the exact command (an argument array, no shell), the directory it runs in, where it serves and a health check for the fleet or one project (only a 2xx answer counts; an optional `identity` names a JSON field the service's answer must carry, or match a given value, so another server on the port reads as occupied, with no Launch, rather than as this one), plus any setup steps and a command to start it by hand; or says why it cannot run. The command comes from the plugin's own code, never from a repository's files. Wheelhouse shows whether the service answers and, only when the captain clicks **Launch** (a POST to `/api/services` with the session token, never on page load), starts it detached, so it keeps running after Wheelhouse stops, waits until it answers and opens it. It starts only services on this computer that listen on loopback alone (`binds: 'loopback'`); one that listens on every interface shows its status and its command but no Launch. Launch output goes to `services/<plugin>-<service>[-<project>].log` in Wheelhouse's state directory, started afresh at each launch. A resolver gets a stable port of its own from `ctx.servicePort(preferred, avoid)`, which Wheelhouse keeps in its state directory per Firstmate home. Pages show a service with `ServiceLaunch` (`src/lib/components/wh/plugins/`).

**The Plugins page.** `/plugins` (under the Logbook) lists every plugin: built in or installed (with its repository and pinned commit), and whether it loaded, was refused, failed or is off, with the reason. `GET /api/plugins` has the same.

## Installed plugins

An installed plugin lives in a repository of its own, laid out like a Claude Code plugin: a manifest in a dot-folder at the root, and its code in conventional folders.

```
<repo>/
  .wheelhouse-plugin/plugin.json   # the manifest
  wheelhouse/server/index.js       # ESM; default-exports the plugin's providers, contributions and services
  wheelhouse/ui/index.js           # optional ESM bundle that defines custom elements for rich panels
```

[`examples/project-links/`](../examples/project-links/) is the Project links plugin in this form, and the tests install and load it.

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
		"services": []
	}
}
```

- `name` is the plugin's id (lower-case letters, digits and dashes) and its install directory; `version` is semver. `displayName`, `description`, `author` (text, or `{ name, email, url }`), `repository`, `homepage`, `license` and `keywords` are optional.
- `wheelhouse.apiVersion` is the plugin contract; a version this Wheelhouse does not load is refused, at install and at startup.
- `wheelhouse.server` (required) and `wheelhouse.ui` (optional) are `.js` or `.mjs` paths inside the repository.
- The enable rule is the manifest's own: `enabledByDefault`, `enabledWhenFile` or `enabledWhenHomeFile`, as in [Turning plugins on and off](#turning-plugins-on-and-off).
- `wheelhouse.contributions` lists every contribution's id and slot, and `wheelhouse.services` every companion service's id and scope (`fleet` or `project`). These are what `wheelhouse plugin install` shows before you agree, so the server entry must contribute exactly these: Wheelhouse refuses a plugin whose code adds, drops or moves one.

Any other field is refused. The SDK's [`plugin.schema.json`](../packages/plugin-sdk/plugin.schema.json) is the same rules as a JSON Schema, for editors.

### The server entry

`wheelhouse/server/index.js` default-exports `{ providers, contributions, services? }`, exactly as a compiled-in plugin's (see [Writing a plugin](#writing-a-plugin)); its id, name, version, contract and enable rule come from the manifest (if the export repeats `id`, `version` or `apiVersion`, they must agree). Wheelhouse imports it once, when it starts, with `import()`: no build step and no `npm install`, so bundle any dependencies into it (with esbuild, say), the SDK's builders included. It has the same read-only `ctx` and the same timeouts, caching and isolation as a compiled-in provider. A contribution renders `{ blocks: true }` or `{ element: '<id>-<name>' }`; compiled-in panels (`component`) are for compiled-in plugins only.

### Custom elements

A contribution with `render: { element: 'project-links-summary' }` is drawn by that custom element, which the plugin's UI bundle defines with `customElements.define`. The tag must start with the plugin's id and a dash. Wheelhouse serves the bundle, and any file beside it (split chunks, a stylesheet, images), from `/api/plugins/<id>/ui/<file>`, only from the directory of the manifest's `ui` entry. When the entry first shows, the page imports the bundle, waits up to 5 s for the tag to be defined, creates the element in the slot and sets two properties: `data`, the provider's value (plain JSON), and `entry`, the slot entry (`key`, `slot`, `pluginId`, `contributionId`, `title`, `projectId`). When the provider's value changes, Wheelhouse sets `data` on the same element again, so a setter can re-render. A bundle that fails to load, or never defines the tag, shows "Not available" with the reason in that place (in the header, nothing).

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

### Installing and managing plugins

```sh
wheelhouse plugin install chrisjowen/wheelhouse-project-links@v0.2.0   # a tag, branch or commit; the default branch without one
wheelhouse plugin list                     # id, version, on or off, pinned commit, where from
wheelhouse plugin update project-links     # fetch the same ref again (or --ref <ref>) and replace it
wheelhouse plugin disable project-links    # keep it, but do not load it
wheelhouse plugin enable project-links
wheelhouse plugin remove project-links
```

`install` fetches the repository from GitHub with `git` at the ref given (a shallow fetch; a commit GitHub will not fetch shallowly is fetched in full), records the exact commit, drops the git metadata, checks the manifest and that its entries exist, then shows it: name, version, where it came from, the commit, author, contract, slots, services, UI bundle and when it is on, and that its code runs with your permissions. Nothing is kept until you agree; `--yes` agrees without asking, for scripts, and without a terminal to ask on it refuses unless given `--yes`. Installing never runs the plugin's code. `update` shows the same, with the old and new version and commit, and asks again. Nothing updates by itself.

Installed plugins live in `~/.wheelhouse/plugins/<id>/` (or `$WHEELHOUSE_PLUGINS_DIR`, or `--plugins-dir` on `wheelhouse open` and `wheelhouse plugin`), beside `installed.json`, which records each one's repository, ref, commit, version, install time and whether it is on. Changes take effect the next time Wheelhouse starts. Which projects an installed plugin is on for is set in `plugins.json`, as for any plugin. An installed plugin with the id of a compiled-in one is refused.

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

1. Make `src/lib/plugins/<id>/plugin.server.ts` exporting a `WheelhousePlugin` (`src/lib/server/plugins/types.ts`), and add it to `BUILTIN_PLUGINS` in `src/lib/server/plugins/builtin.ts`. `src/lib/plugins/project-links/` is a complete example.

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
4. Test the provider through `PluginRegistry`, as `src/lib/plugins/project-links/plugin.test.ts` does. `src/lib/server/plugins/builtin.test.ts` checks that every compiled-in plugin loads and that its panels exist.
