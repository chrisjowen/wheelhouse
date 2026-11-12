import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ICON_TYPES } from './manifest';
import {
	allowedRegistryUrl,
	githubRegistryUrl,
	iconExtension,
	marketplaceIconHref,
	notInstalled,
	OFFICIAL_REGISTRY_REPO,
	parseRegistry,
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
 * The plugin marketplace: which registries to read, reading them, and the
 * plugins they list that are not installed. The registries are the captain's
 * configuration, `plugin-registries.json` in Wheelhouse's config directory:
 *
 *   {
 *     "registries": [
 *       "chrisjowen/wheelhouse-plugins",
 *       { "repo": "acme/wheelhouse-plugins", "ref": "main", "path": "wheelhouse-registry.json" },
 *       { "url": "https://plugins.acme.test/wheelhouse-registry.json" }
 *     ]
 *   }
 *
 * Without the file, the official registry is the only one. Wheelhouse only
 * reads the file; reading a registry never installs or runs anything.
 */

export const REGISTRIES_FILE = 'plugin-registries.json';
/** How long a registry read is kept before the page asks for it again. */
export const MARKETPLACE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_REGISTRIES = 20;
const MAX_ICON_BYTES = 256 * 1024;
const MAX_ICONS_KEPT = 200;

/** A registry to read: what the configuration calls it, and where its manifest is. */
export interface RegistrySource {
	source: string;
	url: string;
	official: boolean;
}

const official = (): RegistrySource => ({
	source: OFFICIAL_REGISTRY_REPO,
	url: githubRegistryUrl(OFFICIAL_REGISTRY_REPO, null, REGISTRY_FILE),
	official: true
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function readSource(v: unknown, at: string): RegistrySource | string {
	if (typeof v === 'string') v = { repo: v };
	if (!isRecord(v)) return `${at} must be "org/repo" or an object`;
	if (v.url !== undefined) {
		const u = allowedRegistryUrl(v.url);
		if (!u) return `${at}.url must be an https address (or http on this computer)`;
		return { source: u.href, url: u.href, official: false };
	}
	const repo = readRepository(v.repo);
	if (!repo) return `${at} needs "repo" as org/repo on GitHub, or a "url"`;
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
	const isOfficial =
		repo.toLowerCase() === OFFICIAL_REGISTRY_REPO.toLowerCase() &&
		ref === null &&
		file === REGISTRY_FILE;
	return {
		source: ref ? `${repo}@${ref}` : repo,
		url: githubRegistryUrl(repo, ref, file),
		official: isOfficial
	};
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
		if (!sources.some((x) => x.url === s.url)) sources.push(s);
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

/** One registry, fetched and checked: never throws. */
export async function readRegistry(
	src: RegistrySource,
	fetcher: Fetcher,
	timeoutMs = FETCH_TIMEOUT_MS
): Promise<{ view: RegistryView; plugins: MarketplacePlugin[] }> {
	const view: RegistryView = {
		source: src.source,
		url: src.url,
		official: src.official,
		name: null,
		description: null,
		error: null,
		unpublished: false,
		skipped: [],
		count: 0
	};
	const fail = (error: string) => ({ view: { ...view, error }, plugins: [] });
	let res: Response;
	try {
		res = await fetcher(src.url, {
			headers: { accept: 'application/json, text/plain;q=0.9' },
			redirect: 'follow',
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (e) {
		const timedOut = (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError';
		return fail(
			timedOut
				? `It did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
				: `It could not be reached: ${(e as Error).message}.`
		);
	}
	if (res.status === 404 && src.official)
		return { view: { ...view, unpublished: true }, plugins: [] };
	if (!res.ok) {
		return fail(
			res.status === 404
				? `There is no registry there (${res.status}): check the repository has ${REGISTRY_FILE} and is public.`
				: `It answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`
		);
	}
	const length = Number(res.headers.get('content-length') ?? 0);
	if (length > MAX_MANIFEST_BYTES) return fail('Its manifest is larger than 1 MB.');
	let body: string;
	try {
		body = await res.text();
	} catch (e) {
		return fail(`It could not be read: ${(e as Error).message}.`);
	}
	if (Buffer.byteLength(body) > MAX_MANIFEST_BYTES)
		return fail('Its manifest is larger than 1 MB.');
	const parsed = parseRegistry(body, src.url, src.source);
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
	/** The plugins Wheelhouse already has, in any state. */
	known: () => Promise<KnownPlugin[]>;
	fetch?: Fetcher;
	now?: () => number;
}

interface Read {
	at: number;
	key: string;
	config: MarketplaceView['config'];
	registries: RegistryView[];
	plugins: MarketplacePlugin[];
}

/**
 * Reads the configured registries (all at once, each on its own: one that
 * fails never hides another's plugins), keeps what it read for a while, and
 * answers with the plugins that are not installed. Installed plugins are
 * checked on every answer, so a plugin just installed leaves the list at once.
 */
export class Marketplace {
	private last: Read | null = null;
	private reading: Promise<Read> | null = null;
	private icons = new Map<string, Promise<Icon | null>>();

	constructor(private readonly deps: MarketplaceDeps) {}

	private now = () => this.deps.now?.() ?? Date.now();

	async view(opts: { refresh?: boolean } = {}): Promise<MarketplaceView> {
		const read = await this.read(!!opts.refresh);
		const { plugins, installed } = notInstalled(read.plugins, await this.deps.known());
		return {
			schema: 'wheelhouse-marketplace.v1',
			config: read.config,
			registries: read.registries,
			plugins: plugins.map((p) => ({ ...p, icon: p.icon ? marketplaceIconHref(p.name) : null })),
			installed,
			fetchedAt: new Date(read.at).toISOString()
		};
	}

	/**
	 * A listed plugin's icon, fetched by Wheelhouse from where the registry that
	 * lists it first says (only that address, for that plugin), and kept until the
	 * registries are read again. Null when it has none, or it cannot be fetched.
	 */
	async icon(name: string): Promise<Icon | null> {
		const url = (this.last ?? (await this.read(false))).plugins.find((p) => p.name === name)?.icon;
		if (!url) return null;
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

	private async read(refresh: boolean): Promise<Read> {
		const cfg = await readRegistries(this.deps.configDir);
		const key = cfg.sources.map((s) => s.url).join('\n');
		const last = this.last;
		if (!refresh && last && last.key === key && this.now() - last.at < MARKETPLACE_TTL_MS) {
			return { ...last, config: { file: cfg.file, error: cfg.error } };
		}
		this.reading ??= this.fetchAll(cfg.sources, key).finally(() => (this.reading = null));
		const r = await this.reading;
		return { ...r, config: { file: cfg.file, error: cfg.error } };
	}

	private async fetchAll(sources: RegistrySource[], key: string): Promise<Read> {
		const fetcher = this.deps.fetch ?? ((u, i) => fetch(u, i));
		const reads = await Promise.all(sources.map((s) => readRegistry(s, fetcher)));
		const r: Read = {
			at: this.now(),
			key,
			config: { file: null, error: null },
			registries: reads.map((x) => x.view),
			plugins: reads.flatMap((x) => x.plugins)
		};
		this.last = r;
		this.icons.clear();
		return r;
	}
}
