import type { SettingSpec, SettingValue } from './manifest';

/**
 * Gathering what a plugin needs to know: the settings its manifest declares
 * (`wheelhouse.settings`), asked of the captain at install, again at update for
 * any the new version adds, and all of them at `wheelhouse plugin configure`.
 * Answers given up front (`--setting key=value`) are not asked; with nobody to
 * ask (`--yes`), a setting takes the value it has, else its default, and a
 * required one with neither refuses. The answers go to the plugin's
 * `settings` in the plugins file, beside any the captain set by hand.
 */

/** Asks one question on the terminal; null when the terminal went away. */
export type Ask = (question: string) => Promise<string | null>;

type Settings = Record<string, unknown>;

export interface GatherOptions {
	/** What the plugins file holds for the plugin already. */
	current: Settings;
	/** Answers given up front, by key. */
	given: Record<string, string>;
	/** Asks the captain; null when nobody is asked. */
	ask: Ask | null;
	/** Ask about settings that already have a value too (configure), not only those that have none. */
	revisit: boolean;
	/** Said once, before the first question. */
	intro: string;
	log(line: string): void;
}

const ATTEMPTS = 3;
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** `key=value` pairs, as `--setting` takes them. */
export function parseGiven(
	pairs: string[]
): { ok: true; given: Record<string, string> } | { ok: false; error: string } {
	const given: Record<string, string> = {};
	for (const p of pairs) {
		const at = p.indexOf('=');
		if (at < 1) return { ok: false, error: `--setting "${p}" is not key=value` };
		given[p.slice(0, at).trim()] = p.slice(at + 1);
	}
	return { ok: true, given };
}

/** The value `text` stands for as this setting, or why it is not one. */
export function parseValue(
	spec: SettingSpec,
	text: string
): { ok: true; value: SettingValue } | { ok: false; error: string } {
	const t = text.trim();
	if (spec.type === 'number') {
		const n = Number(t);
		return t !== '' && Number.isFinite(n)
			? { ok: true, value: n }
			: { ok: false, error: `${spec.title} must be a number` };
	}
	if (spec.type === 'boolean') {
		if (/^(y|yes|true|on)$/i.test(t)) return { ok: true, value: true };
		if (/^(n|no|false|off)$/i.test(t)) return { ok: true, value: false };
		return { ok: false, error: `${spec.title} must be yes or no` };
	}
	return t ? { ok: true, value: t } : { ok: false, error: `${spec.title} must not be empty` };
}

const show = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : String(v));

function question(spec: SettingSpec, offered: unknown): string {
	const optional = spec.required ? '' : ' (optional)';
	const kind = spec.type === 'boolean' ? ' (y/n)' : '';
	const def = offered === undefined ? '' : ` [${show(offered)}]`;
	return `${spec.title}${optional}${kind}${def}: `;
}

/**
 * The plugin's settings after asking: the current ones, with each declared
 * setting answered, kept or defaulted; or why the plugin cannot have them.
 */
export async function gatherSettings(
	id: string,
	specs: SettingSpec[],
	o: GatherOptions
): Promise<{ ok: true; settings: Settings } | { ok: false; error: string }> {
	for (const k of Object.keys(o.given)) {
		if (!specs.some((s) => s.key === k)) {
			return { ok: false, error: `${id} has no setting "${k}"` };
		}
	}
	const settings: Settings = { ...o.current };
	let introduced = false;
	for (const spec of specs) {
		if (has(o.given, spec.key)) {
			const v = parseValue(spec, o.given[spec.key]);
			if (!v.ok) return { ok: false, error: `--setting ${spec.key}: ${v.error}` };
			settings[spec.key] = v.value;
			continue;
		}
		const held = has(o.current, spec.key);
		if (held && !o.revisit) continue;
		const offered = held ? o.current[spec.key] : spec.default;
		if (!o.ask) {
			if (offered !== undefined) settings[spec.key] = offered;
			else if (spec.required) {
				return {
					ok: false,
					error: `${id} needs ${spec.title}; pass --setting ${spec.key}=<value>`
				};
			}
			continue;
		}
		if (!introduced) {
			o.log(o.intro);
			introduced = true;
		}
		if (spec.description) o.log(`  ${spec.description}`);
		let answered = false;
		for (let i = 0; i < ATTEMPTS && !answered; i++) {
			const a = await o.ask(question(spec, offered));
			if (a === null) return { ok: false, error: `stopped before ${spec.title} was answered` };
			if (!a.trim()) {
				if (offered !== undefined) {
					settings[spec.key] = offered;
					answered = true;
				} else if (!spec.required) answered = true;
				else o.log(`  ${spec.title} is needed.`);
				continue;
			}
			const v = parseValue(spec, a);
			if (v.ok) {
				settings[spec.key] = v.value;
				answered = true;
			} else o.log(`  ${v.error}.`);
		}
		if (!answered) return { ok: false, error: `${id} needs ${spec.title}` };
	}
	return { ok: true, settings };
}
