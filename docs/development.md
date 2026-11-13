# Developing Wheelhouse

## Run from a clone

```bash
git clone https://github.com/chrisjowen/wheelhouse.git
cd wheelhouse
npm ci
npm run build
npm link          # puts your local `wheelhouse` on your PATH
```

To bring a clone up to date later, run `wheelhouse upgrade` (or use the header's update menu): it fast-forwards the clone to the default branch on GitHub, runs `npm ci` and `npm run build`, and restarts a running Wheelhouse. It refuses, changing nothing, while the clone has local changes, is on another branch or has commits of its own; see [Keeping Wheelhouse up to date](guide.md#keeping-wheelhouse-up-to-date).

For live reloading while you work on the UI:

```bash
npm ci
WHEELHOUSE_FIRSTMATE_DIR=~/firstmate WHEELHOUSE_HOME=~/crew npm run dev
```

In development Wheelhouse starts (or shows) the Firstmate session the same way, on its first request.

To try the [setup wizard](guide.md#setting-up-firstmate) without touching your own setup, give it a home, config and state of its own, and dry-run the installs (they only say what they would run; cloning still clones, into the folder you pick):

```bash
export HOME=$(mktemp -d) WHEELHOUSE_SETUP_DRY_RUN=1
cd "$HOME" && wheelhouse open --port 0
```

`WHEELHOUSE_SETUP_REPOSITORY` clones another repository instead of Firstmate's (the tests clone a local one).

| Script                     | Does                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`            | Builds the web app (`build/`) and the CLIs (`dist/cli.js`, `dist/wh-vault.js`)                                                                                                                                                                                                       |
| `npm run check`            | Type-checks the app (svelte-check) and the CLI (tsc)                                                                                                                                                                                                                                 |
| `npm run lint`             | Prettier and ESLint                                                                                                                                                                                                                                                                  |
| `npm run format`           | Formats everything with Prettier                                                                                                                                                                                                                                                     |
| `npm test`                 | The fast unit tests, the same as `npm run test:unit`: run these while you work                                                                                                                                                                                                       |
| `npm run test:unit`        | Unit tests: adapter, store, messenger, security, collector, plugins, the messaging gateway, the Firstmate session and chat; `*.dom.test.ts` files mount components in a simulated browser (happy-dom). No real git history, tmux servers or child services                           |
| `npm run test:integration` | `*.integration.test.ts` files, which build real git repositories, start real tmux servers or run child services (passages, upgrades, `wheelhouse plugin`, the diff readers), then the smoke test. Run them when a change touches what they cover; CI runs them on every pull request |
| `npm run test:smoke`       | Builds, then starts the CLI against a fake Firstmate home                                                                                                                                                                                                                            |

While fixing a failure, re-run the affected file first (`npx vitest run src/lib/server/store/store.test.ts`), then `npm test` once at the end. Vitest keeps transformed modules in `node_modules/.vitest-cache`, so a re-run is quicker than the first; `npx vitest --clearCache` empties it.

The code is laid out as the spec describes: `src/routes` (UI and API), `src/lib/components`, `src/lib/server/firstmate` (the script adapter and data-source rules), `src/lib/server/collector` (polling and SSE), `src/lib/bell.ts` and `src/lib/server/bell` (the ship's bell's alerts; `src/lib/client/bell.svelte.ts` rings them in the browser), `src/lib/server/store` (message request ids and receipts), `src/lib/server/issues` (the issue watcher: what Wheelhouse rings or sends on its own for newly seen GitHub issues), `src/lib/server/sessions` (the Firstmate session, its transcript and terminal), `src/lib/server/setup` (the setup wizard: where Firstmate goes and the never-overwrite rule, reading Firstmate's bootstrap check, Claude Code, its sign-in terminal, the plugins step and the remembered Firstmate; `src/lib/setup.ts` holds its steps, shared with the page), `src/lib/server/insights` (decisions made for you, where time went and the work-time estimate, Claude usage), `src/lib/server/buildlog` (what a task's build looks like from the inside: the conversation, what each check found, the docs it read or changed), `src/lib/server/files` (the Markdown files Firstmate names, read only from inside the allowed folders, for the reader at `/files`; `src/lib/docpath.ts` finds those paths in text and links them), `src/lib/server/gateway` (the messaging gateway: the core that routes phone messages, alerts and buttons, pairing, its settings, record and audit log, and `channels/discord.ts`, whose tests run against a fake Discord; its commands are in `cli/gateway.ts`), `src/lib/chat` (how the transcript reads as a chat, including the lines that name attached files; `src/lib/server/uploads.ts` saves, serves and cleans up those files), `src/lib/voice` (dictation and its speech engine), `src/lib/server/upgrade` (checking and upgrading the clone or published npm package Wheelhouse runs from, switching the update source, checking installed plugins for updates, and the service behind the header's update menu and the Plugins page's install and update; `src/lib/updates.ts` holds what the pages and the server share), `cli/index.ts` (the Commander entry point; `cli/supervise.ts` is the watcher that restarts the server when it dies or when `wheelhouse plugin` or `wheelhouse upgrade` asks it to, through `cli/running.ts`, or a page's upgrade or plugin change does, through `src/lib/server/restart.ts`, and restarts it from another install when a source switch leaves a handoff in `<config-dir>/update/next-install`; `wheelhouse upgrade` is in `cli/upgrade.ts`), and `cli/vault` (`wh-vault`: its commands, the backends behind the backend interface (the macOS Keychain, the Linux Secret Service through `secret-tool`, and the opt-in env file, picked in `select.ts`), output masking and the usage log; its tests never touch a real Keychain or keyring). The Vault page's changes, and the chat's Add a secret popup, are `src/lib/server/vault.ts` and `src/routes/api/vault`, which run the bundled `wh-vault` (their tests stub it with a script), drawn by `src/lib/components/wh/vault/` and `src/lib/components/firstmate/VaultAdd.svelte`; `src/lib/chat/vaultrequest.ts` reads the `vault-request` blocks Firstmate asks for a secret with. Plugins live in `src/lib/plugins` (the slot and block contract, panels, custom elements, host templates and address rewrites in `addresses.ts`, while `src/lib/hosted.ts` detects a hosted dev environment's preview URLs and `src/lib/client/addresses.svelte.ts` applies them before a plugin's rewrite, where pull requests open for review in `pullrequests.ts`, and each compiled-in plugin), `src/lib/server/hostroutes` (handing `*.localhost` requests to a plugin's host route, and the addresses on this computer Wheelhouse has shown) and `src/lib/server/plugins` (the registry and enablement, the marketplace that reads plugin registries in `marketplace.ts`, from the clones of them `registry-clones.ts` keeps, and for installed plugins the manifest, the startup loader and `wheelhouse plugin`, whose commands are in `cli/plugin.ts`); `packages/plugin-sdk` is the plugin SDK and `plugins/` holds the plugins bundled with Wheelhouse in the installed-plugin format (Project links, GitHub issues, Vault, Shared review), which the server loads at startup through the same loader.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`. One job runs `npm ci`, `npm run check`, `npm run lint`, `npm run test:unit`, and `npm pack --dry-run`, whose `prepack` step runs `npm run build`, so a broken build fails CI too. It then packs the package into a temporary directory, installs the tarball globally into a temporary prefix and runs `wheelhouse --help` and `wheelhouse --version`, so a package that builds but fails to start fails CI. A second job runs `npm run test:integration` alongside it. Both cache npm downloads between runs, and the first also keeps Vitest’s transformed modules (`node_modules/.vitest-cache`).

## Releasing

`.github/workflows/release.yml` publishes `@chrisjowen/wheelhouse` to npm when a `vX.Y.Z` tag is pushed or a GitHub release is published. It checks that the tag matches the version in `package.json`, runs the type-check, lint, unit and integration tests, installs the packed tarball into a temporary prefix and runs `wheelhouse --help` and `wheelhouse --version`, then runs `npm publish --provenance --access public`; a pre-release version such as `1.2.0-beta.1` goes to the `next` dist-tag instead of `latest`. A tag push and the release made from it run one after the other, and whichever comes second skips: it finds the version already on npm, or, if npm has not caught up yet, npm refuses the publish as already published and the run treats that as done. After a tag push and a successful publish job, a separate job (the only one whose token can write to the repository) publishes a GitHub release for the tag, with generated notes, unless one exists already; the built-in **Released** step of a project's passage reads GitHub releases, not bare tags. That release does not start the workflow again (GitHub does not run workflows for events made with the workflow's own token), and a release published by hand for a version already on npm runs it only to skip.

The package ships only `build/` (the web app), `dist/cli.js` (the CLI), `dist/wh-vault.js` (the vault helper), the bundled `plugins/`, the `manage-wheelhouse` agent skill in `skills/`, the README and the licence, without source maps. `npm pack --dry-run` lists exactly what would be published.

To release a version:

1. Bump `version` in `package.json` (and `package-lock.json`, for example with `npm version 0.2.0 --no-git-tag-version`) in a pull request, and merge it.
2. Tag the merge commit on `main` and push the tag (`git tag v0.2.0 && git push origin v0.2.0`), or publish a GitHub release with a new `v0.2.0` tag. A pushed tag gets its GitHub release from the workflow.

### One-time npm setup

The release workflow authenticates in one of two ways:

- **Trusted publishing (preferred).** On npmjs.com, open the package's settings, add a trusted publisher for GitHub Actions with owner `chrisjowen`, repository `wheelhouse` and workflow `release.yml` (no environment). The workflow then publishes through GitHub's OIDC token, with no secret to manage, and npm shows a provenance attestation for each version. At the time of writing npm only lets you add a trusted publisher to a package that already exists, so the very first version has to be published with the token below (or once by hand with `npm publish --access public`).
- **`NPM_TOKEN` secret (fallback).** Create an npm granular access token with read and write access to the package (to all of your packages, before the first publish) that may publish without a 2FA prompt, and add it to the repository as the Actions secret `NPM_TOKEN`. Once trusted publishing is set up, npm uses that instead and the secret can be deleted.

## Stack choice: SvelteKit 2

Wheelhouse uses SvelteKit 2 with Svelte 5, Vite 7, Tailwind 4 and shadcn-svelte. The UI prototype ran on SvelteKit 3 and needed workarounds for shadcn-svelte: `#lib` aliases, a crash on `extends: "$app/tsconfig"`, and patched component state attributes. SvelteKit 2 works with shadcn-svelte's standard `$lib` aliases and components as generated, so this build pins it. Moving to SvelteKit 3 is a later, separate change once shadcn-svelte supports it cleanly.
