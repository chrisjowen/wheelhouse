import { parseDocument } from 'yaml';
import { EVIDENCE_WORDS, FACT_WORDS, OUTCOMES } from '../../passage-meta';
import type { Track } from '../../types';

/**
 * The passage file format (`.wheelhouse.yaml`, version 1) and its validator.
 *
 * A passage is data in two parts: checks gather observations, and stages are
 * rules over them. Conditions are references (a Firstmate fact such as
 * `pr.recorded`, or `<check>.<outcome>` such as `production.success`)
 * combined with `all`, `any` and `not`, plus `{ mode: … }` and `{ yolo: … }`
 * predicates. There is no expression language and no templating: check
 * parameters that name a commit take one of Wheelhouse's own values
 * (`merge.commit`, `pr.head`), which Wheelhouse validates and places itself.
 *
 * Two kinds of file share this schema:
 * - a base passage (`id: ship` or `id: scout`): Wheelhouse's built-ins only;
 * - an overlay (`extends: ship` or `extends: scout`): a project's
 *   `.wheelhouse.yaml` or a captain-owned file, which adds checks and steps
 *   and may restyle built-in steps, but never changes when a built-in step is
 *   reached.
 * Validation is strict: unknown fields, types, references and outcomes are
 * errors, reported with where they are.
 */

export type Cond =
	| string
	| { all: Cond[] }
	| { any: Cond[] }
	| { not: Cond }
	| { mode: string }
	| { yolo: 'on' | 'off' };

export type Note = string | { when: Cond; text: string };

/** Values Wheelhouse supplies to checks; each is validated before use. */
export type CommitValue = 'merge.commit' | 'pr.head';

interface CheckCommon {
	/** A plain name for evidence blocks and links. */
	label?: string;
	/** How often to run it, e.g. `60s`, `5m` (minimum 30 s). */
	interval?: string;
}

export type CheckSpec = CheckCommon &
	(
		| {
				type: 'github.deployment';
				environment: string;
				ref: CommitValue;
				/** owner/name; defaults to the task's PR repository, else the project clone's origin. */
				repo?: string;
		  }
		| { type: 'github.workflow'; workflow: string; ref: CommitValue; event?: string; repo?: string }
		| { type: 'github.release'; contains: CommitValue; tag_pattern?: string; repo?: string }
		| { type: 'npm.published'; package: string; version_from: string }
		| {
				type: 'http';
				url: string;
				method?: 'GET' | 'HEAD';
				expect?: { status?: number; json_pointer?: string; equals?: string };
				/** Request headers whose values come from named environment variables (captain config only). */
				headers_from_env?: Record<string, string>;
		  }
		| {
				type: 'git.contains';
				repo: 'firstmate-root' | 'project-clone';
				/** The ref that should contain the commit (default: the clone's default branch, or HEAD for firstmate-root). */
				ref?: string;
				commit: CommitValue;
		  }
		| { type: 'status.note'; prefix: 'preview' }
		| {
				type: 'command';
				/** The program and its arguments, run directly (never through a shell). */
				run: string[];
				/** The working directory, relative to the project clone (default: its top). */
				cwd?: string;
				/** How long it may run, e.g. `5m` (default 5m, at most 60m). */
				timeout?: string;
				/** Names of environment variables passed through from Wheelhouse's own environment. */
				env?: string[];
				/** Wait for this commit and run once per commit. */
				ref?: CommitValue;
		  }
	);

export type CheckType = CheckSpec['type'];

export interface StageSpec {
	id: string;
	label?: string;
	short?: string;
	/** A new step goes after this step (default: at the end). */
	after?: string;
	/** The chart column this step lines up with (default: its own id). */
	column?: string;
	reached_when?: Cond;
	skip_when?: Cond;
	skip_note?: string;
	failed_when?: Cond;
	evidence?: string[];
	/** `<check>.url`: the check's URL becomes the task's primary link while this step is current. */
	primary_link?: string;
	/** Stop checking after this long (from landing, else from the first check), e.g. `24h`. */
	give_up_after?: string;
	note?: Note;
}

export interface PassageFile {
	version: 1;
	/** Base passages only. */
	id?: Track;
	/** Overlays only. */
	extends?: Track;
	/** Captain-owned files may name their project; it must match. */
	project?: string;
	checks: Record<string, CheckSpec>;
	stages: StageSpec[];
	headline?: { live?: string };
}

/** Outcomes each check type can report, usable as `<check>.<outcome>`. */
export const CHECK_OUTCOMES: Record<CheckType, readonly string[]> = OUTCOMES;

/** Check types that reach the network; a project file's ones run only once the captain enables it. */
export const NETWORK_CHECKS: ReadonlySet<CheckType> = new Set([
	'github.deployment',
	'github.workflow',
	'github.release',
	'npm.published',
	'http'
]);

/** Check types that run a local program; they run only once the captain allows them for the project. */
export const COMMAND_CHECKS: ReadonlySet<CheckType> = new Set(['command']);

/** Firstmate facts a condition may reference. */
export const FACTS: Record<string, string> = FACT_WORDS;

/** Evidence blocks every passage can show (the task page renders them). */
export const EVIDENCE_KINDS: readonly string[] = Object.keys(EVIDENCE_WORDS);

/** Check ids that would shadow a fact's prefix. */
const RESERVED_CHECK_IDS = new Set([
	'task',
	'backlog',
	'nm',
	'pr',
	'crew',
	'merged',
	'hold',
	'report',
	'merge',
	'mode',
	'yolo',
	'check'
]);

export const ID = /^[a-z][a-z0-9-]{0,39}$/;
const DURATION = /^(\d{1,6})(s|m|h|d)$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
/** A git ref Wheelhouse will pass to git: no option-like or range syntax. */
export const GIT_REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
/** npm package names, scoped or not. */
const NPM_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,213}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 24 * 3600_000;
const MIN_TIMEOUT_MS = 1000;
/** The longest a command check may run. */
export const MAX_COMMAND_TIMEOUT_MS = 60 * 60_000;
const MAX_ARGS = 32;
const MAX_ENV = 20;
/** A working directory below the project clone: `.`, or relative segments with no `.` or `..`. */
export function isRelDir(v: string): boolean {
	if (v === '.') return true;
	return v
		.split('/')
		.every((seg) => /^[A-Za-z0-9._@+-]{1,100}$/.test(seg) && seg !== '.' && seg !== '..');
}
const MAX_GIVE_UP_MS = 90 * 24 * 3600_000;
/** The largest passage file Wheelhouse reads. */
export const MAX_FILE_BYTES = 64 * 1024;
const MAX_STAGES = 24;
const MAX_CHECKS = 16;
const MAX_COND_DEPTH = 8;

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 };

export function durationMs(text: string): number | null {
	const m = DURATION.exec(text);
	return m ? Number(m[1]) * UNITS[m[2]] : null;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface ValidateOptions {
	/** Base passages are Wheelhouse's own; files are overlays. */
	kind: 'base' | 'overlay';
	/** Captain-owned files may set http credentials from named environment variables. */
	captain?: boolean;
	/** The project the file is for (captain files that name one must match). */
	project?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

class Problems {
	list: string[] = [];
	add(where: string, message: string) {
		if (this.list.length < 50) this.list.push(where ? `${where}: ${message}` : message);
	}
}

function fields(
	p: Problems,
	where: string,
	o: Record<string, unknown>,
	allowed: readonly string[]
): void {
	for (const k of Object.keys(o)) {
		if (!allowed.includes(k)) p.add(where, `unknown field '${k}'`);
	}
}

function str(
	p: Problems,
	where: string,
	v: unknown,
	opts: { required?: boolean; max?: number; pattern?: RegExp; what?: string } = {}
): string | undefined {
	if (v === undefined || v === null) {
		if (opts.required) p.add(where, 'is required');
		return undefined;
	}
	if (typeof v !== 'string' || !v.trim()) {
		p.add(where, 'must be a non-empty string');
		return undefined;
	}
	if (v.length > (opts.max ?? 200)) {
		p.add(where, `is longer than ${opts.max ?? 200} characters`);
		return undefined;
	}
	if (opts.pattern && !opts.pattern.test(v)) {
		p.add(where, `'${v}' is not a valid ${opts.what ?? 'value'}`);
		return undefined;
	}
	return v;
}

function oneOf<T extends string>(
	p: Problems,
	where: string,
	v: unknown,
	options: readonly T[],
	required = true
): T | undefined {
	if (v === undefined || v === null) {
		if (required) p.add(where, `is required (one of ${options.join(', ')})`);
		return undefined;
	}
	if (typeof v !== 'string' || !options.includes(v as T)) {
		p.add(where, `must be one of ${options.join(', ')}`);
		return undefined;
	}
	return v as T;
}

function duration(
	p: Problems,
	where: string,
	v: unknown,
	min: number,
	max: number
): string | undefined {
	if (v === undefined) return undefined;
	const ms = typeof v === 'string' ? durationMs(v) : null;
	if (ms === null) {
		p.add(where, 'must be a duration such as 30s, 5m, 2h or 7d');
		return undefined;
	}
	if (ms < min || ms > max) {
		p.add(where, `must be between ${spoken(min)} and ${spoken(max)}`);
		return undefined;
	}
	return v as string;
}

/** A duration bound in words: 30 s, 60 minutes, 1 day, 90 days. */
function spoken(ms: number): string {
	const [n, unit] =
		ms % 86_400_000 === 0
			? [ms / 86_400_000, 'day']
			: ms % 60_000 === 0 && ms >= 60_000
				? [ms / 60_000, 'minute']
				: [ms / 1000, 's'];
	return unit === 's' ? `${n} s` : `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Validate a condition's shape (references are checked later, against the resolved passage). */
function cond(p: Problems, where: string, v: unknown, depth = 0): Cond | undefined {
	if (depth > MAX_COND_DEPTH) {
		p.add(where, 'is nested too deeply');
		return undefined;
	}
	if (typeof v === 'string') {
		if (!/^[a-z][a-z0-9-]*\.[a-z_]+$|^merged$/.test(v)) {
			p.add(
				where,
				`'${v}' is not a reference (use a fact such as pr.recorded, or <check>.<outcome>)`
			);
			return undefined;
		}
		return v;
	}
	if (!isObject(v)) {
		p.add(where, 'must be a reference or one of all, any, not, mode, yolo');
		return undefined;
	}
	const keys = Object.keys(v);
	if (keys.length !== 1) {
		p.add(where, 'must have exactly one of all, any, not, mode, yolo');
		return undefined;
	}
	const [k] = keys;
	const inner = v[k];
	switch (k) {
		case 'all':
		case 'any': {
			if (!Array.isArray(inner) || inner.length === 0) {
				p.add(`${where}.${k}`, 'must be a non-empty list');
				return undefined;
			}
			const items = inner.map((c, i) => cond(p, `${where}.${k}[${i}]`, c, depth + 1));
			if (items.some((c) => c === undefined)) return undefined;
			return k === 'all' ? { all: items as Cond[] } : { any: items as Cond[] };
		}
		case 'not': {
			const c = cond(p, `${where}.not`, inner, depth + 1);
			return c === undefined ? undefined : { not: c };
		}
		case 'mode': {
			const m = str(p, `${where}.mode`, inner, {
				required: true,
				max: 40,
				pattern: /^[A-Za-z][A-Za-z_ -]*$/,
				what: 'delivery mode'
			});
			return m === undefined ? undefined : { mode: m };
		}
		case 'yolo': {
			const y = oneOf(p, `${where}.yolo`, inner, ['on', 'off'] as const);
			return y === undefined ? undefined : { yolo: y };
		}
		default:
			p.add(where, `unknown condition '${k}' (use all, any, not, mode or yolo)`);
			return undefined;
	}
}

function note(p: Problems, where: string, v: unknown): Note | undefined {
	if (v === undefined) return undefined;
	if (typeof v === 'string') return str(p, where, v, { max: 1000 });
	if (!isObject(v)) {
		p.add(where, 'must be text, or { when, text }');
		return undefined;
	}
	fields(p, where, v, ['when', 'text']);
	const when = cond(p, `${where}.when`, v.when);
	const text = str(p, `${where}.text`, v.text, { required: true, max: 1000 });
	return when !== undefined && text !== undefined ? { when, text } : undefined;
}

const COMMIT_VALUES = ['merge.commit', 'pr.head'] as const;

function check(
	p: Problems,
	where: string,
	v: unknown,
	opts: ValidateOptions
): CheckSpec | undefined {
	if (!isObject(v)) {
		p.add(where, 'must be a mapping with a type');
		return undefined;
	}
	const before = p.list.length;
	const common = ['type', 'label', 'interval'];
	const label = str(p, `${where}.label`, v.label, { max: 80 });
	const interval = duration(p, `${where}.interval`, v.interval, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
	const base = {
		...(label !== undefined ? { label } : {}),
		...(interval !== undefined ? { interval } : {})
	};
	const repo = () =>
		str(p, `${where}.repo`, v.repo, { pattern: REPO, what: 'owner/name repository' });
	let spec: CheckSpec | undefined;
	switch (v.type) {
		case 'github.deployment': {
			fields(p, where, v, [...common, 'environment', 'ref', 'repo']);
			const environment = str(p, `${where}.environment`, v.environment, {
				required: true,
				max: 100
			});
			const ref = oneOf(p, `${where}.ref`, v.ref, COMMIT_VALUES);
			const r = repo();
			if (environment && ref)
				spec = { ...base, type: v.type, environment, ref, ...(r ? { repo: r } : {}) };
			break;
		}
		case 'github.workflow': {
			fields(p, where, v, [...common, 'workflow', 'ref', 'event', 'repo']);
			const workflow = str(p, `${where}.workflow`, v.workflow, {
				required: true,
				max: 100,
				pattern: /^[A-Za-z0-9._-]+$/,
				what: 'workflow file name or id'
			});
			const ref = oneOf(p, `${where}.ref`, v.ref, COMMIT_VALUES);
			const event = str(p, `${where}.event`, v.event, {
				max: 40,
				pattern: /^[a-z_]+$/,
				what: 'event name'
			});
			const r = repo();
			if (workflow && ref) {
				spec = {
					...base,
					type: v.type,
					workflow,
					ref,
					...(event ? { event } : {}),
					...(r ? { repo: r } : {})
				};
			}
			break;
		}
		case 'github.release': {
			fields(p, where, v, [...common, 'contains', 'tag_pattern', 'repo']);
			const contains = oneOf(p, `${where}.contains`, v.contains, COMMIT_VALUES);
			const tag = str(p, `${where}.tag_pattern`, v.tag_pattern, {
				max: 100,
				pattern: /^[A-Za-z0-9._*/-]+$/,
				what: 'tag pattern (letters, digits, . _ - / and *)'
			});
			const r = repo();
			if (contains)
				spec = {
					...base,
					type: v.type,
					contains,
					...(tag ? { tag_pattern: tag } : {}),
					...(r ? { repo: r } : {})
				};
			break;
		}
		case 'npm.published': {
			fields(p, where, v, [...common, 'package', 'version_from']);
			const pkg = str(p, `${where}.package`, v.package, {
				required: true,
				max: 214,
				pattern: NPM_PACKAGE,
				what: 'npm package name'
			});
			const from = str(p, `${where}.version_from`, v.version_from, {
				required: true,
				pattern: ID,
				what: 'check id'
			});
			if (pkg && from) spec = { ...base, type: v.type, package: pkg, version_from: from };
			break;
		}
		case 'http': {
			fields(p, where, v, [...common, 'url', 'method', 'expect', 'headers_from_env']);
			const url = str(p, `${where}.url`, v.url, { required: true, max: 2000 });
			if (url !== undefined) {
				let ok = false;
				try {
					const u = new URL(url);
					ok = (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
				} catch {
					ok = false;
				}
				if (!ok) p.add(`${where}.url`, 'must be an http(s) URL without credentials');
			}
			const method = oneOf(p, `${where}.method`, v.method, ['GET', 'HEAD'] as const, false);
			let expect: { status?: number; json_pointer?: string; equals?: string } | undefined;
			if (v.expect !== undefined) {
				if (!isObject(v.expect)) p.add(`${where}.expect`, 'must be a mapping');
				else {
					fields(p, `${where}.expect`, v.expect, ['status', 'json_pointer', 'equals']);
					const e = v.expect;
					expect = {};
					if (e.status !== undefined) {
						if (
							typeof e.status !== 'number' ||
							!Number.isInteger(e.status) ||
							e.status < 100 ||
							e.status > 599
						) {
							p.add(`${where}.expect.status`, 'must be an HTTP status code');
						} else expect.status = e.status;
					}
					const ptr = str(p, `${where}.expect.json_pointer`, e.json_pointer, {
						max: 200,
						pattern: /^(\/[^/]*)+$/,
						what: 'JSON pointer'
					});
					if (ptr) expect.json_pointer = ptr;
					const eq = e.equals;
					if (eq !== undefined) {
						if (typeof eq === 'string' || typeof eq === 'number' || typeof eq === 'boolean') {
							expect.equals = String(eq);
						} else
							p.add(
								`${where}.expect.equals`,
								'must be merge.commit, pr.head, task.id or a literal'
							);
					}
					if (expect.equals !== undefined && !expect.json_pointer) {
						p.add(`${where}.expect.equals`, 'needs a json_pointer to compare');
					}
					if (method === 'HEAD' && expect.json_pointer) {
						p.add(`${where}.expect.json_pointer`, 'cannot be read from a HEAD request');
					}
				}
			}
			let headers: Record<string, string> | undefined;
			if (v.headers_from_env !== undefined) {
				if (!opts.captain) {
					p.add(
						`${where}.headers_from_env`,
						'is allowed only in the captain-owned Wheelhouse config'
					);
				} else if (!isObject(v.headers_from_env)) {
					p.add(`${where}.headers_from_env`, 'must map header names to environment variable names');
				} else {
					headers = {};
					for (const [h, env] of Object.entries(v.headers_from_env)) {
						if (!HEADER_NAME.test(h))
							p.add(`${where}.headers_from_env`, `'${h}' is not a header name`);
						else if (typeof env !== 'string' || !ENV_NAME.test(env)) {
							p.add(`${where}.headers_from_env.${h}`, 'must name an environment variable');
						} else headers[h] = env;
					}
				}
			}
			if (url) {
				spec = {
					...base,
					type: 'http',
					url,
					...(method ? { method } : {}),
					...(expect ? { expect } : {}),
					...(headers ? { headers_from_env: headers } : {})
				};
			}
			break;
		}
		case 'git.contains': {
			fields(p, where, v, [...common, 'repo', 'ref', 'commit']);
			const r = oneOf(p, `${where}.repo`, v.repo, ['firstmate-root', 'project-clone'] as const);
			const ref = str(p, `${where}.ref`, v.ref, { max: 200, pattern: GIT_REF, what: 'git ref' });
			const commit = oneOf(p, `${where}.commit`, v.commit, COMMIT_VALUES);
			if (r && commit) spec = { ...base, type: v.type, repo: r, commit, ...(ref ? { ref } : {}) };
			break;
		}
		case 'status.note': {
			fields(p, where, v, [...common, 'prefix']);
			const prefix = oneOf(p, `${where}.prefix`, v.prefix, ['preview'] as const);
			if (prefix) spec = { ...base, type: v.type, prefix };
			break;
		}
		case 'command': {
			fields(p, where, v, [...common, 'run', 'cwd', 'timeout', 'env', 'ref']);
			let run: string[] | undefined;
			if (v.run === undefined)
				p.add(`${where}.run`, 'is required (the program and its arguments, as a list)');
			else if (typeof v.run === 'string') {
				p.add(
					`${where}.run`,
					'must be a list such as [pnpm, deploy:local], not one string: commands never run through a shell'
				);
			} else if (!Array.isArray(v.run) || v.run.length === 0) {
				p.add(`${where}.run`, 'must be a non-empty list of the program and its arguments');
			} else if (v.run.length > MAX_ARGS) {
				p.add(`${where}.run`, `has more than ${MAX_ARGS} items`);
			} else if (v.run.some((a) => typeof a !== 'string' || a.length > 1000 || a.includes('\0'))) {
				p.add(`${where}.run`, 'items must be text (at most 1000 characters each)');
			} else if (!(v.run[0] as string).trim()) {
				p.add(`${where}.run`, 'must start with a program name');
			} else run = [...(v.run as string[])];
			const cwd = str(p, `${where}.cwd`, v.cwd, { max: 200 });
			if (cwd !== undefined && !isRelDir(cwd)) {
				p.add(`${where}.cwd`, `'${cwd}' is not a folder inside the project (relative, without ..)`);
			}
			const timeout = duration(
				p,
				`${where}.timeout`,
				v.timeout,
				MIN_TIMEOUT_MS,
				MAX_COMMAND_TIMEOUT_MS
			);
			let env: string[] | undefined;
			if (v.env !== undefined) {
				if (
					!Array.isArray(v.env) ||
					v.env.some((e) => typeof e !== 'string' || !ENV_NAME.test(e))
				) {
					p.add(
						`${where}.env`,
						'must be a list of environment variable names, such as [KUBECONFIG]'
					);
				} else if (v.env.length > MAX_ENV)
					p.add(`${where}.env`, `lists more than ${MAX_ENV} names`);
				else env = [...new Set(v.env as string[])];
			}
			const ref = oneOf(p, `${where}.ref`, v.ref, COMMIT_VALUES, false);
			if (run) {
				spec = {
					...base,
					type: 'command',
					run,
					...(cwd && isRelDir(cwd) ? { cwd } : {}),
					...(timeout ? { timeout } : {}),
					...(env ? { env } : {}),
					...(ref ? { ref } : {})
				};
			}
			break;
		}
		case undefined:
			p.add(`${where}.type`, 'is required');
			return undefined;
		default:
			p.add(
				`${where}.type`,
				`unknown check type '${String(v.type)}' (use ${Object.keys(CHECK_OUTCOMES).join(', ')})`
			);
			return undefined;
	}
	return p.list.length === before ? spec : undefined;
}

const STAGE_FIELDS = [
	'id',
	'label',
	'short',
	'after',
	'column',
	'reached_when',
	'skip_when',
	'skip_note',
	'failed_when',
	'evidence',
	'primary_link',
	'give_up_after',
	'note'
] as const;

function stage(p: Problems, where: string, v: unknown): StageSpec | undefined {
	if (!isObject(v)) {
		p.add(where, 'must be a mapping with an id');
		return undefined;
	}
	fields(p, where, v, STAGE_FIELDS);
	const id = str(p, `${where}.id`, v.id, {
		required: true,
		pattern: ID,
		what: 'step id (lower-case letters, digits and -)'
	});
	const at = id ?? where;
	const s: StageSpec = { id: id ?? '' };
	const set = <K extends keyof StageSpec>(k: K, val: StageSpec[K] | undefined) => {
		if (val !== undefined) s[k] = val;
	};
	set('label', str(p, `${at}.label`, v.label, { max: 60 }));
	set('short', str(p, `${at}.short`, v.short, { max: 20 }));
	set('after', str(p, `${at}.after`, v.after, { pattern: ID, what: 'step id' }));
	set('column', str(p, `${at}.column`, v.column, { pattern: ID, what: 'step id' }));
	if (v.reached_when !== undefined)
		set('reached_when', cond(p, `${at}.reached_when`, v.reached_when));
	if (v.skip_when !== undefined) set('skip_when', cond(p, `${at}.skip_when`, v.skip_when));
	set('skip_note', str(p, `${at}.skip_note`, v.skip_note, { max: 300 }));
	if (v.failed_when !== undefined) set('failed_when', cond(p, `${at}.failed_when`, v.failed_when));
	if (v.evidence !== undefined) {
		if (!Array.isArray(v.evidence) || v.evidence.some((e) => typeof e !== 'string')) {
			p.add(`${at}.evidence`, 'must be a list of evidence names');
		} else if (v.evidence.length > 12) {
			p.add(`${at}.evidence`, 'lists more than 12 blocks');
		} else s.evidence = [...v.evidence];
	}
	set(
		'primary_link',
		str(p, `${at}.primary_link`, v.primary_link, {
			pattern: /^[a-z][a-z0-9-]*\.url$/,
			what: 'link (use <check>.url)'
		})
	);
	set('give_up_after', duration(p, `${at}.give_up_after`, v.give_up_after, 60_000, MAX_GIVE_UP_MS));
	set('note', note(p, `${at}.note`, v.note));
	return id ? s : undefined;
}

/** Validate a parsed passage document (shape only; references are checked on resolution). */
export function validatePassage(doc: unknown, opts: ValidateOptions): Validated<PassageFile> {
	const p = new Problems();
	if (!isObject(doc)) return { ok: false, errors: ['the file must be a YAML mapping'] };
	fields(p, '', doc, ['version', 'id', 'extends', 'project', 'checks', 'stages', 'headline']);
	if (doc.version !== 1) p.add('version', 'must be 1');
	const out: PassageFile = { version: 1, checks: {}, stages: [] };
	if (opts.kind === 'base') {
		const id = oneOf(p, 'id', doc.id, ['ship', 'scout'] as const);
		if (id) out.id = id;
		if (doc.extends !== undefined)
			p.add('extends', 'is only for passage files, not built-in passages');
	} else {
		if (doc.id !== undefined)
			p.add('id', 'is only for built-in passages; use extends: ship or extends: scout');
		out.extends = oneOf(p, 'extends', doc.extends ?? 'ship', ['ship', 'scout'] as const) ?? 'ship';
	}
	if (doc.project !== undefined) {
		const project = str(p, 'project', doc.project, { max: 128 });
		if (project && opts.project && project !== opts.project) {
			p.add('project', `names '${project}', but this file is for '${opts.project}'`);
		} else if (project) out.project = project;
	}
	if (doc.checks !== undefined) {
		if (!isObject(doc.checks)) p.add('checks', 'must map check ids to checks');
		else {
			const ids = Object.keys(doc.checks);
			if (ids.length > MAX_CHECKS) p.add('checks', `declares more than ${MAX_CHECKS} checks`);
			for (const id of ids) {
				if (!ID.test(id)) {
					p.add(`checks.${id}`, 'is not a valid check id (lower-case letters, digits and -)');
					continue;
				}
				if (RESERVED_CHECK_IDS.has(id)) {
					p.add(`checks.${id}`, `'${id}' is reserved for Firstmate facts`);
					continue;
				}
				const c = check(p, `checks.${id}`, doc.checks[id], opts);
				if (c) out.checks[id] = c;
			}
		}
	}
	if (doc.stages !== undefined) {
		if (!Array.isArray(doc.stages)) p.add('stages', 'must be a list of steps');
		else if (doc.stages.length > MAX_STAGES) p.add('stages', `lists more than ${MAX_STAGES} steps`);
		else {
			const seen = new Set<string>();
			doc.stages.forEach((s, i) => {
				const v = stage(p, `stages[${i}]`, s);
				if (!v) return;
				if (seen.has(v.id)) p.add(v.id, 'is listed twice');
				seen.add(v.id);
				out.stages.push(v);
			});
		}
	}
	if (doc.headline !== undefined) {
		if (!isObject(doc.headline)) p.add('headline', 'must be a mapping');
		else {
			fields(p, 'headline', doc.headline, ['live']);
			const live = str(p, 'headline.live', doc.headline.live, { pattern: ID, what: 'step id' });
			out.headline = live ? { live } : {};
		}
	}
	return p.list.length ? { ok: false, errors: p.list } : { ok: true, value: out };
}

/** Parse and validate YAML text. Aliases, custom tags and oversized files are refused. */
export function parsePassage(text: string, opts: ValidateOptions): Validated<PassageFile> {
	if (Buffer.byteLength(text) > MAX_FILE_BYTES) {
		return { ok: false, errors: [`the file is larger than ${MAX_FILE_BYTES / 1024} KiB`] };
	}
	const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true });
	if (doc.errors.length) {
		return {
			ok: false,
			errors: doc.errors.slice(0, 5).map((e) => `YAML: ${e.message.split('\n')[0]}`)
		};
	}
	let value: unknown;
	try {
		value = doc.toJS({ maxAliasCount: 0 });
	} catch (e) {
		return { ok: false, errors: [`YAML: ${(e as Error).message.split('\n')[0]}`] };
	}
	return validatePassage(value, opts);
}

/** Every reference a condition makes. */
export function refsOf(c: Cond | undefined): string[] {
	if (c === undefined) return [];
	if (typeof c === 'string') return [c];
	if ('all' in c) return c.all.flatMap(refsOf);
	if ('any' in c) return c.any.flatMap(refsOf);
	if ('not' in c) return refsOf(c.not);
	return [];
}

/** A condition in plain words, for the passage panel and the basis line. */
export function describeCond(c: Cond): string {
	if (typeof c === 'string') return c;
	if ('all' in c) return c.all.map((x) => wrap(x)).join(' and ');
	if ('any' in c) return c.any.map((x) => wrap(x)).join(' or ');
	if ('not' in c) return `not ${wrap(c.not)}`;
	if ('mode' in c) return `mode is ${c.mode}`;
	return `yolo is ${c.yolo}`;
}

const wrap = (c: Cond) =>
	typeof c === 'string' || 'mode' in c || 'yolo' in c ? describeCond(c) : `(${describeCond(c)})`;
