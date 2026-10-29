# Vault

The Vault plugin, bundled with Wheelhouse in the installed-plugin format: what [`wh-vault`](../../docs/vault.md) holds, by name only. Wheelhouse ships this folder in its package and loads it at startup through the same loader as an installed plugin, shown as built in.

```
.wheelhouse-plugin/plugin.json   the manifest: id, version, contract, entries, enable rule, slots
wheelhouse/server/index.js       providers and contributions (ESM, no dependencies)
```

It fills a **Vault** page in the menu, a **Secrets** tab on each project with grants or use, and a **Secrets used** tab on each task that ran a command with `wh-vault run`. It reads only by running `wh-vault list --all --json` and `wh-vault audit --json`, neither of which reads a value. It is on by default and shows nothing until the vault holds a secret.

See [docs/vault.md](../../docs/vault.md) for `wh-vault` and [docs/plugins.md](../../docs/plugins.md#installed-plugins) for the format.
