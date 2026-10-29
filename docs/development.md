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

| Script               | Does                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`      | Builds the web app (`build/`) and the CLI (`dist/cli.js`)                                                                                                                      |
| `npm run check`      | Type-checks the app (svelte-check) and the CLI (tsc)                                                                                                                           |
| `npm run lint`       | Prettier and ESLint                                                                                                                                                            |
| `npm run format`     | Formats everything with Prettier                                                                                                                                               |
| `npm run test:unit`  | Unit tests: adapter, store, messenger, security, collector, plugins, the Firstmate session and chat; `*.dom.test.ts` files mount components in a simulated browser (happy-dom) |
| `npm run test:smoke` | Builds, then starts the CLI against a fake Firstmate home                                                                                                                      |
| `npm test`           | Both                                                                                                                                                                           |

The code is laid out as the spec describes: `src/routes` (UI and API), `src/lib/components`, `src/lib/server/firstmate` (the script adapter and data-source rules), `src/lib/server/collector` (polling and SSE), `src/lib/bell.ts` and `src/lib/server/bell` (the ship's bell's alerts; `src/lib/client/bell.svelte.ts` rings them in the browser), `src/lib/server/store` (message request ids and receipts), `src/lib/server/issues` (the issue watcher: what Wheelhouse rings or sends on its own for newly seen GitHub issues), `src/lib/server/sessions` (the Firstmate session, its transcript and terminal), `src/lib/server/insights` (decisions made for you, where time went and the work-time estimate, Claude usage), `src/lib/server/buildlog` (what a task's build looks like from the inside: the conversation, what each check found, the docs it read or changed), `src/lib/server/files` (the Markdown files Firstmate names, read only from inside the allowed folders, for the reader at `/files`; `src/lib/docpath.ts` finds those paths in text and links them), `src/lib/server/prreview` (the PR review: the diff as hunks, the task's records, the read-only review agent and its prompts; its tests stub the CLI with `testdata/fake-claude.mjs`), `src/lib/chat` (how the transcript reads as a chat), `src/lib/voice` (dictation and its speech engine), `src/lib/server/upgrade` (checking and upgrading the clone Wheelhouse runs from, checking installed plugins for updates, and the service behind the header's update menu and the Plugins page's install and update; `src/lib/updates.ts` holds what the pages and the server share), and `cli/index.ts` (the Commander entry point; `cli/supervise.ts` is the watcher that restarts the server when it dies or when `wheelhouse plugin` or `wheelhouse upgrade` asks it to, through `cli/running.ts`, or a page's upgrade or plugin change does, through `src/lib/server/restart.ts`; `wheelhouse upgrade` is in `cli/upgrade.ts`). Plugins live in `src/lib/plugins` (the slot and block contract, panels, custom elements, and each compiled-in plugin) and `src/lib/server/plugins` (the registry and enablement, and for installed plugins the manifest, the startup loader and `wheelhouse plugin`, whose commands are in `cli/plugin.ts`); `packages/plugin-sdk` is the plugin SDK and `plugins/` holds the plugins bundled with Wheelhouse in the installed-plugin format (Project links, GitHub issues), which the server loads at startup through the same loader.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `npm ci`, `npm run check`, `npm run lint`, `npm run test:unit`, and `npm pack --dry-run`, whose `prepack` step runs `npm run build`, so a broken build fails CI too. It then packs the package into a temporary directory, installs the tarball globally into a temporary prefix and runs `wheelhouse --help` and `wheelhouse --version`, so a package that builds but fails to start fails CI.

## Releasing

`.github/workflows/release.yml` publishes `@chrisjowen/wheelhouse` to npm when a `vX.Y.Z` tag is pushed or a GitHub release is published. It checks that the tag matches the version in `package.json`, runs the type-check, lint and unit tests, installs the packed tarball into a temporary prefix and runs `wheelhouse --help` and `wheelhouse --version`, then runs `npm publish --provenance --access public`; a pre-release version such as `1.2.0-beta.1` goes to the `next` dist-tag instead of `latest`. A tag push and the release made from it run one after the other, and whichever comes second finds the version already on npm and skips.

The package ships only `build/` (the web app), `dist/cli.js` (the CLI), the README and the licence, without source maps. `npm pack --dry-run` lists exactly what would be published.

To release a version:

1. Bump `version` in `package.json` (and `package-lock.json`, for example with `npm version 0.2.0 --no-git-tag-version`) in a pull request, and merge it.
2. Tag the merge commit on `main` and push the tag (`git tag v0.2.0 && git push origin v0.2.0`), or publish a GitHub release with a new `v0.2.0` tag.

### One-time npm setup

The release workflow authenticates in one of two ways:

- **Trusted publishing (preferred).** On npmjs.com, open the package's settings, add a trusted publisher for GitHub Actions with owner `chrisjowen`, repository `wheelhouse` and workflow `release.yml` (no environment). The workflow then publishes through GitHub's OIDC token, with no secret to manage, and npm shows a provenance attestation for each version. At the time of writing npm only lets you add a trusted publisher to a package that already exists, so the very first version has to be published with the token below (or once by hand with `npm publish --access public`).
- **`NPM_TOKEN` secret (fallback).** Create an npm granular access token with read and write access to the package (to all of your packages, before the first publish) that may publish without a 2FA prompt, and add it to the repository as the Actions secret `NPM_TOKEN`. Once trusted publishing is set up, npm uses that instead and the secret can be deleted.

## Stack choice: SvelteKit 2

Wheelhouse uses SvelteKit 2 with Svelte 5, Vite 7, Tailwind 4 and shadcn-svelte. The UI prototype ran on SvelteKit 3 and needed workarounds for shadcn-svelte: `#lib` aliases, a crash on `extends: "$app/tsconfig"`, and patched component state attributes. SvelteKit 2 works with shadcn-svelte's standard `$lib` aliases and components as generated, so this build pins it. Moving to SvelteKit 3 is a later, separate change once shadcn-svelte supports it cleanly.
