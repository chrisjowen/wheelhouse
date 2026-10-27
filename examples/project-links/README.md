# Project links, as an installed plugin

Wheelhouse's compiled-in Project links plugin (`src/lib/plugins/project-links/`) in the installed-plugin format: what a repository looks like when `wheelhouse plugin install <org/repo>` installs it. The tests install it from a local copy and load it through the startup loader.

```
.wheelhouse-plugin/plugin.json   the manifest: id, version, contract, entries, enable rule, slots
wheelhouse/server/index.js       providers and contributions (ESM, no dependencies)
wheelhouse/ui/index.js           <project-links-summary>, the Harbour card, as a custom element
```

It fills a project tab, a Harbour card, a task section, evidence under the Pull request step and a Bridge card, from the project clone's `origin` remote, its README and the fleet. It is off unless your `plugins.json` turns it on. Its id is the compiled-in plugin's, so Wheelhouse refuses it while that one is built in; give it another `name` to try it beside it.

See [docs/plugins.md](../../docs/plugins.md#installed-plugins) for the format.
