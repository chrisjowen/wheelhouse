import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fold } from '../../chat/fold';
import { piExtensionSource, piScreen, piSnapshot } from './pi';

const SESSION = '11111111-1111-7111-8111-111111111111';
const AT = '2026-11-12T10:00:00.000Z';
let root: string;
let opts: Parameters<typeof piSnapshot>[0];
let file: string;
let receipt: Record<string, unknown>;
let entries: Record<string, unknown>[];
let shutdown: (() => void) | null;
const message = (id: string, parentId: string | null, value: Record<string, unknown>) => ({
	type: 'message',
	id,
	parentId,
	timestamp: AT,
	message: value
});
const save = () => {
	writeFileSync(
		file,
		[
			JSON.stringify({
				type: 'session',
				version: 3,
				id: SESSION,
				timestamp: AT,
				cwd: opts.firstmateDir
			}),
			...entries.map((entry) => JSON.stringify(entry)),
			''
		].join('\n')
	);
	writeFileSync(opts.hookFile, JSON.stringify(receipt));
};

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-pi-')));
	opts = {
		firstmateDir: path.join(root, 'repo'),
		hookFile: path.join(root, 'receipt.json'),
		sessionNonce: 'this-primary',
		agentDir: path.join(root, 'agent')
	};
	mkdirSync(opts.firstmateDir);
	mkdirSync(path.join(opts.agentDir, 'sessions', 'project'), { recursive: true });
	file = path.join(opts.agentDir, 'sessions', 'project', 'session.jsonl');
	receipt = {
		wheelhouse_nonce: opts.sessionNonce,
		session_id: SESSION,
		transcript_path: file,
		cwd: opts.firstmateDir,
		leaf_id: 'a1',
		busy: false
	};
	entries = [
		message('u1', null, { role: 'user', content: 'Check the tree' }),
		message('a1', 'u1', {
			role: 'assistant',
			content: [{ type: 'text', text: 'All clean.' }],
			stopReason: 'stop'
		})
	];
	shutdown = null;
	save();
});
afterEach(() => {
	shutdown?.();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe('piSnapshot', () => {
	it('shows native Pi messages in the existing conversation view', async () => {
		const snapshot = await piSnapshot(opts);
		expect(snapshot?.source).toEqual({ how: 'hook', file, truncated: false });
		const chat = fold(snapshot?.records ?? []);
		expect(chat.items).toMatchObject([
			{ kind: 'user', text: 'Check the tree' },
			{ kind: 'turn', done: true, parts: [{ kind: 'text', text: 'All clean.' }] }
		]);
	});
	it('walks the selected branch instead of showing abandoned descendants or the newest file entry', async () => {
		entries.push(
			message('abandoned', 'a1', { role: 'user', content: 'Abandoned path' }),
			message('branch', 'u1', {
				role: 'assistant',
				content: [{ type: 'text', text: 'Selected branch.' }],
				stopReason: 'stop'
			})
		);
		receipt.leaf_id = 'branch';
		save();
		const selected = await piSnapshot(opts);
		expect(JSON.stringify(selected?.records)).toContain('Selected branch.');
		expect(JSON.stringify(selected?.records)).not.toContain('Abandoned path');
		expect(JSON.stringify(selected?.records)).not.toContain('All clean.');
		receipt.leaf_id = 'u1';
		save();
		expect(fold((await piSnapshot(opts))?.records ?? []).items).toMatchObject([
			{ kind: 'user', text: 'Check the tree' }
		]);
	});
	it('accepts an explicitly reset empty branch without choosing another leaf', async () => {
		receipt.leaf_id = null;
		save();
		expect((await piSnapshot(opts))?.records).toEqual([]);
	});
	it.each(['missing', 'cycle'])('refuses %s active-branch links', async (problem) => {
		if (problem === 'missing') receipt.leaf_id = 'absent';
		else entries[0].parentId = 'a1';
		save();
		expect(await piSnapshot(opts)).toBeNull();
	});
	it('ignores system checkpoints and injected extension context', async () => {
		entries = [
			message('s1', null, { role: 'system', content: 'AGENTS instructions' }),
			{
				type: 'custom_message',
				id: 'c1',
				parentId: 's1',
				timestamp: AT,
				content: 'Injected reminder',
				display: false
			},
			message('u1', 'c1', { role: 'user', content: 'Hello' })
		];
		receipt.leaf_id = 'u1';
		save();
		expect(fold((await piSnapshot(opts))?.records ?? []).items).toMatchObject([
			{ kind: 'user', text: 'Hello' }
		]);
	});
	it('pairs native tool calls/results, translates built-in names and preserves failures', async () => {
		entries = [
			message('u1', null, { role: 'user', content: 'Inspect' }),
			message('a1', 'u1', {
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: 'not exposed' },
					{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: '/repo/main.ts' } }
				],
				stopReason: 'toolUse'
			}),
			message('t1', 'a1', {
				role: 'toolResult',
				toolCallId: 'tool-1',
				toolName: 'read',
				content: [{ type: 'text', text: 'missing' }],
				isError: true
			}),
			message('a2', 't1', {
				role: 'assistant',
				content: [{ type: 'text', text: 'File is missing' }],
				stopReason: 'stop'
			})
		];
		receipt.leaf_id = 'a2';
		save();
		const chat = fold((await piSnapshot(opts))?.records ?? []);
		expect(chat.items[1]).toMatchObject({
			kind: 'turn',
			done: true,
			parts: [
				{
					kind: 'activity',
					steps: [
						{ kind: 'thinking' },
						{
							kind: 'tool',
							name: 'Read',
							input: { file_path: '/repo/main.ts' },
							result: 'missing',
							isError: true
						}
					]
				},
				{ kind: 'text', text: 'File is missing' }
			]
		});
	});
	it('marks interrupted turns and displays provider errors', async () => {
		entries[1] = message('a1', 'u1', {
			role: 'assistant',
			content: [{ type: 'text', text: 'Partial reply' }],
			stopReason: 'aborted'
		});
		save();
		expect(fold((await piSnapshot(opts))?.records ?? []).items[1]).toMatchObject({
			interrupted: true,
			done: true
		});
		entries[1] = message('a1', 'u1', {
			role: 'assistant',
			content: [],
			stopReason: 'error',
			errorMessage: 'Provider unavailable'
		});
		save();
		expect(fold((await piSnapshot(opts))?.records ?? []).items[1]).toMatchObject({
			done: true,
			parts: [{ kind: 'text', text: 'Provider unavailable' }]
		});
	});
	it.each([undefined, null, '', 'stale-primary'])('rejects receipt nonce %j', async (nonce) => {
		receipt.wheelhouse_nonce = nonce;
		save();
		expect(await piSnapshot(opts)).toBeNull();
	});
	it('requires a nonce from the owned session', async () => {
		expect(await piSnapshot({ ...opts, sessionNonce: null })).toBeNull();
	});
	it('rejects UUID/cwd mismatches and transcript symlink escapes', async () => {
		receipt.session_id = 'another-session';
		save();
		expect(await piSnapshot(opts)).toBeNull();
		receipt.session_id = SESSION;
		receipt.cwd = root;
		save();
		expect(await piSnapshot(opts)).toBeNull();
		receipt.cwd = opts.firstmateDir;
		const outside = path.join(root, 'outside.jsonl');
		writeFileSync(outside, readFileSync(file));
		const link = path.join(opts.agentDir, 'sessions', 'escaped.jsonl');
		symlinkSync(outside, link);
		receipt.transcript_path = link;
		writeFileSync(opts.hookFile, JSON.stringify(receipt));
		expect(await piSnapshot(opts)).toBeNull();
	});
	it('holds back an incomplete last entry without losing the selected branch', async () => {
		writeFileSync(file, readFileSync(file, 'utf8') + '{"type":"message"');
		expect((await piSnapshot(opts))?.records).toHaveLength(3);
	});
	it('rejects oversized receipts', async () => {
		writeFileSync(opts.hookFile, ' '.repeat(65537));
		expect(await piSnapshot(opts)).toBeNull();
	});
});

const RULE = '─'.repeat(80);
const idle = [
	'Pi startup help: escape interrupt',
	RULE,
	'',
	RULE,
	'/tmp/project',
	'0.0%/1.0M (auto) gpt-4.1'
].join('\n');
describe('piScreen', () => {
	it('recognizes the actual Pi 1.5.2 empty editor without mistaking startup help for busy state', () => {
		expect(piScreen(idle)).toEqual({ kind: 'prompt', busy: false });
	});
	it('recognizes the native embedded working indicator', () => {
		expect(piScreen(idle.replace(RULE, '── ⠋ Working ' + '─'.repeat(60)))).toEqual({
			kind: 'prompt',
			busy: true
		});
	});
	it.each([
		null,
		'',
		idle.replace('\n\n' + RULE, '\nunsent prompt\n' + RULE),
		idle.replace(
			'\n\n' + RULE,
			'\nOnly showing models from configured providers.\n>\nEnter to select · Escape to cancel\n' +
				RULE
		),
		'quoted screen\n' + idle + '\nmore content\nmore\nmore\nmore\nmore'
	])('blocks unreadable, unsent and modal screens %j', (screen) => {
		expect(piScreen(screen).kind).toBe('blocked');
	});
});

describe('piExtensionSource', () => {
	it('records exact native session and leaf updates, then stops observing at shutdown', async () => {
		const extension = path.join(root, 'extension.mjs');
		writeFileSync(extension, piExtensionSource());
		vi.stubEnv('WH_SESSION_RECORD', opts.hookFile);
		vi.stubEnv('WH_SESSION_NONCE', opts.sessionNonce!);
		const handlers = new Map<string, (_event: unknown, context: unknown) => void>();
		const loaded = await import(/* @vite-ignore */ pathToFileURL(extension).href);
		loaded.default({
			on: (name: string, handler: (_event: unknown, ctx: unknown) => void) =>
				handlers.set(name, handler)
		});
		let leaf = 'a1';
		const ctx = {
			cwd: opts.firstmateDir,
			isIdle: () => true,
			sessionManager: {
				getSessionId: () => SESSION,
				getSessionFile: () => file,
				getLeafId: () => leaf
			}
		};
		handlers.get('session_start')?.({}, ctx);
		shutdown = () => handlers.get('session_shutdown')?.({}, ctx);
		expect(JSON.parse(readFileSync(opts.hookFile, 'utf8'))).toMatchObject({
			wheelhouse_nonce: 'this-primary',
			session_id: SESSION,
			leaf_id: 'a1',
			busy: false
		});
		leaf = 'u1';
		await vi.waitFor(
			() => expect(JSON.parse(readFileSync(opts.hookFile, 'utf8')).leaf_id).toBe('u1'),
			{ timeout: 2000 }
		);
		shutdown();
		leaf = 'a1';
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(JSON.parse(readFileSync(opts.hookFile, 'utf8')).leaf_id).toBe('u1');
	});
});
