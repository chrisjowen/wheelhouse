# Localhost proxy

The Localhost proxy plugin, bundled with Wheelhouse in the installed-plugin format and loaded at startup as built in.

```
.wheelhouse-plugin/plugin.json   the manifest: id, version, contract, entries, enable rule, settings
wheelhouse/server/index.js       no providers or contributions: the plugin is a switch and its settings
```

When Wheelhouse runs in Docker, in a cloud workspace or on another computer, the localhost addresses the crew reports (live previews, links in Firstmate's replies, status notes and decision cards) point at the viewer's own computer, where nothing answers. While this plugin is on, Wheelhouse shows each of them through itself instead: `http://localhost:5173/app` opens as `http://5173.localhost:4310/app`, where 4310 is the port you reached Wheelhouse on, and Wheelhouse passes the request on to port 5173 on its own computer. It is off unless you turn it on in **Settings → Plugins**.

The proxy itself is Wheelhouse's own code (`src/lib/server/localproxy/`); plugins cannot serve requests. See [docs/plugins.md](../../docs/plugins.md#localhost-proxy) for how it works, its settings and what turning it on exposes.
