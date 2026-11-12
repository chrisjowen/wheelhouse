/**
 * The plugin marketplace's registry format, shared by the server (which fetches
 * and checks each registry) and the page (which searches what came back).
 *
 * A registry is a plain GitHub repository with one file at its root,
 * `wheelhouse-registry.json`, listing plugins that each live in a repository of
 * their own (see docs/plugin-registry.md):
 *
 *   {
 *     "schema": "wheelhouse-plugin-registry.v1",
 *     "name": "Wheelhouse plugins",
 *     "plugins": [
 *       {
 *         "name": "docket",
 *         "displayName": "Docket",
 *         "description": "A read-only chart of a project's docket.",
 *         "icon": "icons/docket.svg",
 *         "repository": "chrisjowen/docket"
 *       }
 *     ]
 *   }
 *
 * A registry with another `schema` is refused whole; an entry that breaks the
 * rules is left out and said so, and the rest still show.
 */

export const REGISTRY_SCHEMA = 'wheelhouse-plugin-registry.v1';
/** The registry's manifest, at the root of its repository unless its configuration says otherwise. */
export const REGISTRY_FILE = 'wheelhouse-registry.json';
/** The official Wheelhouse plugins registry, used when no registries are configured. */
export const OFFICIAL_REGISTRY_REPO = 'chrisjowen/wheelhouse-plugins';

/** At most this many plugins are read from one registry. */
export const MAX_REGISTRY_PLUGINS = 1000;

/** One plugin a registry lists, checked, with its icon as an address to draw. */
export interface MarketplacePlugin {
	/** The plugin's id: its manifest's `name`, and its install directory. */
	name: string;
	/** What the page calls it (the registry's `displayName`, else the id). */
	displayName: string;
	description: string;
	/**
	 * Its icon: in a registry as read, the address to fetch it from (https, or beside
	 * a registry fetched over http on this computer); in the marketplace's answer to
	 * the page, where Wheelhouse serves it (marketplaceIconHref). Null for none.
	 */
	icon: string | null;
	/** Its repository on GitHub, `org/repo`, to install from. */
	repository: string;
	/** The tag, branch or commit to install; null for the repository's default branch. */
	ref: string | null;
	author: string | null;
	homepage: string | null;
	keywords: string[];
	/** The registry that lists it (its source, as the configuration names it). */
	registry: string;
}

/** An entry left out of a registry, and why. */
export interface SkippedEntry {
	index: number;
	name: string | null;
	reason: string;
}

/** One registry, as read: what it says it is, how many plugins it lists, and what went wrong. */
export interface RegistryView {
	/** As the configuration names it: `org/repo`, or the address it is fetched from. */
	source: string;
	/** The address of its manifest. */
	url: string;
	official: boolean;
	/** The manifest's own name and description, once read. */
	name: string | null;
	description: string | null;
	/** Why it could not be used, in plain words; null when it was read. */
	error: string | null;
	/** Entries left out because they break the rules. */
	skipped: SkippedEntry[];
	/** How many plugins it lists that could be read. */
	count: number;
}

export interface MarketplaceView {
	schema: 'wheelhouse-marketplace.v1';
	/** The registries configuration file, and why it could not be used, if it could not. */
	config: { file: string | null; error: string | null };
	registries: RegistryView[];
	/** Every plugin the registries list that is not installed, the first registry's first. */
	plugins: MarketplacePlugin[];
	/** How many listed plugins are left out because they are installed (or come with Wheelhouse). */
	installed: number;
	/** When the registries were read. */
	fetchedAt: string | null;
}

export type Parsed =
	| {
			ok: true;
			name: string;
			description: string | null;
			homepage: string | null;
			plugins: MarketplacePlugin[];
			skipped: SkippedEntry[];
	  }
	| { ok: false; error: string };

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9_./-]+$/;
const MAX_TEXT = 400;
const MAX_DESCRIPTION = 1000;
const MAX_KEYWORDS = 20;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** `org/repo` (a `.git` ending and a github.com address are accepted), or null. */
export function readRepository(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const t = v
		.trim()
		.replace(/^https:\/\/github\.com\//, '')
		.replace(/\/$/, '')
		.replace(/\.git$/, '');
	return REPO.test(t) && !t.startsWith('-') && !t.split('/').some((p) => /^\.+$/.test(p))
		? t
		: null;
}

/** A tag, branch or commit, or null when it is not one. */
export function readRegistryRef(v: unknown): string | null {
	return typeof v === 'string' && REF.test(v) && !v.startsWith('-') && !v.includes('..') ? v : null;
}

/** A path inside a repository, without `..`, `.` or empty parts, or null. */
export function readRepoPath(v: unknown): string | null {
	if (typeof v !== 'string' || !v || v.length > 200 || v.startsWith('/')) return null;
	const parts = v.split('/');
	return parts.every((p) => p && p !== '.' && p !== '..' && /^[A-Za-z0-9_.@+-]+$/.test(p))
		? v
		: null;
}

/** Where a GitHub-hosted registry's manifest is served from. */
export function githubRegistryUrl(repo: string, ref: string | null, file: string): string {
	return `https://raw.githubusercontent.com/${repo}/${ref ?? 'HEAD'}/${file}`;
}

const localHost = (u: URL) =>
	u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';

/** An address a registry may be fetched from: https, or http on this computer. */
export function allowedRegistryUrl(v: unknown): URL | null {
	if (typeof v !== 'string') return null;
	let u: URL;
	try {
		u = new URL(v);
	} catch {
		return null;
	}
	if (u.username || u.password) return null;
	return u.protocol === 'https:' || (u.protocol === 'http:' && localHost(u)) ? u : null;
}

/** The image files an icon may be, as for a plugin's own menu icon. */
export const ICON_EXTENSIONS = ['.svg', '.png', '.webp', '.ico'];

/** An icon address's file extension, lower-case, when it is one an icon may have; else null. */
export function iconExtension(url: string): string | null {
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		return null;
	}
	const ext = pathname.match(/\.[A-Za-z0-9]+$/)?.[0]?.toLowerCase() ?? '';
	return ICON_EXTENSIONS.includes(ext) ? ext : null;
}

/**
 * Where an entry's icon is fetched from: an https address as given, or a path
 * inside the registry, beside its manifest; either an .svg, .png, .webp or .ico
 * file. Anything else (another scheme, `..`, another kind of file) is no icon.
 * Wheelhouse fetches it for the page (see /api/plugins/marketplace/icon), so a
 * page never loads from a registry's hosts itself.
 */
export function resolveIcon(v: unknown, manifestUrl: string): string | null {
	if (typeof v !== 'string' || !v.trim()) return null;
	const t = v.trim();
	let href: string | null = null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(t)) {
		const u = allowedRegistryUrl(t);
		href = u && u.protocol === 'https:' ? u.href : null;
	} else {
		const rel = readRepoPath(t);
		try {
			href = rel ? new URL(rel, manifestUrl).href : null;
		} catch {
			href = null;
		}
	}
	return href && iconExtension(href) ? href : null;
}

/** Where the page gets a listed plugin's icon: through Wheelhouse, by the plugin's id. */
export const marketplaceIconHref = (name: string) =>
	`/api/plugins/marketplace/icon/${encodeURIComponent(name)}`;

const text = (v: unknown, max = MAX_TEXT): string | null =>
	typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

function httpsUrl(v: unknown): string | null {
	const u = typeof v === 'string' ? allowedRegistryUrl(v) : null;
	return u && u.protocol === 'https:' ? u.href : null;
}

function author(v: unknown): string | null {
	if (typeof v === 'string') return text(v);
	if (isRecord(v)) return text(v.name);
	return null;
}

/** One registry entry, checked; why it cannot be used otherwise. */
export function readEntry(
	v: unknown,
	manifestUrl: string,
	registry: string
): { ok: true; plugin: MarketplacePlugin } | { ok: false; reason: string } {
	if (!isRecord(v)) return { ok: false, reason: 'it is not an object' };
	if (typeof v.name !== 'string' || !ID.test(v.name)) {
		return {
			ok: false,
			reason: '"name" must be the plugin’s id: a lower-case letter, then letters, digits or dashes'
		};
	}
	const description = text(v.description, MAX_DESCRIPTION);
	if (!description) return { ok: false, reason: '"description" is missing' };
	const repository = readRepository(v.repository);
	if (!repository) return { ok: false, reason: '"repository" must be org/repo on GitHub' };
	let ref: string | null = null;
	if (v.ref !== undefined && v.ref !== null) {
		ref = readRegistryRef(v.ref);
		if (!ref) return { ok: false, reason: '"ref" is not a tag, branch or commit' };
	}
	if (v.displayName !== undefined && typeof v.displayName !== 'string') {
		return { ok: false, reason: '"displayName" must be text' };
	}
	if (v.icon !== undefined && typeof v.icon !== 'string') {
		return { ok: false, reason: '"icon" must be an address or a path in the registry' };
	}
	const keywords = Array.isArray(v.keywords)
		? v.keywords
				.filter((k): k is string => typeof k === 'string' && !!k.trim())
				.slice(0, MAX_KEYWORDS)
				.map((k) => k.trim().slice(0, 40))
		: [];
	return {
		ok: true,
		plugin: {
			name: v.name,
			displayName: text(v.displayName) ?? v.name,
			description,
			icon: resolveIcon(v.icon, manifestUrl),
			repository,
			ref,
			author: author(v.author),
			homepage: httpsUrl(v.homepage),
			keywords,
			registry
		}
	};
}

/**
 * A registry's manifest, checked. The whole registry is refused when it is not
 * JSON, not a registry or of another schema version; each entry that breaks the
 * rules (or repeats an earlier entry's name) is left out with the reason.
 * Fields this Wheelhouse does not know are ignored, so a registry can add some
 * without breaking older Wheelhouses; a change they could not read takes a new
 * schema version.
 */
export function parseRegistry(body: string, manifestUrl: string, registry: string): Parsed {
	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch (e) {
		return { ok: false, error: `It is not valid JSON: ${(e as Error).message}` };
	}
	if (!isRecord(raw)) return { ok: false, error: 'It is not a JSON object.' };
	if (raw.schema !== REGISTRY_SCHEMA) {
		const s = typeof raw.schema === 'string' ? raw.schema : null;
		return {
			ok: false,
			error:
				s && s.startsWith('wheelhouse-plugin-registry.')
					? `It is a ${s} registry, which this Wheelhouse cannot read; update Wheelhouse.`
					: `It does not say "schema": "${REGISTRY_SCHEMA}", so it is not a Wheelhouse plugin registry.`
		};
	}
	const name = text(raw.name);
	if (!name) return { ok: false, error: 'It has no "name".' };
	if (!Array.isArray(raw.plugins)) return { ok: false, error: '"plugins" must be a list.' };
	const plugins: MarketplacePlugin[] = [];
	const skipped: SkippedEntry[] = [];
	const seen = new Set<string>();
	raw.plugins.slice(0, MAX_REGISTRY_PLUGINS).forEach((entry, index) => {
		const r = readEntry(entry, manifestUrl, registry);
		const entryName = isRecord(entry) && typeof entry.name === 'string' ? entry.name : null;
		if (!r.ok) return skipped.push({ index, name: entryName, reason: r.reason });
		if (seen.has(r.plugin.name)) {
			return skipped.push({ index, name: entryName, reason: 'an earlier entry has this name' });
		}
		seen.add(r.plugin.name);
		plugins.push(r.plugin);
	});
	if (raw.plugins.length > MAX_REGISTRY_PLUGINS) {
		skipped.push({
			index: MAX_REGISTRY_PLUGINS,
			name: null,
			reason: `only the first ${MAX_REGISTRY_PLUGINS} plugins are read`
		});
	}
	return {
		ok: true,
		name,
		description: text(raw.description, MAX_DESCRIPTION),
		homepage: httpsUrl(raw.homepage),
		plugins,
		skipped
	};
}

/** A plugin Wheelhouse already has: its id and, for an installed one, its repository. */
export interface KnownPlugin {
	id: string;
	repository: string | null;
}

/**
 * The listed plugins that are not installed: none whose id Wheelhouse already
 * knows (installed, bundled or compiled in, in any state) or whose repository
 * is already installed; a plugin listed by two registries shows once, from the
 * first. Also says how many were left out as installed.
 */
export function notInstalled(
	plugins: MarketplacePlugin[],
	known: KnownPlugin[]
): { plugins: MarketplacePlugin[]; installed: number } {
	const ids = new Set(known.map((k) => k.id));
	const repos = new Set(
		known.flatMap((k) => (k.repository ? [readRepository(k.repository)?.toLowerCase()] : []))
	);
	const shown = new Set<string>();
	const installed = new Set<string>();
	const out: MarketplacePlugin[] = [];
	for (const p of plugins) {
		if (ids.has(p.name) || repos.has(p.repository.toLowerCase())) {
			installed.add(p.name);
			continue;
		}
		if (shown.has(p.name)) continue;
		shown.add(p.name);
		out.push(p);
	}
	return { plugins: out, installed: installed.size };
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The plugins a search finds, best first: every word of the query must appear in
 * the plugin's name, id, description, keywords, author or repository (any case,
 * any accents). A match on the name ranks above one on the description; equal
 * matches keep the registries' order. An empty query finds every plugin, in order.
 */
export function searchPlugins(plugins: MarketplacePlugin[], query: string): MarketplacePlugin[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (!words.length) return plugins;
	const scored: { p: MarketplacePlugin; score: number; i: number }[] = [];
	plugins.forEach((p, i) => {
		const title = fold(`${p.displayName} ${p.name}`);
		const rest = fold(
			[p.description, p.keywords.join(' '), p.author ?? '', p.repository].join(' ')
		);
		let score = 0;
		for (const w of words) {
			if (title.split(/[\s-]+/).some((t) => t === w)) score += 4;
			else if (title.split(/[\s-]+/).some((t) => t.startsWith(w))) score += 3;
			else if (title.includes(w)) score += 2;
			else if (rest.includes(w)) score += 1;
			else return;
		}
		scored.push({ p, score, i });
	});
	return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.p);
}
