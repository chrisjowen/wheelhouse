# Plugin registries

**Plugins** in Wheelhouse's left-hand menu searches plugin registries and installs a plugin from a result: **Install** on its row shows what the plugin is before anything is kept or runs, then **Install and restart** installs it (see [From the marketplace](plugins.md#from-the-marketplace)). A registry is a plain GitHub repository holding one file, `wheelhouse-registry.json`, that lists plugins: each one's name, description, icon and the repository it installs from. The registry holds no plugin code; each plugin lives in a repository of its own, laid out as an [installed plugin](plugins.md#installed-plugins), and installs through the same look-up, review and pinned commit as `wheelhouse plugin install`.

The official Wheelhouse registry is [`chrisjowen/wheelhouse-plugins`](https://github.com/chrisjowen/wheelhouse-plugins). Wheelhouse reads it unless you configure other registries.

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

- A registry that is not JSON, not an object, has no `name` or `plugins`, or has another `schema`, is not read at all: the Plugins page says why above the results, and every other registry still shows. The one exception is the official registry answering not found (404) at its default address: until it is published, the page shows a neutral note that the official plugin registry has not been published yet, not an error. Any other failure of the official registry is an error like any other's.
- An entry that breaks the rules above (no `description`, a `repository` that is not `org/repo`, a `ref` that is not a tag, branch or commit, a `name` that is not an id, or a `name` an earlier entry already has) is left out, and the page lists it, with why, under a fold. The rest of the registry still shows.
- An icon in any other form (another scheme, a path out of the registry, another kind of file) is no icon.
- Fields it does not know are ignored, so a registry can add fields without breaking an older Wheelhouse.
- A plugin listed by more than one registry shows once, from the first registry that lists it.

What a registry says about a plugin is only what the search shows. **Install** fetches the plugin's repository and shows its own manifest (its real name, version, what it adds and runs, the exact commit) before anything is kept, and a registry cannot change that review, so a registry is a way to find plugins, not a reason to trust one.

### Versions

`schema` names the format and its version. Additions that an older Wheelhouse can safely ignore (a new optional field) stay in `v1`. A change an older Wheelhouse would read wrongly takes a new version, `wheelhouse-plugin-registry.v2`; a Wheelhouse that cannot read a registry's version says so and asks to be updated, rather than guessing.

## Choosing registries

Without configuration, Wheelhouse reads the official registry alone. To read others, or not the official one, list them in `plugin-registries.json` in Wheelhouse's config directory (`$WHEELHOUSE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/wheelhouse`, else `~/.config/wheelhouse`, beside `plugins.json`):

```json
{
	"registries": [
		"chrisjowen/wheelhouse-plugins",
		"acme/wheelhouse-plugins",
		{ "repo": "acme/platform", "ref": "main", "path": "wheelhouse/wheelhouse-registry.json" }
	]
}
```

- `"org/repo"`, or `{ "repo": "org/repo" }`, reads `wheelhouse-registry.json` at the root of that GitHub repository's default branch, from `raw.githubusercontent.com`, so the repository must be public.
- `ref` reads it at a tag, branch or commit; `path` reads it from elsewhere in the repository.
- A registry is always a GitHub repository; an entry with a `url` instead of a `repo` is not valid.
- The list is the whole configuration: leave the official registry out and it is not read; `{ "registries": [] }` reads none. The Plugins page shows results in the registries' order.

Wheelhouse reads the file each time the Plugins page asks, so a change shows on the next **Refresh**. A file that is not valid is reported on the page, and the official registry is read meanwhile. Wheelhouse only reads this file; nothing writes it.

## How the Plugins page reads them

The page asks `GET /api/plugins/marketplace`. Wheelhouse fetches every registry at once (each within 10 seconds, at most 1 MB), keeps what it read for ten minutes (**Refresh** asks again with `?refresh=1`), and answers with the plugins that are not installed, checked against what it has loaded on every answer, so a plugin you have just installed leaves the list at once. Icons come through Wheelhouse too (`/api/plugins/marketplace/icon/<name>`, only the address the registry names for that plugin, at most 256 KB), so the page never loads anything from a registry's hosts itself, and an SVG that GitHub serves as plain text still shows. Reading a registry never installs or runs anything.

## Starting a registry

1. Make a public GitHub repository, say `acme/wheelhouse-plugins`.
2. Add `wheelhouse-registry.json` at its root, starting from [the example](examples/wheelhouse-registry.json), with one entry per plugin and their icons beside it.
3. Add it to `plugin-registries.json` (keeping the official registry, if you want it) and press **Refresh** on the Plugins page.

To add a plugin to the official registry, open a pull request on [`chrisjowen/wheelhouse-plugins`](https://github.com/chrisjowen/wheelhouse-plugins) adding its entry.
