import path from 'node:path';
import { SLOTS, type Slot } from '../../plugins/types';
import { SUPPORTED_API_VERSIONS, type WheelhousePlugin } from './types';

/**
 * An installed plugin's manifest, `.wheelhouse-plugin/plugin.json` at the root
 * of its repository, modelled on Claude Code's `.claude-plugin/plugin.json`:
 *
 *   {
 *     "name": "project-links",
 *     "displayName": "Project links",
 *     "version": "0.1.0",
 *     "description": "A project's repository, README and pull requests.",
 *     "author": { "name": "Chris Owen" },
 *     "repository": "https://github.com/chrisjowen/wheelhouse-project-links",
 *     "wheelhouse": {
 *       "apiVersion": 1,
 *       "server": "wheelhouse/server/index.js",
 *       "ui": "wheelhouse/ui/index.js",
 *       "enabledByDefault": false,
 *       "contributions": [{ "id": "links", "slot": "project.tab" }],
 *       "services": [],
 *       "settings": {
 *         "board": { "title": "Board URL", "description": "Where the team's board lives.", "required": true }
 *       }
 *     }
 *   }
 *
 * The manifest is what the captain agrees to at install, so it is the source
 * of the plugin's identity and enablement, and it must declare every
 * contribution and service the server entry exports. `settings` declares what
 * the plugin needs to know (its `ctx.settings`): `wheelhouse plugin install`
 * asks for each and writes the answers to the plugins file. Unknown fields are
 * refused, as in the plugins file.
 */

export const MANIFEST_DIR = '.wheelhouse-plugin';
export const MANIFEST_FILE = 'plugin.json';
export const manifestPath = (pluginDir: string) =>
	path.join(pluginDir, MANIFEST_DIR, MANIFEST_FILE);

/** The fields a manifest may have (the SDK's plugin.schema.json lists the same). */
export const MANIFEST_FIELDS = [
	'$schema',
	'name',
	'displayName',
	'version',
	'description',
	'author',
	'repository',
	'homepage',
	'license',
	'keywords',
	'wheelhouse'
] as const;
export const WHEELHOUSE_FIELDS = [
	'apiVersion',
	'server',
	'ui',
	'enabledByDefault',
	'enabledWhenFile',
	'enabledWhenHomeFile',
	'contributions',
	'services',
	'settings'
] as const;

/** The fields a declared setting may have. */
export const SETTING_FIELDS = ['title', 'description', 'type', 'required', 'default'] as const;
export const SETTING_TYPES = ['text', 'number', 'boolean'] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

/** One value the plugin asks the captain for at install, kept in its `ctx.settings[key]`. */
export interface SettingSpec {
	key: string;
	/** What the question calls it; the key when the manifest gives none. */
	title: string;
	description: string | null;
	type: SettingType;
	/** Install refuses to finish without a value. */
	required: boolean;
	/** Offered as the answer, and used when no one is asked. */
	default?: SettingValue;
}

export type SettingValue = string | number | boolean;

const ID = /^[a-z][a-z0-9-]{0,39}$/;
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_SETTINGS = 20;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_TEXT = 400;

export interface PluginManifest {
	/** The plugin id: lower-case letters, digits and dashes. Also its install directory. */
	name: string;
	/** What pages call it; the id when the manifest gives none. */
	displayName: string;
	version: string;
	description: string | null;
	author: { name: string; email?: string; url?: string } | null;
	repository: string | null;
	homepage: string | null;
	license: string | null;
	keywords: string[];
	wheelhouse: {
		apiVersion: number;
		/** The ESM server entry, relative to the plugin root. */
		server: string;
		/** The optional ESM UI bundle that defines the plugin's custom elements. */
		ui: string | null;
		enabledByDefault?: boolean;
		enabledWhenFile?: string;
		enabledWhenHomeFile?: string;
		contributions: { id: string; slot: Slot }[];
		services: { id: string; scope: 'fleet' | 'project' }[];
		/** In the manifest's order; none when it declares none. */
		settings: SettingSpec[];
	};
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A relative path that stays inside the directory it is relative to. */
export function insidePath(f: unknown): f is string {
	return (
		typeof f === 'string' &&
		f.length > 0 &&
		!path.isAbsolute(f) &&
		!f.split(/[\\/]/).some((part) => part === '..' || part === '' || part === '.')
	);
}

class Invalid extends Error {}

function text(v: unknown, where: string, optional: true): string | null;
function text(v: unknown, where: string, optional?: false): string;
function text(v: unknown, where: string, optional = false): string | null {
	if (v === undefined && optional) return null;
	if (typeof v !== 'string' || !v.trim()) throw new Invalid(`${where} must be text`);
	if (v.length > MAX_TEXT) throw new Invalid(`${where} is longer than ${MAX_TEXT} characters`);
	return v;
}

function only(o: Record<string, unknown>, where: string, keys: readonly string[]) {
	for (const k of Object.keys(o)) {
		if (!keys.includes(k)) throw new Invalid(`unknown field "${where ? `${where}.` : ''}${k}"`);
	}
}

function entry(v: unknown, where: string): string {
	if (!insidePath(v)) throw new Invalid(`${where} must be a plain path inside the plugin`);
	if (!/\.m?js$/.test(v)) throw new Invalid(`${where} must be a JavaScript module (.js or .mjs)`);
	return v;
}

function author(v: unknown): PluginManifest['author'] {
	if (v === undefined) return null;
	if (typeof v === 'string') return { name: text(v, 'author') };
	if (!isRecord(v)) throw new Invalid('author must be text or an object');
	only(v, 'author', ['name', 'email', 'url']);
	const a: NonNullable<PluginManifest['author']> = { name: text(v.name, 'author.name') };
	const email = text(v.email, 'author.email', true);
	const url = text(v.url, 'author.url', true);
	if (email) a.email = email;
	if (url) a.url = url;
	return a;
}

function wheelhouse(v: unknown): PluginManifest['wheelhouse'] {
	if (!isRecord(v)) throw new Invalid('"wheelhouse" must be an object');
	only(v, 'wheelhouse', WHEELHOUSE_FIELDS);
	if (typeof v.apiVersion !== 'number' || !Number.isInteger(v.apiVersion)) {
		throw new Invalid('wheelhouse.apiVersion must be a whole number');
	}
	if (!SUPPORTED_API_VERSIONS.includes(v.apiVersion)) {
		throw new Invalid(
			`it was written for plugin contract ${v.apiVersion}; this Wheelhouse supports ${SUPPORTED_API_VERSIONS.join(' and ')}`
		);
	}
	const w: PluginManifest['wheelhouse'] = {
		apiVersion: v.apiVersion,
		server: entry(v.server, 'wheelhouse.server'),
		ui: v.ui === undefined ? null : entry(v.ui, 'wheelhouse.ui'),
		contributions: [],
		services: [],
		settings: settings(v.settings)
	};
	if (v.enabledByDefault !== undefined) {
		if (typeof v.enabledByDefault !== 'boolean') {
			throw new Invalid('wheelhouse.enabledByDefault must be true or false');
		}
		w.enabledByDefault = v.enabledByDefault;
	}
	for (const k of ['enabledWhenFile', 'enabledWhenHomeFile'] as const) {
		if (v[k] === undefined) continue;
		if (!insidePath(v[k])) throw new Invalid(`wheelhouse.${k} must be a plain relative path`);
		w[k] = v[k];
	}
	if (!Array.isArray(v.contributions)) {
		throw new Invalid('wheelhouse.contributions must be a list');
	}
	for (const [i, c] of v.contributions.entries()) {
		const where = `wheelhouse.contributions[${i}]`;
		if (!isRecord(c)) throw new Invalid(`${where} must be an object`);
		only(c, where, ['id', 'slot']);
		if (typeof c.id !== 'string' || !ID.test(c.id)) {
			throw new Invalid(`${where}.id must be lower-case letters, digits and dashes`);
		}
		if (!SLOTS.includes(c.slot as Slot)) {
			throw new Invalid(`${where}.slot must be one of ${SLOTS.join(', ')}`);
		}
		if (w.contributions.some((x) => x.id === c.id)) {
			throw new Invalid(`it declares contribution "${c.id}" twice`);
		}
		w.contributions.push({ id: c.id, slot: c.slot as Slot });
	}
	if (v.services !== undefined) {
		if (!Array.isArray(v.services)) throw new Invalid('wheelhouse.services must be a list');
		for (const [i, s] of v.services.entries()) {
			const where = `wheelhouse.services[${i}]`;
			if (!isRecord(s)) throw new Invalid(`${where} must be an object`);
			only(s, where, ['id', 'scope']);
			if (typeof s.id !== 'string' || !ID.test(s.id)) {
				throw new Invalid(`${where}.id must be lower-case letters, digits and dashes`);
			}
			if (s.scope !== 'fleet' && s.scope !== 'project') {
				throw new Invalid(`${where}.scope must be "fleet" or "project"`);
			}
			if (w.services.some((x) => x.id === s.id)) {
				throw new Invalid(`it declares service "${s.id}" twice`);
			}
			w.services.push({ id: s.id, scope: s.scope });
		}
	}
	return w;
}

function settings(v: unknown): SettingSpec[] {
	if (v === undefined) return [];
	if (!isRecord(v)) throw new Invalid('wheelhouse.settings must be an object of settings by key');
	const keys = Object.keys(v);
	if (keys.length > MAX_SETTINGS) {
		throw new Invalid(`wheelhouse.settings declares more than ${MAX_SETTINGS} settings`);
	}
	return keys.map((key) => {
		const where = `wheelhouse.settings.${key}`;
		if (!SETTING_KEY.test(key)) {
			throw new Invalid(
				`wheelhouse.settings key "${key}" must start with a letter and hold only letters, digits and underscores`
			);
		}
		const s = v[key];
		if (!isRecord(s)) throw new Invalid(`${where} must be an object`);
		only(s, where, SETTING_FIELDS);
		const type = s.type === undefined ? 'text' : s.type;
		if (!SETTING_TYPES.includes(type as SettingType)) {
			throw new Invalid(`${where}.type must be one of ${SETTING_TYPES.join(', ')}`);
		}
		if (s.required !== undefined && typeof s.required !== 'boolean') {
			throw new Invalid(`${where}.required must be true or false`);
		}
		const spec: SettingSpec = {
			key,
			title: text(s.title, `${where}.title`, true) ?? key,
			description: text(s.description, `${where}.description`, true),
			type: type as SettingType,
			required: s.required ?? false
		};
		if (s.default !== undefined) {
			const ok =
				type === 'number'
					? typeof s.default === 'number' && Number.isFinite(s.default)
					: type === 'boolean'
						? typeof s.default === 'boolean'
						: typeof s.default === 'string' && s.default.length <= MAX_TEXT;
			if (!ok) {
				const want = { text: 'text', number: 'a number', boolean: 'true or false' }[
					type as SettingType
				];
				throw new Invalid(`${where}.default must be ${want}`);
			}
			spec.default = s.default as SettingValue;
		}
		return spec;
	});
}

/** The manifest, or why it is not a valid one (refusing any contract version this Wheelhouse does not load). */
export function parseManifest(
	text_: string
): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(text_);
	} catch (e) {
		return { ok: false, error: `not valid JSON: ${(e as Error).message}` };
	}
	try {
		if (!isRecord(raw)) throw new Invalid('expected a JSON object');
		only(raw, '', MANIFEST_FIELDS);
		if (typeof raw.name !== 'string' || !ID.test(raw.name)) {
			throw new Invalid('name must be lower-case letters, digits and dashes (at most 40)');
		}
		if (typeof raw.version !== 'string' || !SEMVER.test(raw.version)) {
			throw new Invalid('version must be a semantic version, such as 0.1.0');
		}
		if (raw.wheelhouse === undefined) {
			throw new Invalid('"wheelhouse" is missing, so this is not a Wheelhouse plugin');
		}
		const keywords = raw.keywords === undefined ? [] : raw.keywords;
		if (!Array.isArray(keywords) || keywords.some((k) => typeof k !== 'string')) {
			throw new Invalid('keywords must be a list of text');
		}
		return {
			ok: true,
			manifest: {
				name: raw.name,
				displayName: text(raw.displayName, 'displayName', true) ?? raw.name,
				version: raw.version,
				description: text(raw.description, 'description', true),
				author: author(raw.author),
				repository: text(raw.repository, 'repository', true),
				homepage: text(raw.homepage, 'homepage', true),
				license: text(raw.license, 'license', true),
				keywords: keywords as string[],
				wheelhouse: wheelhouse(raw.wheelhouse)
			}
		};
	} catch (e) {
		if (e instanceof Invalid) return { ok: false, error: e.message };
		throw e;
	}
}

/**
 * The plugin a server entry (its module namespace) default-exports, made whole from its manifest, or why the
 * two disagree. The export carries providers, contributions and services; the
 * manifest gives its id, name, version, contract and enablement. An export that
 * repeats one of those must agree, and its contributions and services must be
 * exactly the ones the manifest declares. A contribution drawn by a custom
 * element needs the manifest's UI bundle.
 */
export function fromExport(
	m: PluginManifest,
	exported: unknown
): { ok: true; plugin: WheelhousePlugin } | { ok: false; error: string } {
	const bad = (error: string) => ({ ok: false as const, error });
	const x = isRecord(exported) ? exported.default : undefined;
	if (!isRecord(x)) return bad('its server entry does not default-export a plugin object.');
	for (const [k, want] of [
		['id', m.name],
		['version', m.version],
		['apiVersion', m.wheelhouse.apiVersion]
	] as const) {
		if (x[k] !== undefined && x[k] !== want) {
			return bad(
				`its server entry says ${k} ${JSON.stringify(x[k])}, but its manifest says ${JSON.stringify(want)}.`
			);
		}
	}
	if (!Array.isArray(x.providers) || !Array.isArray(x.contributions)) {
		return bad('its server entry has no providers and contributions lists.');
	}
	for (const p of x.providers) {
		if (!isRecord(p) || typeof p.id !== 'string' || typeof p.fetch !== 'function') {
			return bad('every provider needs an id and a fetch function.');
		}
		if (typeof p.ttlMs !== 'number' || !(p.ttlMs >= 0)) {
			return bad(`provider "${p.id}" needs a ttlMs of zero or more.`);
		}
	}
	for (const c of x.contributions) {
		if (!isRecord(c) || typeof c.id !== 'string' || !isRecord(c.render)) {
			return bad('every contribution needs an id and a render.');
		}
		if (typeof c.title !== 'string' || typeof c.provider !== 'string') {
			return bad(`contribution "${c.id}" needs a title and a provider.`);
		}
		if ('component' in c.render) {
			return bad(
				`contribution "${c.id}" names a compiled-in panel; an installed plugin draws with blocks or a custom element.`
			);
		}
		if ('element' in c.render && !m.wheelhouse.ui) {
			return bad(
				`contribution "${c.id}" is drawn by a custom element, but the manifest names no ui bundle.`
			);
		}
		if (c.badge !== undefined && typeof c.badge !== 'function') {
			return bad(`contribution "${c.id}" has a badge that is not a function.`);
		}
	}
	const services = x.services ?? [];
	if (!Array.isArray(services))
		return bad('its server entry has a services value that is not a list.');
	for (const s of services) {
		if (!isRecord(s) || typeof s.id !== 'string' || typeof s.resolve !== 'function') {
			return bad('every service needs an id and a resolve function.');
		}
		if (typeof s.title !== 'string') return bad(`service "${s.id}" needs a title.`);
	}

	const declared = (list: { id: string; slot?: string; scope?: string }[]) =>
		list.map((c) => `${c.id}:${c.slot ?? c.scope}`).sort();
	const got = declared(x.contributions as { id: string; slot: string }[]);
	const want = declared(m.wheelhouse.contributions);
	if (got.join() !== want.join()) {
		return bad(
			`its server entry contributes ${got.join(', ') || 'nothing'}, but its manifest declares ${want.join(', ') || 'nothing'}.`
		);
	}
	const gotS = declared(services as { id: string; scope: string }[]);
	const wantS = declared(m.wheelhouse.services);
	if (gotS.join() !== wantS.join()) {
		return bad(
			`its server entry has services ${gotS.join(', ') || 'none'}, but its manifest declares ${wantS.join(', ') || 'none'}.`
		);
	}

	const plugin: WheelhousePlugin = {
		...(x as unknown as WheelhousePlugin),
		apiVersion: m.wheelhouse.apiVersion,
		id: m.name,
		name: m.displayName,
		version: m.version,
		services: services as WheelhousePlugin['services']
	};
	delete plugin.enabledByDefault;
	delete plugin.enabledWhenFile;
	delete plugin.enabledWhenHomeFile;
	if (m.wheelhouse.enabledByDefault !== undefined) {
		plugin.enabledByDefault = m.wheelhouse.enabledByDefault;
	}
	if (m.wheelhouse.enabledWhenFile !== undefined) {
		plugin.enabledWhenFile = m.wheelhouse.enabledWhenFile;
	}
	if (m.wheelhouse.enabledWhenHomeFile !== undefined) {
		plugin.enabledWhenHomeFile = m.wheelhouse.enabledWhenHomeFile;
	}
	return { ok: true, plugin };
}
