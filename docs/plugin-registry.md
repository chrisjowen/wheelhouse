# Plugin registries

**Plugins** in Wheelhouse's left-hand menu searches plugin registries and installs a plugin from a result: **Install** on its row shows what the plugin is before anything is kept or runs, then **Install and restart** installs it (see [From the marketplace](plugins.md#from-the-marketplace)). A registry is a plain GitHub repository holding one file, `wheelhouse-registry.json`, that lists plugins: each one's name, description, icon and the repository it installs from. The registry holds no plugin code; each plugin lives in a repository of its own, laid out as an [installed plugin](plugins.md#installed-plugins), and installs through the same look-up, review and pinned commit as `wheelhouse plugin install`.

The official Wheelhouse registry is [`chrisjowen/wheelhouse-plugins`](https://github.com/chrisjowen/wheelhouse-plugins). Wheelhouse reads it unless you configure other registries; **Sources** on the Plugins page adds and removes registries (see [Choosing registries](#choosing-registries)), and the search spans every one, each result saying which registry it is from.

## The manifest

`wheelhouse-registry.json`, at the root of the registry's repository:

```json
{
	"$schema": "https://raw.githubusercontent.com/chrisjowen/wheelhouse/main/packages/plugin-sdk/registry.schema.json",
	"schema": "wheelhouse-plugin-registry.v1",
	"name": "Acme plugins",
	"description": "Plugins for Acme's boards and services.",
	"homepage": "https://github.com/acme/wheelhouse-plugins",
	"plugins": [
		{
			"name": "acme-board",
			"displayName": "Acme board",
			"description": "Shows each project's card on the Acme board, with its state and owner.",
			"icon": "icons/acme-board.svg",
			"repository": "acme/wheelhouse-acme-board",
			"ref": "v1.2.0",
			"author": "Acme tools team",
			"homepage": "https://github.com/acme/wheelhouse-acme-board",
			"keywords": ["board", "planning"]
		}
	]
}
```

The registry:

| Field         | Required | What it is                                                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `schema`      | yes      | `"wheelhouse-plugin-registry.v1"`: the format and its version (see [Versions](#versions)).       |
| `name`        | yes      | What the registry is called.                                                                     |
| `description` | no       | What it holds.                                                                                   |
| `homepage`    | no       | An https address about it.                                                                       |
| `plugins`     | yes      | The plugins it lists, in the order the Plugins page shows them before a search (at most 1000).   |
| `$schema`     | no       | [`registry.schema.json`](../packages/plugin-sdk/registry.schema.json), for your editor's checks. |

Each plugin:

| Field         | Required | What it is                                                                                                                                                                                                                                 |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | yes      | The plugin's id: the `name` in its own [manifest](plugins.md#the-manifest) (a lower-case letter, then lower-case letters, digits and dashes; at most 40). A plugin with this id that is installed, or comes with Wheelhouse, is not shown. |
| `description` | yes      | What it does, in a sentence or two; the search reads it.                                                                                                                                                                                   |
| `repository`  | yes      | Its repository on GitHub, `org/repo` (a `https://github.com/org/repo` address is read as the same). **Install** fetches it from there. A plugin from a repository that is already installed is not shown either.                           |
| `displayName` | no       | What the page calls it; the `name` without one.                                                                                                                                                                                            |
| `icon`        | no       | An `.svg`, `.png`, `.webp` or `.ico` image: a path inside the registry's repository, beside `wheelhouse-registry.json` (`icons/acme-board.svg`, never with `..`), or an https address. Drawn at 32 pixels; a puzzle piece without one.     |
| `ref`         | no       | The tag, branch or commit to install, such as a release tag; the repository's default branch without one.                                                                                                                                  |
| `author`      | no       | Who makes it: text, or `{ "name": "…" }` as in a plugin manifest.                                                                                                                                                                          |
| `homepage`    | no       | An https address about it.                                                                                                                                                                                                                 |
| `keywords`    | no       | Words the search also matches (at most 20).                                                                                                                                                                                                |

[`docs/examples/wheelhouse-registry.json`](examples/wheelhouse-registry.json) is a complete example, ready to be the official registry's manifest.

### What Wheelhouse checks

- A registry that cannot be cloned, has no manifest, or whose manifest is not JSON, not an object, has no `name` or `plugins`, or has another `schema`, is not read at all: the Plugins page says why above the results, and every other registry still shows. The one exception is the official registry not being there (no such repository, an empty one, or one without `wheelhouse-registry.json`): until it is published, the page shows a neutral note that the official plugin registry has not been published yet, not an error. Any other failure of the official registry is an error like any other's.
- An entry that breaks the rules above (no `description`, a `repository` that is not `org/repo`, a `ref` that is not a tag, branch or commit, a `name` that is not an id, or a `name` an earlier entry already has) is left out, and the page lists it, with why, under a fold. The rest of the registry still shows.
- An icon in any other form (another scheme, a path out of the registry, a symbolic link out of it, another kind of file) is no icon.
- Fields it does not know are ignored, so a registry can add fields without breaking an older Wheelhouse.
- A plugin listed by more than one registry shows once, from the first registry that lists it.

What a registry says about a plugin is only what the search shows. **Install** fetches the plugin's repository and shows its own manifest (its real name, version, what it adds and runs, the exact commit) before anything is kept, and a registry cannot change that review, so a registry is a way to find plugins, not a reason to trust one.

### Versions

`schema` names the format and its version. Additions that an older Wheelhouse can safely ignore (a new optional field) stay in `v1`. A change an older Wheelhouse would read wrongly takes a new version, `wheelhouse-plugin-registry.v2`; a Wheelhouse that cannot read a registry's version says so and asks to be updated, rather than guessing.

## Choosing registries

Without configuration, Wheelhouse reads the official registry alone. **Sources** on the Plugins page lists the registries it reads, in order, each with when Wheelhouse last synced it, how many plugins it lists, and why the last resync failed if it did:

- **Add registry** takes `org/repo` or the repository's GitHub address (`https://github.com/org/repo`, `github.com/org/repo`, `git@github.com:org/repo.git`, or `https://github.com/org/repo/tree/<branch>` to read a branch or tag). Wheelhouse clones it first and adds it only when it holds a registry it can read; an address on any other host is refused, since a registry is always a GitHub repository.
- **Remove** takes a registry out (asking first), the official one included, and deletes Wheelhouse's clone of it. With the official registry removed, **Add the official registry** puts it back.

Both change `plugin-registries.json` in Wheelhouse's config directory (`$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`, beside `plugins.json`), which you can also edit by hand:

```json
{
	"registries": [
		"chrisjowen/wheelhouse-plugins",
		"acme/wheelhouse-plugins",
		{ "repo": "acme/platform", "ref": "main", "path": "wheelhouse/wheelhouse-registry.json" }
	]
}
```

- `"org/repo"`, or `{ "repo": "org/repo" }`, reads `wheelhouse-registry.json` at the root of that GitHub repository's default branch.
- `ref` reads it at a tag, branch or commit; `path` reads it from elsewhere in the repository (by hand only).
- A registry is always a GitHub repository; an entry with a `url` instead of a `repo` is not valid.
- The list is the whole configuration: leave the official registry out and it is not read; `{ "registries": [] }` reads none. Without the file, Wheelhouse reads the official registry alone, and the first change from the page writes the file with the official registry and the change. The Plugins page shows results in the registries' order. A change from the page keeps the file's other entries and fields as they were.

Wheelhouse reads the file each time the Plugins page asks. A file that is not valid is reported on the page, the official registry is read meanwhile, and the page will not change the file until it is fixed.

## How the Plugins page reads them

Wheelhouse keeps a shallow git clone of each registry under its state directory, in `plugin-registries/` (`$WHEELHOUSE_STATE_DIR`, else `$XDG_STATE_HOME/wheelhouse`, else `~/.local/state/wheelhouse`), and reads each manifest and its icons from the clone, not from `raw.githubusercontent.com`. It clones over https from GitHub with your git, so a private registry works when your git can sign in to it without asking.

The page asks `GET /api/plugins/marketplace`. A registry whose clone was last synced an hour ago or more is resynced first (one whose last resync failed is tried again after five minutes); **Resync** resyncs every registry now (`?refresh=1`). A resync fetches only the newest commit of the registry's ref and moves the clone to it, whether the ref moved forward or was rewritten; a resync that fails keeps the last good copy, which the page still shows, with the failure beside the registry under **Sources**. Each git step has a minute. The answer is the plugins that are not installed, checked against what Wheelhouse has loaded on every answer, so a plugin you have just installed leaves the list at once.

Nothing in a clone ever runs: no hooks, no submodules, and a manifest or icon is read only when it is a plain file inside the clone (at most 1 MB for a manifest, 256 KB for an icon); a symbolic link out of it is refused. Icons come through Wheelhouse (`/api/plugins/marketplace/icon/<name>`): one inside the registry from the clone, one at an https address fetched from only that address. So the page never loads anything from a registry's hosts itself, and an SVG still shows as an image. Reading a registry never installs or runs anything.

`POST /api/plugins/marketplace/registries` with `{ "add": "org/repo" }` or `{ "remove": "<registry id>" }` is the page's change, answered with the marketplace as it then stands.

## Starting a registry

1. Make a public GitHub repository, say `acme/wheelhouse-plugins`.
2. Add `wheelhouse-registry.json` at its root, starting from [the example](examples/wheelhouse-registry.json), with one entry per plugin and their icons beside it.
3. Add it under **Sources** on the Plugins page (or to `plugin-registries.json`); after you change it, **Resync** picks up the change at once.

To add a plugin to the official registry, open a pull request on [`chrisjowen/wheelhouse-plugins`](https://github.com/chrisjowen/wheelhouse-plugins) adding its entry.
