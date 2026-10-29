/**
 * Reading what a page sends to install or update a plugin: an `org/repo`, a
 * ref, the commit a look-up showed, and settings by key as text. Each reader
 * gives the value or why it is not one.
 */

import { json } from '@sveltejs/kit';
import { NO_STORE } from '../http';

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9_./-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_VALUE = 4000;

export function readRepo(v: unknown): Read<string> {
	const t = typeof v === 'string' ? v.trim().replace(/\.git$/, '') : '';
	return REPO.test(t) && !t.startsWith('-')
		? { ok: true, value: t }
		: { ok: false, error: 'Give the repository as org/repo.' };
}

/** A tag, branch or commit; null (or nothing) for the default. */
export function readRef(v: unknown): Read<string | null> {
	if (v === undefined || v === null) return { ok: true, value: null };
	if (typeof v !== 'string') return { ok: false, error: 'The version must be text.' };
	const t = v.trim();
	if (!t) return { ok: true, value: null };
	return REF.test(t) && !t.startsWith('-')
		? { ok: true, value: t }
		: { ok: false, error: `"${t}" is not a tag, branch or commit.` };
}

export function readCommit(v: unknown): Read<string> {
	return typeof v === 'string' && COMMIT.test(v)
		? { ok: true, value: v }
		: { ok: false, error: 'Say which commit you looked at (look it up first).' };
}

export function readSettings(v: unknown): Read<Record<string, string>> {
	if (v === undefined || v === null) return { ok: true, value: {} };
	if (typeof v !== 'object' || Array.isArray(v)) {
		return { ok: false, error: 'Settings must be an object of values by key.' };
	}
	const out: Record<string, string> = {};
	for (const [k, x] of Object.entries(v)) {
		if (!SETTING_KEY.test(k)) return { ok: false, error: `"${k}" is not a setting key.` };
		if (typeof x !== 'string' || x.length > MAX_VALUE) {
			return { ok: false, error: `The value for ${k} must be text.` };
		}
		out[k] = x;
	}
	return { ok: true, value: out };
}

/** A refusal from the plugin commands ("x is not installed") as a sentence for a page. */
export const asSentence = (s: string) =>
	`${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}`;

/** The answer that refuses a request, with why. */
export const refuse = (message: string, status = 400) =>
	json({ message }, { status, headers: NO_STORE });
