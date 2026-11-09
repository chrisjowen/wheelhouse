/**
 * Firstmate asking the captain for a secret in the chat. A reply may hold a
 * fenced `vault-request` block naming the secret, why it is needed and,
 * optionally, the projects that should use it:
 *
 *     ```vault-request
 *     name: VERCEL_TOKEN
 *     purpose: Deploy lumen to production
 *     projects: lumen
 *     ```
 *
 * The chat shows the reply without the block and, under it, a card whose
 * button opens the Add a secret popup with the name, purpose and projects
 * filled in. Nothing happens until the captain clicks it, and the captain
 * types the value: a block never carries one. A block with any other line (a
 * `value:` above all), a bad name or project, or a repeated field is not a
 * request, and shows as the code block it is.
 *
 * Once the captain stores a secret from the chat, the chat sends Firstmate a
 * note naming it and the projects that can use it, never its value:
 *
 *     Stored secret VERCEL_TOKEN in the vault. lumen can use it.
 *
 * A request is shown as stored once such a note for its name follows it in
 * the conversation. Pure, so it is unit-tested.
 */
import { andList, PROJECT_ID, SECRET_NAME } from '../vault';
import type { BridgeMessage } from '../types';
import type { Item } from './fold';
import type { Pending } from './outbox';

/** What Firstmate asked for: a name, why, and the projects it suggests. */
export interface VaultRequest {
	name: string;
	/** Why Firstmate needs it, in its words; empty when it gave none. */
	purpose: string;
	/** Projects Firstmate suggests may use it, which the captain can change. */
	projects: string[];
}

/** A request in the conversation, and whether the captain has stored it since. */
export interface VaultAsk {
	request: VaultRequest;
	stored: boolean;
}

/** The longest purpose shown; a longer one is not a request. */
export const PURPOSE_MAX = 300;
const PROJECTS_MAX = 20;

const BLOCK = /^```vault-request[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/gm;
const STORED = /^Stored secret ([A-Za-z_][A-Za-z0-9_]{0,127}) in the vault\.(?: |$)/;

/** One block's lines as a request, or null when it is not one. */
export function parseRequest(body: string): VaultRequest | null {
	const fields = new Map<string, string>();
	for (const raw of body.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
		if (!m) return null;
		const key = m[1].toLowerCase();
		if (!['name', 'purpose', 'projects'].includes(key) || fields.has(key)) return null;
		fields.set(key, m[2].trim());
	}
	const name = fields.get('name') ?? '';
	if (!SECRET_NAME.test(name)) return null;
	const purpose = fields.get('purpose') ?? '';
	if (purpose.length > PURPOSE_MAX) return null;
	const projects = [
		...new Set(
			(fields.get('projects') ?? '')
				.split(/[\s,]+/)
				.map((p) => p.trim())
				.filter(Boolean)
		)
	];
	if (projects.length > PROJECTS_MAX || !projects.every((p) => PROJECT_ID.test(p))) return null;
	return { name, purpose, projects };
}

/**
 * A reply's requests, in order, and its words without their blocks. A block
 * that is not a request stays in the words, to show as ordinary text.
 */
export function vaultRequests(text: string): { words: string; requests: VaultRequest[] } {
	if (!text.includes('```vault-request')) return { words: text, requests: [] };
	const requests: VaultRequest[] = [];
	const words = text.replace(BLOCK, (block, body: string) => {
		const r = parseRequest(body);
		if (!r) return block;
		requests.push(r);
		return '';
	});
	return requests.length
		? { words: words.replace(/\n{3,}/g, '\n\n').trim(), requests }
		: { words: text, requests };
}

/** The note the chat sends Firstmate once a secret is stored: its name and who can use it. */
export function storedText(name: string, projects: string[]): string {
	const who = projects.length ? `${andList(projects)} can use it.` : 'No project can use it yet.';
	return `Stored secret ${name} in the vault. ${who}`;
}

/** The name a stored note names, or null when the message is not one. */
export function parseStored(text: string): string | null {
	return STORED.exec(text.trim())?.[1] ?? null;
}

/**
 * Every request Firstmate made in the conversation, by the id of the reply
 * part that makes it, each marked stored once a stored note for its name
 * follows it: in the transcript, in Wheelhouse's record of the notes it sent
 * to Firstmate's inbox (from when each was sent, unless its delivery failed),
 * or among the captain's messages still being sent, which come after
 * everything.
 */
export function vaultAsks(
	items: Item[],
	pending: Pick<Pending, 'text'>[] = [],
	inbox: Pick<BridgeMessage, 'text' | 'submittedAt' | 'delivery'>[] = []
): Map<string, VaultAsk[]> {
	const out = new Map<string, VaultAsk[]>();
	// Each request with when it was asked.
	const asked: [VaultAsk, number][] = [];
	const stored = (text: string, at = Infinity) => {
		const name = parseStored(text);
		if (!name) return;
		for (const [a, when] of asked) if (a.request.name === name && when < at) a.stored = true;
	};
	for (const it of items) {
		if (it.kind === 'user') stored(it.text);
		if (it.kind !== 'turn') continue;
		const at = Date.parse(it.at);
		for (const p of it.parts) {
			if (p.kind !== 'text') continue;
			const { requests } = vaultRequests(p.text);
			if (!requests.length) continue;
			const asks = requests.map((request) => ({ request, stored: false }));
			out.set(p.id, asks);
			asked.push(...asks.map((a): [VaultAsk, number] => [a, at]));
		}
	}
	for (const m of inbox) {
		if (m.delivery !== 'failed') stored(m.text, Date.parse(m.submittedAt));
	}
	for (const p of pending) stored(p.text);
	return out;
}
