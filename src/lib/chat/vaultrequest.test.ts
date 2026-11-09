import { describe, expect, it } from 'vitest';
import type { Item, Part } from './fold';
import { parseRequest, parseStored, storedText, vaultAsks, vaultRequests } from './vaultrequest';

const user = (id: string, text: string): Item => ({
	kind: 'user',
	id,
	text,
	at: '2026-11-09T09:00:00.000Z',
	queued: false,
	command: false
});
const turn = (id: string, parts: Part[], at = '2026-11-09T09:00:05.000Z'): Item => ({
	kind: 'turn',
	id,
	parts,
	at,
	durationMs: null,
	done: true,
	interrupted: false,
	trigger: 'captain'
});
const text = (id: string, t: string): Part => ({ kind: 'text', id, text: t });

const ASK = [
	'I need a deploy token to ship lumen.',
	'',
	'```vault-request',
	'name: VERCEL_TOKEN',
	'purpose: Deploy lumen to production',
	'projects: lumen, atlas',
	'```'
].join('\n');

describe('a vault-request block', () => {
	it('names a secret, why, and the projects to suggest', () => {
		expect(vaultRequests(ASK)).toEqual({
			words: 'I need a deploy token to ship lumen.',
			requests: [
				{
					name: 'VERCEL_TOKEN',
					purpose: 'Deploy lumen to production',
					projects: ['lumen', 'atlas']
				}
			]
		});
	});

	it('needs only a name, and may sit anywhere in a reply', () => {
		const t = 'Before.\n\n```vault-request\nname: NPM_TOKEN\n```\n\nAfter.';
		expect(vaultRequests(t)).toEqual({
			words: 'Before.\n\nAfter.',
			requests: [{ name: 'NPM_TOKEN', purpose: '', projects: [] }]
		});
	});

	it('takes several requests in one reply, in order', () => {
		const t = '```vault-request\nname: A\n```\n```vault-request\nname: B\n```';
		expect(vaultRequests(t).requests.map((r) => r.name)).toEqual(['A', 'B']);
		expect(vaultRequests(t).words).toBe('');
	});

	it('is ordinary text when it cannot be read, never a request', () => {
		for (const body of [
			// A block never carries a value.
			'name: VERCEL_TOKEN\nvalue: not-a-real-value',
			'name: 1BAD',
			'name: has space',
			'purpose: no name',
			'name: A\nname: B',
			'name: A\njust words',
			'name: A\nprojects: ../etc',
			`name: A\npurpose: ${'x'.repeat(301)}`
		]) {
			const t = `Words.\n\n\`\`\`vault-request\n${body}\n\`\`\``;
			expect(parseRequest(body), body).toBeNull();
			expect(vaultRequests(t), body).toEqual({ words: t, requests: [] });
		}
	});

	it('leaves other code blocks alone', () => {
		const t = '```sh\nwh-vault set VERCEL_TOKEN\n```';
		expect(vaultRequests(t)).toEqual({ words: t, requests: [] });
	});
});

describe('the stored note', () => {
	it('names the secret and who can use it, and reads back to its name', () => {
		expect(storedText('VERCEL_TOKEN', ['atlas', 'lumen'])).toBe(
			'Stored secret VERCEL_TOKEN in the vault. atlas and lumen can use it.'
		);
		expect(storedText('NPM_TOKEN', [])).toBe(
			'Stored secret NPM_TOKEN in the vault. No project can use it yet.'
		);
		expect(parseStored(storedText('NPM_TOKEN', []))).toBe('NPM_TOKEN');
		expect(parseStored('I stored secret X in the vault.')).toBeNull();
	});
});

describe('requests in the conversation', () => {
	it('are marked stored once a stored note for their name follows them', () => {
		const items = [
			turn('t1', [text('p1', ASK)], '2026-11-09T09:00:05.000Z'),
			user('u1', storedText('VERCEL_TOKEN', ['lumen']))
		];
		expect(vaultAsks(items).get('p1')).toEqual([
			{ request: expect.objectContaining({ name: 'VERCEL_TOKEN' }), stored: true }
		]);
		expect(vaultAsks(items.slice(0, 1)).get('p1')?.[0].stored).toBe(false);
	});

	it('an earlier note answers nothing, and a request asked again is open again', () => {
		const items = [
			user('u0', storedText('VERCEL_TOKEN', [])),
			turn('t1', [text('p1', ASK)]),
			user('u1', storedText('VERCEL_TOKEN', [])),
			turn('t2', [text('p2', ASK)], '2026-11-09T09:01:00.000Z')
		];
		const asks = vaultAsks(items);
		expect(asks.get('p1')?.[0].stored).toBe(true);
		expect(asks.get('p2')?.[0].stored).toBe(false);
	});

	it('counts a note still being sent, or one sent to the inbox after the request', () => {
		const items = [turn('t1', [text('p1', ASK)], '2026-11-09T09:00:05.000Z')];
		const note = storedText('VERCEL_TOKEN', []);
		expect(vaultAsks(items, [{ text: note }]).get('p1')?.[0].stored).toBe(true);
		const sent = (submittedAt: string, delivery: 'delivered' | 'failed' = 'delivered') => [
			{ text: note, submittedAt, delivery }
		];
		expect(vaultAsks(items, [], sent('2026-11-09T09:00:10.000Z')).get('p1')?.[0].stored).toBe(true);
		expect(vaultAsks(items, [], sent('2026-11-09T09:00:00.000Z')).get('p1')?.[0].stored).toBe(
			false
		);
		expect(
			vaultAsks(items, [], sent('2026-11-09T09:00:10.000Z', 'failed')).get('p1')?.[0].stored
		).toBe(false);
	});
});
