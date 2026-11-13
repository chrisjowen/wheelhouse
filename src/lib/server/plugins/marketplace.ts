import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ICON_TYPES } from './manifest';
import type { Git } from './install';
import {
	hasClone,
	NO_RECORD,
	readCloneFile,
	readSyncRecord,
	removeClone,
	runGitTimed,
	syncClone,
	writeSyncRecord,
	type SyncRecord
} from './registry-clones';
import {
	githubRegistryUrl,
	iconExtension,
	marketplaceIconHref,
	notInstalled,
	OFFICIAL_REGISTRY_REPO,
	parseRegistry,
	readRegistryInput,
	readRegistryRef,
	readRepoPath,
	readRepository,
	REGISTRY_FILE,
	type KnownPlugin,
	type MarketplacePlugin,
	type MarketplaceView,
	type RegistryView
} from '../../plugins/marketplace';

/**
 * The plugin marketplace: which registries to read, keeping a clone of each,
 * reading them, and the plugins they list that are not installed. The
 * registries are the captain's configuration, `plugin-registries.json` in
 * Wheelhouse's config directory:
 *
 *   {
 *     "registries": [
 *       "chrisjowen/wheelhouse-plugins",
 *       { "repo": "acme/wheelhouse-plugins", "ref": "main", "path": "wheelhouse-registry.json" }
 *     ]
 *   }
 *
 * Without the file, the official registry is the only one. The Plugins page
 * adds and removes registries in it; reading a registry never installs or
 * runs anything.
 *
 * Each registry is a shallow git clone under the state directory
 * (registry-clones.ts), brought up to date in the background when it is an hour
 * old and the page asks (the page answers from the clone meanwhile), or at once
 * on **Resync**; its manifest and icons are read from the clone.
 */

export const REGISTRIES_FILE = 'plugin-registries.json';
/** How old a registry's clone may be before the page's next read brings it up to date. */
export const SYNC_INTERVAL_MS = 60 * 60_000;
/** How soon a clone whose last update failed is tried again on the page's next read. */
export const RETRY_INTERVAL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_REGISTRIES = 20;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_ICONS_KEPT = 200;

/** A registry to read: what the configuration calls it, and where it is. */
export interface RegistrySource {
	/** Names it, and its clone's directory: stable for the same repository, ref and path. */
	id: string;
	source: string;
	/** Where a person can look at its manifest. */
	url: string;
	official: boolean;
	repo: string;
	ref: string | null;
	/** Its manifest's path inside the repository. */
	file: string;
}

/** The id of a registry: its repository, readable, and a hash of the rest. */
export function registryId(repo: string, ref: string | null, file: string): string {
	const [org, name] = repo.toLowerCase().split('/');
	const hash = createHash('sha256')
		.update(`${repo.toLowerCase()}\n${ref ?? ''}\n${file}`)
		.digest('hex')
		.slice(0, 10);
	return `${org}--${name}-${hash}`.replace(/[^a-z0-9_.-]/g, '_');
}

function source(repo: string, ref: string | null, file: string): RegistrySource {
	return {
		id: registryId(repo, ref, file),
		source: ref ? `${repo}@${ref}` : repo,
		url: githubRegistryUrl(repo, ref, file),
		official:
			repo.toLowerCase() === OFFICIAL_REGISTRY_REPO.toLowerCase() &&
			ref === null &&
			file === REGISTRY_FILE,
		repo,
		ref,
		file
	};
}

const official = (): RegistrySource => source(OFFICIAL_REGISTRY_REPO, null, REGISTRY_FILE);

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function readSource(v: unknown, at: string): RegistrySource | string {
	if (typeof v === 'string') v = { repo: v };
	if (!isRecord(v)) return `${at} must be "org/repo" or an object`;
	if (v.url !== undefined) return `${at}: a registry is a GitHub repository; use "repo", not "url"`;
	const repo = readRepository(v.repo);
	if (!repo) return `${at} needs "repo" as org/repo on GitHub`;
	let ref: string | null = null;
	if (v.ref !== undefined && v.ref !== null) {
		ref = readRegistryRef(v.ref);
		if (!ref) return `${at}.ref is not a tag, branch or commit`;
	}
	let file = REGISTRY_FILE;
	if (v.path !== undefined) {
		const p = readRepoPath(v.path);
		if (!p) return `${at}.path must be a path inside the repository`;
		file = p;
	}
	return source(repo, ref, file);
}

/** The registries a configuration file names, in order, or why it cannot be used. */
export function parseRegistriesConfig(
	body: string
): { ok: true; sources: RegistrySource[] } | { ok: false; error: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch (e) {
		return { ok: false, error: `not valid JSON: ${(e as Error).message}` };
	}
	if (!isRecord(raw)) return { ok: false, error: 'expected a JSON object' };
	if (!Array.isArray(raw.registries)) return { ok: false, error: '"registries" must be a list' };
	if (raw.registries.length > MAX_REGISTRIES) {
		return { ok: false, error: `at most ${MAX_REGISTRIES} registries` };
	}
	const sources: RegistrySource[] = [];
	for (const [i, v] of raw.registries.entries()) {
		const s = readSource(v, `registries[${i}]`);
		if (typeof s === 'string') return { ok: false, error: s };
		if (!sources.some((x) => x.id === s.id)) sources.push(s);
	}
	return { ok: true, sources };
}

/**
 * The registries to read. A missing file means the official registry alone; one
 * that cannot be used is reported, and the official registry is read meanwhile.
 */
export async function readRegistries(
	configDir: string
): Promise<{ file: string; sources: RegistrySource[]; error: string | null }> {
	const file = path.join(configDir, REGISTRIES_FILE);
	let body: string;
	try {
		body = await readFile(file, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return { file, sources: [official()], error: null };
		}
		return { file, sources: [official()], error: `It could not be read: ${(e as Error).message}` };
	}
	const r = parseRegistriesConfig(body);
	return r.ok
		? { file, sources: r.sources, error: null }
		: { file, sources: [official()], error: `It is not valid: ${r.error}.` };
}

/**
 * The configuration file as it stands, to change: its object (the official
 * registry alone when there is no file), or why it cannot be changed.
 */
async function readConfigToChange(
	configDir: string
): Promise<
	| { ok: true; raw: Record<string, unknown> & { registries: unknown[] } }
	| { ok: false; error: string }
> {
	const file = path.join(configDir, REGISTRIES_FILE);
	let body: string;
	try {
		body = await readFile(file, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return { ok: true, raw: { registries: [OFFICIAL_REGISTRY_REPO] } };
		}
		return { ok: false, error: `${file} could not be read: ${(e as Error).message}.` };
	}
	const checked = parseRegistriesConfig(body);
	if (!checked.ok) {
		return { ok: false, error: `${file} is not valid (${checked.error}); fix it first.` };
	}
	const raw = JSON.parse(body) as Record<string, unknown> & { registries: unknown[] };
	return { ok: true, raw };
}

async function writeConfig(configDir: string, raw: Record<string, unknown>): Promise<void> {
	await mkdir(configDir, { recursive: true });
	const file = path.join(configDir, REGISTRIES_FILE);
	const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
	await writeFile(tmp, JSON.stringify(raw, null, '\t') + '\n');
	await rename(tmp, file);
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** An icon Wheelhouse fetched for the page. */
export interface Icon {
	body: Uint8Array;
	type: string;
}

/** Fetch an icon a registry names, as the image its extension says, or null. Never throws. */
export async function fetchIcon(
	url: string,
	fetcher: Fetcher,
	timeoutMs = FETCH_TIMEOUT_MS
): Promise<Icon | null> {
	const ext = iconExtension(url);
	const type = ext ? ICON_TYPES[ext] : undefined;
	if (!type) return null;
	try {
		const res = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) return null;
		if (Number(res.headers.get('content-length') ?? 0) > MAX_ICON_BYTES) return null;
		const body = new Uint8Array(await res.arrayBuffer());
		return body.byteLength > MAX_ICON_BYTES ? null : { body, type };
	} catch {
		return null;
	}
}

/**
 * One registry, read from its clone `dir` and checked, with what its last
 * update left: never throws. Without a clone it is the update's failure (or,
 * for the official registry not found, not published yet); with one, a failed
 * update still shows what the clone has.
 */
export async function readRegistry(
	src: RegistrySource,
	dir: string,
	sync: SyncRecord
): Promise<{ view: RegistryView; plugins: MarketplacePlugin[] }> {
	const view: RegistryView = {
		id: src.id,
		source: src.source,
		url: src.url,
		official: src.official,
		name: null,
		description: null,
		error: null,
		unpublished: false,
		skipped: [],
		count: 0,
		syncedAt: sync.syncedAt === null ? null : new Date(sync.syncedAt).toISOString(),
		syncError: sync.error
	};
	const fail = (error: string) => ({ view: { ...view, error }, plugins: [] });
	if (!(await hasClone(dir))) {
		if (src.official && sync.notFound) return { view: { ...view, unpublished: true }, plugins: [] };
		return fail(sync.error ?? 'Wheelhouse has not fetched it yet.');
	}
	const read = await readCloneFile(dir, src.file, MAX_MANIFEST_BYTES);
	if (!read.ok) {
		if (read.missing && src.official) return { view: { ...view, unpublished: true }, plugins: [] };
		if (read.missing) {
			return fail(
				`There is no registry there: the repository has no ${src.file}${src.ref ? ` at ${src.ref}` : ''}.`
			);
		}
		return fail(
			read.error === 'it is too large'
				? 'Its manifest is larger than 1 MB.'
				: `Its manifest could not be read: ${read.error}.`
		);
	}
	const parsed = parseRegistry(
		read.body.toString('utf8'),
		pathToFileURL(path.join(dir, src.file)).href,
		src.source
	);
	if (!parsed.ok) return fail(parsed.error);
	return {
		view: {
			...view,
			name: parsed.name,
			description: parsed.description,
			skipped: parsed.skipped,
			count: parsed.plugins.length
		},
		plugins: parsed.plugins
	};
}

export interface MarketplaceDeps {
	configDir: string;
	/** Where the registries' clones are kept. */
	cacheDir: string;
	/** The plugins Wheelhouse already has, in any state. */
	known: () => Promise<KnownPlugin[]>;
	/** Fetches an icon a registry names by an https address. */
	fetch?: Fetcher;
	git?: Git;
	/** Where `org/repo` is cloned from; tests point it at a local repository. */
	gitUrl?: (repo: string) => string;
	now?: () => number;
}

interface Read {
	registries: RegistryView[];
	plugins: MarketplacePlugin[];
}

export type Change = { ok: true; source: string } | { ok: false; error: string };

/**
 * Reads the configured registries from their clones (each on its own: one
 * that fails never hides another's plugins), bringing a clone up to date when
 * it is old or on **Resync**, and answers with the plugins that are not
 * installed. Installed plugins are checked on every answer, so a plugin just
 * installed leaves the list at once.
 */
export class Marketplace {
	private last: Read | null = null;
	private syncing = new Map<string, Promise<SyncRecord>>();
	private changing: Promise<unknown> = Promise.resolve();
	private icons = new Map<string, Promise<Icon | null>>();

	constructor(private readonly deps: MarketplaceDeps) {}

	private now = () => this.deps.now?.() ?? Date.now();
	private git = () => this.deps.git ?? runGitTimed();
	private gitUrl = (repo: string) => this.deps.gitUrl?.(repo) ?? `https://github.com/${repo}.git`;
	private dir = (s: RegistrySource) => path.join(this.deps.cacheDir, s.id);

	/** The marketplace; `refresh` brings every registry's clone up to date first (Resync). */
	async view(opts: { refresh?: boolean } = {}): Promise<MarketplaceView> {
		const cfg = await readRegistries(this.deps.configDir);
		const reads = await Promise.all(
			cfg.sources.map(async (s) => {
				const record = await this.ensure(s, !!opts.refresh);
				const r = await readRegistry(s, this.dir(s), record);
				return { ...r, view: { ...r.view, syncing: this.syncing.has(s.id) } };
			})
		);
		const read: Read = {
			registries: reads.map((x) => x.view),
			plugins: reads.flatMap((x) => x.plugins)
		};
		this.last = read;
		const { plugins, installed } = notInstalled(read.plugins, await this.deps.known());
		return {
			schema: 'wheelhouse-marketplace.v1',
			config: { file: cfg.file, error: cfg.error },
			registries: read.registries,
			plugins: plugins.map((p) => ({ ...p, icon: p.icon ? marketplaceIconHref(p.name) : null })),
			installed,
			fetchedAt: new Date(this.now()).toISOString()
		};
	}

	/**
	 * The registry's sync record, bringing its clone up to date when it is due
	 * (or `force`). Waits for the update only when it is forced or there is no
	 * clone yet; otherwise the update runs on and the clone answers as it is.
	 */
	private async ensure(s: RegistrySource, force: boolean): Promise<SyncRecord> {
		const cloned = await hasClone(this.dir(s));
		const running = this.syncing.get(s.id);
		if (running && (force || !cloned)) return running;
		const record = await readSyncRecord(this.deps.cacheDir, s.id);
		if (running) return record;
		const due =
			force ||
			record.attemptedAt === null ||
			this.now() - record.attemptedAt >= (record.error ? RETRY_INTERVAL_MS : SYNC_INTERVAL_MS) ||
			// Its clone went missing since it was last brought up to date.
			(!record.error && !cloned);
		if (!due) return record;
		const p = this.sync(s, record);
		if (force || !cloned) return p;
		p.catch(() => {});
		return record;
	}

	/** Bring the registry's clone up to date now; one update at a time per registry. */
	private sync(s: RegistrySource, before: SyncRecord = NO_RECORD): Promise<SyncRecord> {
		const running = this.syncing.get(s.id);
		if (running) return running;
		const p = (async () => {
			const r = await syncClone(this.dir(s), this.gitUrl(s.repo), s.ref, this.git());
			const at = this.now();
			const record: SyncRecord = r.ok
				? { syncedAt: at, attemptedAt: at, error: null, notFound: false, commit: r.commit }
				: { ...before, attemptedAt: at, error: r.error, notFound: r.notFound };
			await writeSyncRecord(this.deps.cacheDir, s.id, record).catch(() => {});
			if (r.ok) this.icons.clear();
			return record;
		})().finally(() => this.syncing.delete(s.id));
		this.syncing.set(s.id, p);
		return p;
	}

	/** One change to the configuration at a time. */
	private change<T>(f: () => Promise<T>): Promise<T> {
		const p = this.changing.then(f, f);
		this.changing = p.catch(() => {});
		return p;
	}

	/**
	 * Add a registry, as the captain typed it (`org/repo` or a GitHub address):
	 * cloned and checked first, and kept in the configuration only when it is a
	 * registry Wheelhouse can read.
	 */
	addRegistry(input: unknown): Promise<Change> {
		return this.change(async () => {
			const given = readRegistryInput(input);
			if (!given.ok) return given;
			const cfg = await readConfigToChange(this.deps.configDir);
			if (!cfg.ok) return cfg;
			const s = source(given.repo, given.ref, REGISTRY_FILE);
			const sources = parseRegistriesConfig(JSON.stringify(cfg.raw));
			if (sources.ok && sources.sources.some((x) => x.id === s.id)) {
				return { ok: false, error: `${s.source} is already one of the registries.` };
			}
			if (cfg.raw.registries.length >= MAX_REGISTRIES) {
				return { ok: false, error: `Wheelhouse reads at most ${MAX_REGISTRIES} registries.` };
			}
			const record = await this.sync(s);
			const read = await readRegistry(s, this.dir(s), record);
			if (read.view.error) {
				await removeClone(this.deps.cacheDir, s.id).catch(() => {});
				return { ok: false, error: `${s.source} could not be added. ${read.view.error}` };
			}
			cfg.raw.registries.push(given.ref ? { repo: given.repo, ref: given.ref } : given.repo);
			try {
				await writeConfig(this.deps.configDir, cfg.raw);
			} catch (e) {
				return { ok: false, error: `The registries could not be saved: ${(e as Error).message}.` };
			}
			return { ok: true, source: s.source };
		});
	}

	/** Remove the registry `id` from the configuration, and forget its clone. */
	removeRegistry(id: unknown): Promise<Change> {
		return this.change(async () => {
			if (typeof id !== 'string' || !id)
				return { ok: false, error: 'Say which registry to remove.' };
			const cfg = await readConfigToChange(this.deps.configDir);
			if (!cfg.ok) return cfg;
			let removed: RegistrySource | null = null;
			const kept = cfg.raw.registries.filter((v, i) => {
				const s = readSource(v, `registries[${i}]`);
				if (typeof s !== 'string' && s.id === id) {
					removed = s;
					return false;
				}
				return true;
			});
			const gone = removed as RegistrySource | null;
			if (!gone) return { ok: false, error: 'That registry is not one of the registries.' };
			try {
				await writeConfig(this.deps.configDir, { ...cfg.raw, registries: kept });
			} catch (e) {
				return { ok: false, error: `The registries could not be saved: ${(e as Error).message}.` };
			}
			await this.syncing.get(gone.id)?.catch(() => {});
			await removeClone(this.deps.cacheDir, gone.id).catch(() => {});
			return { ok: true, source: gone.source };
		});
	}

	/**
	 * A listed plugin's icon: read from the clone of the registry that lists it
	 * first, or fetched from the https address it names (only that address, for
	 * that plugin, kept until a registry is brought up to date). Null when it has
	 * none, or it cannot be read.
	 */
	async icon(name: string): Promise<Icon | null> {
		if (!this.last) await this.view();
		const url = this.last?.plugins.find((p) => p.name === name)?.icon;
		if (!url) return null;
		if (url.startsWith('file:')) return this.cloneIcon(url);
		let got = this.icons.get(url);
		if (!got) {
			if (this.icons.size >= MAX_ICONS_KEPT) this.icons.clear();
			got = fetchIcon(url, this.deps.fetch ?? ((u, i) => fetch(u, i)));
			this.icons.set(url, got);
		}
		const icon = await got;
		if (!icon) this.icons.delete(url);
		return icon;
	}

	private async cloneIcon(url: string): Promise<Icon | null> {
		const ext = iconExtension(url);
		const type = ext ? ICON_TYPES[ext] : undefined;
		if (!type) return null;
		let file: string;
		try {
			file = fileURLToPath(url);
		} catch {
			return null;
		}
		const rel = path.relative(this.deps.cacheDir, file);
		const [id, ...rest] = rel.split(path.sep);
		if (!id || !rest.length || rel.startsWith('..') || path.isAbsolute(rel)) return null;
		const read = await readCloneFile(
			path.join(this.deps.cacheDir, id),
			rest.join(path.sep),
			MAX_ICON_BYTES
		);
		return read.ok ? { body: new Uint8Array(read.body), type } : null;
	}
}
