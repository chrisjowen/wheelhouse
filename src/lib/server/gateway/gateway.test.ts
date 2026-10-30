import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alertsFor, raise, sessionAlert } from '../../bell';
import {
	answerOf,
	answerText,
	optionsFor,
	picksLine,
	type InboxCard,
	type InboxView,
	type Picks
} from '../../inbox';
import type { FleetView, ShipAlert } from '../../types';
import { fleetOf, prGreen, taskSummary } from '../../../../tests/helpers/task-summary';
import type { BellEvent } from '../bell/bell';
import type { FirstmateAdapter } from '../firstmate/adapter';
import { INBOX_NOTE_SCHEMA, INBOX_RECEIPTS_SCHEMA } from '../firstmate/contracts';
import { Messenger, validateSend } from '../store/messenger';
import { MessageStore } from '../store/store';
import type {
	ButtonEvent,
	ChannelAdapter,
	ChannelHealth,
	InboundEvent,
	OutboundMessage,
	Peer,
	SentRef
} from './adapter';
import { Gateway, RATE_PER_MINUTE } from './gateway';
import { AuditLog, GatewayRecord } from './record';
import { GatewaySettings } from './settings';

/**
 * The gateway core against a fake channel: a real Messenger and message
 * store over an in-memory Firstmate inbox, a bell the test rings by hand, and
 * a Decisions inbox whose cards read their answers back from the messages,
 * as the real one does.
 */

const TOKEN = 'fake-bot-token.for-wheelhouse-tests.not-a-real-discord-token';
const CAPTAIN = '111111111111111111';
const STRANGER = '222222222222222222';

class FakeChannel implements ChannelAdapter {
	readonly channel = 'discord' as const;
	readonly limits = { text: 2000, buttons: 5 };
	sent: { to: Peer; m: OutboundMessage; ref: SentRef }[] = [];
	updates: { ref: SentRef; m: OutboundMessage }[] = [];
	reactions: { ref: SentRef; emoji: string }[] = [];
	acks: { id: string; text?: string }[] = [];
	running = false;
	private sink: ((e: InboundEvent) => void) | null = null;
	private n = 0;
	state: ChannelHealth['state'] = 'connected';

	async run(sink: (e: InboundEvent) => void, signal: AbortSignal): Promise<void> {
		this.sink = sink;
		this.running = true;
		await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
		this.running = false;
	}
	async send(to: Peer, m: OutboundMessage): Promise<SentRef> {
		const ref = { chat: to.dm ?? `dm-${to.id}`, id: `m${++this.n}` };
		this.sent.push({ to, m, ref });
		return ref;
	}
	async update(ref: SentRef, m: OutboundMessage) {
		this.updates.push({ ref, m });
	}
	async react(ref: SentRef, emoji: string) {
		this.reactions.push({ ref, emoji });
	}
	async ack(e: ButtonEvent, text?: string) {
		this.acks.push({ id: e.id, text });
	}
	health(): ChannelHealth {
		return { state: this.state, reason: null, self: { id: '999', name: 'Wheelhouse' } };
	}

	text(from: string, text: string, o: Partial<Extract<InboundEvent, { kind: 'text' }>> = {}) {
		const id = o.id ?? `${900 + ++this.n}`;
		this.sink!({
			kind: 'text',
			id,
			from,
			fromName: from === CAPTAIN ? 'Captain' : 'Someone',
			dm: true,
			chat: `dm-${from}`,
			text,
			inReplyTo: null,
			extras: false,
			...o
		});
		return { chat: o.chat ?? `dm-${from}`, id };
	}
	press(from: string, token: string, message: SentRef | null, id = `p${++this.n}`) {
		this.sink!({
			kind: 'button',
			id,
			from,
			fromName: 'Captain',
			dm: true,
			chat: `dm-${from}`,
			token,
			message,
			handle: `${id}:secret`
		});
	}
	/** The token of the button labelled `label` on the latest message that has one. */
	button(label: string): { token: string; ref: SentRef } {
		for (const s of [...this.sent].reverse()) {
			const b = s.m.buttons?.find((x) => x.label === label && 'token' in x);
			if (b && 'token' in b) return { token: b.token, ref: s.ref };
		}
		throw new Error(`no ${label} button`);
	}
}

/** Firstmate's inbox in memory: request-id replay, acknowledgement and replies. */
function memoryInbox() {
	const notes: {
		noteId: string;
		requestId: string;
		body: string;
		acknowledged: boolean;
		reply: { body: string; at: string; cursor: string } | null;
	}[] = [];
	let cursor = 0;
	const receipt = (n: (typeof notes)[number]) => ({
		noteId: n.noteId,
		at: null,
		source: null,
		requestId: n.requestId,
		body: n.body,
		acknowledged: n.acknowledged,
		announced: true,
		reply: n.reply && { noteId: n.noteId, ...n.reply }
	});
	const adapter: FirstmateAdapter = {
		snapshot: () => Promise.reject(new Error('unused')),
		ready: () => Promise.reject(new Error('unused')),
		peek: () => Promise.reject(new Error('unused')),
		async note(requestId, body) {
			let n = notes.find((x) => x.requestId === requestId);
			const outcome = n ? ('replay' as const) : ('created' as const);
			if (!n) {
				n = { noteId: `n${notes.length + 1}`, requestId, body, acknowledged: false, reply: null };
				notes.push(n);
			}
			return {
				ok: true,
				value: {
					schema: INBOX_NOTE_SCHEMA,
					outcome,
					noteId: n.noteId,
					requestId,
					saved: true,
					announced: true,
					acknowledged: n.acknowledged
				},
				observedAt: '',
				durationMs: 0
			};
		},
		async receipts() {
			return {
				ok: true,
				value: {
					schema: INBOX_RECEIPTS_SCHEMA,
					generated: null,
					pending: notes.filter((n) => !n.acknowledged).map(receipt),
					handled: notes.filter((n) => n.acknowledged).map(receipt),
					replies: notes.filter((n) => n.reply).map((n) => ({ noteId: n.noteId, ...n.reply! })),
					replyCursor: String(cursor).padStart(12, '0'),
					omitted: []
				},
				observedAt: '',
				durationMs: 0
			};
		}
	};
	return {
		adapter,
		notes,
		ack: (noteId: string) => (notes.find((n) => n.noteId === noteId)!.acknowledged = true),
		reply: (noteId: string, body: string) => {
			cursor++;
			notes.find((n) => n.noteId === noteId)!.reply = {
				body,
				at: '2026-10-29T10:05:00Z',
				cursor: String(cursor).padStart(12, '0')
			};
		}
	};
}

const card = (over: Partial<InboxCard> = {}): InboxCard => ({
	id: 'colour:palette',
	taskId: 'colour',
	taskTitle: 'Pick a palette',
	projectId: 'lumen',
	kind: 'decision',
	key: 'palette',
	question: 'Navy or teal for the header?',
	askedAt: null,
	owner: 'captain',
	evidence: {
		text: null,
		findings: [],
		file: null,
		pr: null,
		preview: null,
		checks: null,
		screenshots: [],
		report: null
	},
	options: optionsFor('decision'),
	recommendation: { choice: 'approve', text: 'Navy, as proposed.' },
	choices: null,
	sent: null,
	...over
});

let dir: string;
let clock: { t: number };
let fm: ReturnType<typeof memoryInbox>;
let channel: FakeChannel;
let settings: GatewaySettings;
let messenger: Messenger;
let listeners: Set<(e: BellEvent) => void>;
let cards: InboxCard[];
let fleet: FleetView;
let gw: Gateway;
let log: AuditLog;

const auditFile = () => path.join(dir, 'state', 'gateway', 'discord.jsonl');
const audit = () =>
	readFileSync(auditFile(), 'utf8')
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l) as Record<string, unknown>);

async function make(adapter: () => ChannelAdapter = () => channel): Promise<Gateway> {
	const record = await GatewayRecord.open(path.join(dir, 'state', 'gateway.json'), () => clock.t);
	log = new AuditLog(auditFile(), () => clock.t);
	const inbox = {
		async view(): Promise<InboxView> {
			const msgs = messenger.view().messages;
			return {
				schema: 'wheelhouse-inbox.v1',
				available: true,
				reason: null,
				canAnswer: true,
				cards: cards.map((c) => {
					const m = [...msgs].reverse().find((x) => answerOf(x.text)?.key === c.key);
					const a = m ? answerOf(m.text) : null;
					return m && a
						? {
								...c,
								sent: {
									choice: a.choice,
									picks: null,
									note: null,
									at: m.submittedAt,
									delivery: m.delivery,
									detail: null,
									requestId: m.requestId
								}
							}
						: c;
				})
			};
		},
		async answer(requestId: string | null, body: Record<string, unknown>) {
			const c = (await inbox.view()).cards.find((x) => x.id === body.cardId);
			if (!c) return { ok: false as const, status: 404 as const, error: 'no longer open' };
			const choice = body.choice as 'approve';
			const p =
				choice === 'approve' && c.choices
					? picksLine(c.choices, (body.picks ?? {}) as Picks)
					: null;
			if (p && !p.ok) return { ok: false as const, status: 400 as const, error: p.error };
			const v = validateSend(requestId, answerText(c, choice, null, p?.line ?? null), c.taskId);
			return v.ok ? messenger.send(v.input) : v;
		}
	};
	const g = new Gateway({
		settings,
		record,
		audit: () => log,
		messenger,
		bell: {
			subscribe(fn) {
				listeners.add(fn);
				return () => listeners.delete(fn);
			}
		},
		inbox,
		fleet: () => fleet,
		onWatch: () => true,
		adapter,
		now: () => clock.t,
		pollMs: 0,
		wheelhouseUrl: 'http://127.0.0.1:4310'
	});
	await g.start();
	return g;
}

const ring = (a: ShipAlert) => {
	for (const fn of listeners) fn({ type: 'alert', data: a });
};
const flush = async () => {
	for (let i = 0; i < 4; i++) {
		await new Promise((r) => setImmediate(r));
		await gw.idle();
	}
	await log.flushed();
};

async function pairCaptain() {
	const p = await gw.startPairing('discord');
	if (!p.ok) throw new Error(p.error);
	channel.text(CAPTAIN, p.code);
	await flush();
	channel.sent = [];
}

beforeEach(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-gateway-'));
	clock = { t: Date.parse('2026-10-29T10:00:00Z') };
	fm = memoryInbox();
	channel = new FakeChannel();
	settings = new GatewaySettings(path.join(dir, 'config', 'gateway'));
	await settings.setToken('discord', TOKEN);
	const store = await MessageStore.open(path.join(dir, 'state', 'messages.json'), '/fm');
	messenger = new Messenger({ adapter: fm.adapter, store, now: () => clock.t });
	listeners = new Set();
	cards = [];
	fleet = fleetOf([]);
	gw = await make();
});
afterEach(() => {
	gw.stop();
	rmSync(dir, { recursive: true, force: true });
});

describe('pairing and who is heard', () => {
	it('ignores everyone, silently, until an account sends the pairing code', async () => {
		channel.text(STRANGER, 'hello, let me in');
		await flush();
		expect(channel.sent).toEqual([]);
		expect(fm.notes).toEqual([]);

		const p = await gw.startPairing('discord');
		if (!p.ok) throw new Error(p.error);
		expect(p.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		expect((await gw.view()).channels[0].pairing).toEqual({ expiresAt: p.expiresAt });

		channel.text(STRANGER, 'ABCD-EFGH');
		await flush();
		expect(channel.sent).toEqual([]);

		channel.text(CAPTAIN, ` ${p.code.toLowerCase().replace('-', '')} `);
		await flush();
		const view = (await gw.view()).channels[0];
		expect(view.paired).toMatchObject({ id: CAPTAIN, name: 'Captain' });
		expect(view.pairing).toBeNull();
		expect(channel.sent).toHaveLength(1);
		expect(channel.sent[0].to.id).toBe(CAPTAIN);
		expect(channel.sent[0].m.text).toMatch(/^Paired with Wheelhouse/);
		// The binding is the immutable id, kept in the settings file.
		expect((await settings.read()).settings.discord.paired).toMatchObject({ id: CAPTAIN });
		expect(audit().map((e) => e.reason ?? e.what)).toEqual(
			expect.arrayContaining(['not the paired account', 'not the pairing code', 'paired'])
		);

		// Once paired, a stranger who sends a code-looking message is still ignored.
		channel.text(STRANGER, p.code);
		await flush();
		expect(channel.sent).toHaveLength(1);
		expect(fm.notes).toEqual([]);
	});

	it('pairs the paired account again when it sends a new code, without telling Firstmate', async () => {
		await pairCaptain();
		const p = await gw.startPairing('discord');
		if (!p.ok) throw new Error(p.error);
		channel.text(CAPTAIN, 'an ordinary message first');
		channel.text(CAPTAIN, p.code);
		await flush();
		expect(fm.notes).toHaveLength(1);
		expect(fm.notes[0].body).not.toContain(p.code.replace('-', ''));
		expect(fm.notes[0].body).not.toContain(p.code);
		expect((await gw.view()).channels[0]).toMatchObject({ pairing: null, paired: { id: CAPTAIN } });
	});

	it('calls the pairing off after five wrong codes', async () => {
		await gw.startPairing('discord');
		for (let i = 0; i < 5; i++) channel.text(STRANGER, `guess ${i}`);
		await flush();
		const view = (await gw.view()).channels[0];
		expect(view.pairing).toBeNull();
		expect(view.pairingNote).toMatch(/called off after 5/);
		expect(view.paired).toBeNull();
	});

	it('lets a code expire after ten minutes', async () => {
		const p = await gw.startPairing('discord');
		if (!p.ok) throw new Error(p.error);
		clock.t += 10 * 60_000 + 1;
		channel.text(CAPTAIN, p.code);
		await flush();
		expect((await gw.view()).channels[0].paired).toBeNull();
		expect(channel.sent).toEqual([]);
	});

	it('refuses to pair before the bot token is set', async () => {
		gw.stop();
		rmSync(settings.tokenFile('discord'));
		gw = await make();
		const p = await gw.startPairing('discord');
		expect(p).toMatchObject({ ok: false, error: expect.stringMatching(/gateway connect discord/) });
		expect((await gw.view()).channels[0]).toMatchObject({ state: 'no-token', token: false });
	});

	it('ignores messages in server channels, even from the captain', async () => {
		await pairCaptain();
		channel.text(CAPTAIN, 'merge it', { dm: false, chat: 'guild-chan' });
		await flush();
		expect(fm.notes).toEqual([]);
		expect(channel.sent).toEqual([]);
	});

	it('follows an unbind made by the CLI', async () => {
		await pairCaptain();
		await settings.update((s) => (s.discord.paired = null));
		await gw.reloadIfChanged();
		channel.text(CAPTAIN, 'still there?');
		await flush();
		expect(fm.notes).toEqual([]);
	});

	it('disconnects when turned off and says so', async () => {
		await new Promise((r) => setImmediate(r));
		expect(channel.running).toBe(true);
		await gw.setEnabled('discord', false);
		await new Promise((r) => setImmediate(r));
		expect(channel.running).toBe(false);
		expect((await gw.view()).channels[0].state).toBe('off');
	});

	it('connects a channel once when reloads overlap, so turning it off stops it', async () => {
		gw.stop();
		rmSync(settings.tokenFile('discord'));
		let made = 0;
		gw = await make(() => {
			made++;
			return channel;
		});
		await settings.setToken('discord', TOKEN);
		await Promise.all([gw.reload(), gw.reloadIfChanged(), gw.setEnabled('discord', true)]);
		expect(made).toBe(1);
		await gw.setEnabled('discord', false);
		await new Promise((r) => setImmediate(r));
		expect(channel.running).toBe(false);
	});
});

describe('messages to Firstmate', () => {
	it('sends the captain’s text as a note whose request id is the platform message id', async () => {
		await pairCaptain();
		const ref = channel.text(CAPTAIN, 'How is the export going?', { id: '1300000000000000001' });
		await flush();
		expect(fm.notes).toHaveLength(1);
		expect(fm.notes[0].requestId).toBe('discord:1300000000000000001');
		expect(fm.notes[0].body).toMatch(/^\[via Discord\] .*fm-inbox\.sh reply/);
		expect(fm.notes[0].body).toMatch(/\nHow is the export going\?$/);
		// Delivered: marked on the captain's message.
		expect(channel.reactions).toEqual([{ ref, emoji: '📥' }]);

		// Discord redelivers it after a reconnect: still one note, and the redelivery is logged.
		channel.text(CAPTAIN, 'How is the export going?', { id: '1300000000000000001' });
		await flush();
		expect(fm.notes).toHaveLength(1);
		expect(audit().filter((e) => e.requestId === 'discord:1300000000000000001')).toEqual([
			expect.objectContaining({ event: 'accept' }),
			expect.objectContaining({ event: 'accept', what: 'redelivered' })
		]);
	});

	it('sends Firstmate’s reply back under the captain’s message, once', async () => {
		await pairCaptain();
		const ref = channel.text(CAPTAIN, 'What is left?');
		await flush();
		fm.ack('n1');
		fm.reply('n1', 'Two tasks: the export and the docs.');
		await messenger.reconcile();
		await flush();
		const replies = channel.sent.filter((s) => s.m.text.startsWith('Two tasks'));
		expect(replies).toHaveLength(1);
		expect(replies[0].m.replyTo).toEqual(ref);
		expect(channel.reactions.map((r) => r.emoji)).toEqual(['📥', '👀']);

		await messenger.reconcile();
		await flush();
		// And not again after a restart.
		gw.stop();
		gw = await make();
		await flush();
		expect(channel.sent.filter((s) => s.m.text.startsWith('Two tasks'))).toHaveLength(1);
	});

	it('gives a reply to one of its messages that message’s task', async () => {
		await pairCaptain();
		ring(raise(alertsFor(prGreen('lumen-export'), clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
		const alert = channel.sent[0].ref;
		channel.text(CAPTAIN, 'Did the docs land too?', { inReplyTo: alert });
		await flush();
		expect(fm.notes[0].body).toMatch(/^Re: lumen-export\n\[via Discord\]/);

		// A reply to Firstmate's answer keeps the task.
		fm.reply('n1', 'They did.');
		await messenger.reconcile();
		await flush();
		const answer = channel.sent.find((s) => s.m.text === 'They did.')!.ref;
		channel.text(CAPTAIN, 'Great, thanks', { inReplyTo: answer });
		await flush();
		expect(fm.notes[1].body).toMatch(/^Re: lumen-export\n/);
	});

	it('answers status and help itself, without waking Firstmate', async () => {
		fleet = fleetOf([prGreen('lumen-export'), taskSummary('lumen-docs', 'working')]);
		await pairCaptain();
		channel.text(CAPTAIN, 'Status');
		channel.text(CAPTAIN, ' help ');
		await flush();
		expect(fm.notes).toEqual([]);
		expect(channel.sent[0].m.text).toBe(
			[
				'Firstmate is on watch.',
				'Waiting on you (1):',
				'- lumen-export: pull request ready for you',
				'1 under way'
			].join('\n')
		);
		expect(channel.sent[1].m.text).toMatch(/^Anything you write here goes to Firstmate/);
	});

	it('passes on text only, and says what it dropped', async () => {
		await pairCaptain();
		channel.text(CAPTAIN, '', { extras: true });
		channel.text(CAPTAIN, 'see attached', { extras: true });
		await flush();
		expect(fm.notes).toHaveLength(1);
		expect(fm.notes[0].body).toMatch(/\nsee attached$/);
		expect(channel.sent.map((s) => s.m.text)).toEqual([
			expect.stringMatching(/^Only text reaches Firstmate/),
			expect.stringMatching(/^Only your text went to Firstmate/)
		]);
	});

	it('holds back past the rate limit, and says so once', async () => {
		await pairCaptain();
		for (let i = 0; i < RATE_PER_MINUTE + 2; i++) channel.text(CAPTAIN, `message ${i}`);
		await flush();
		expect(fm.notes).toHaveLength(RATE_PER_MINUTE);
		const held = channel.sent.filter((s) => s.m.text.startsWith('Held back'));
		expect(held).toHaveLength(1);
		clock.t += 61_000;
		channel.text(CAPTAIN, 'later');
		await flush();
		expect(fm.notes).toHaveLength(RATE_PER_MINUTE + 1);
	});

	it('refuses an over-long message with the reason', async () => {
		await pairCaptain();
		channel.text(CAPTAIN, 'x'.repeat(17_000));
		await flush();
		expect(fm.notes).toEqual([]);
		expect(channel.sent[0].m.text).toMatch(/limited to 16384 bytes/);
	});
});

describe('alerts and buttons', () => {
	it('sends a green PR with its Merge button, which is the same note as the browser’s', async () => {
		await pairCaptain();
		const alert = raise(alertsFor(prGreen('lumen-export'), clock.t)[0], '2026-10-29T10:00:00Z');
		ring(alert);
		await flush();
		expect(channel.sent).toHaveLength(1);
		const m = channel.sent[0].m;
		expect(m.text).toBe('PR green: lumen-export\nPull request #42 is green and ready to merge.');
		// Merge as a button, the PR as a link; Wheelhouse's own (loopback) pages are left out.
		expect(m.buttons).toEqual([
			{ label: 'Merge', token: expect.any(String), style: 'primary' },
			{ label: 'Open PR', url: 'https://github.com/example/lumen/pull/42' }
		]);

		const { token, ref } = channel.button('Merge');
		channel.press(CAPTAIN, token, ref);
		await flush();
		expect(channel.acks).toEqual([{ id: expect.any(String), text: undefined }]);
		const merge = alert.actions.find((a) => a.kind === 'note')!;
		expect(fm.notes).toHaveLength(1);
		expect(fm.notes[0].requestId).toBe(merge.kind === 'note' && merge.requestId);
		// The message settles: the button goes, the link stays.
		expect(channel.updates).toEqual([
			{
				ref,
				m: {
					text: `${m.text}\n\n✓ Asked Firstmate to merge.`,
					buttons: [{ label: 'Open PR', url: 'https://github.com/example/lumen/pull/42' }]
				}
			}
		]);

		// The browser's toast sends the same note: Firstmate gets it once.
		if (merge.kind !== 'note') throw new Error('no note');
		const browser = await messenger.send({
			requestId: merge.requestId,
			text: merge.text,
			taskId: null
		});
		expect(browser).toMatchObject({ ok: true, created: false });
		expect(fm.notes).toHaveLength(1);

		// A second tap is refused.
		channel.press(CAPTAIN, token, ref);
		await flush();
		expect(channel.acks[1].text).toMatch(/already used/);
		expect(fm.notes).toHaveLength(1);
	});

	it('turns a question with a Decisions card into that card, its choices as buttons', async () => {
		cards = [card()];
		await pairCaptain();
		const task = taskSummary('colour', 'needs-decision', {
			attention: { kind: 'decision', owner: 'captain', text: 'Navy or teal?', url: null }
		});
		ring(raise(alertsFor(task, clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
		expect(channel.sent).toHaveLength(1);
		expect(channel.sent[0].m.text).toBe(
			[
				'Decision: Pick a palette',
				'Navy or teal for the header?',
				'Recommended: Navy, as proposed.',
				'Reply to this message to answer in your own words.'
			].join('\n')
		);
		expect(channel.sent[0].m.buttons?.map((b) => b.label)).toEqual(['Approve', 'Fix', 'Skip']);

		const { token, ref } = channel.button('Approve');
		channel.press(CAPTAIN, token, ref);
		await flush();
		expect(fm.notes).toHaveLength(1);
		expect(fm.notes[0].body).toMatch(/^Re: colour\nDecision inbox answer \(decision\)\./);
		expect(fm.notes[0].body).toMatch(/\nAnswer: Approve - Go ahead as proposed\.$/);
		expect(channel.updates[0].m.text).toMatch(/✓ Sent to Firstmate: Approve\.$/);
		expect(channel.updates[0].m.buttons).toEqual([]);

		// Asked again (a second ring): the card is answered, so the alert comes without buttons.
		ring(raise(alertsFor(task, clock.t)[0], '2026-10-29T10:01:00Z'));
		await flush();
		expect(channel.sent[1].m.text).toBe('Question waiting: colour\nNavy or teal?');
		expect(channel.sent[1].m.buttons).toBeUndefined();
	});

	const palettes = (calls: { id: string; prompt: string; options: string[] }[]) =>
		card({
			question: 'Which palette? A) Navy B) Teal',
			options: optionsFor('decision', true),
			choices: {
				intro: 'Which palette?',
				after: null,
				calls: calls.map((c, i) => ({
					id: c.id,
					number: calls.length > 1 ? i + 1 : null,
					prompt: c.prompt,
					required: true,
					options: c.options.map((label, j) => ({
						id: label,
						label,
						detail: null,
						recommended: j === 0
					}))
				}))
			}
		});
	const askColour = async () => {
		const task = taskSummary('colour', 'needs-decision', {
			attention: { kind: 'decision', owner: 'captain', text: 'Which palette?', url: null }
		});
		ring(raise(alertsFor(task, clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
	};

	it('gives a question’s options buttons of their own, each sending its own pick', async () => {
		cards = [palettes([{ id: 'main', prompt: 'Palette', options: ['A', 'B'] }])];
		await pairCaptain();
		await askColour();
		expect(channel.sent[0].m.text).toContain('Which palette? A) Navy B) Teal');
		expect(channel.sent[0].m.buttons?.map((b) => b.label)).toEqual(['A', 'B', 'Fix', 'Skip']);
		const { token, ref } = channel.button('B');
		channel.press(CAPTAIN, token, ref);
		await flush();
		expect(fm.notes).toHaveLength(1);
		expect(fm.notes[0].body).toMatch(/\nPicks: Palette: B$/m);
		expect(fm.notes[0].body).not.toMatch(/Picks: .*A/);
	});

	it('sends no picks the captain did not see: titles only, the picks are made in Wheelhouse', async () => {
		cards = [palettes([{ id: 'main', prompt: 'Palette', options: ['A', 'B'] }])];
		await settings.update((s) => (s.discord.titlesOnly = true));
		await gw.reload();
		await pairCaptain();
		await askColour();
		expect(channel.sent).toHaveLength(1);
		expect(channel.sent[0].m.text).not.toContain('Navy');
		expect(channel.sent[0].m.buttons).toEqual([
			expect.objectContaining({ label: 'Fix' }),
			expect.objectContaining({ label: 'Skip' }),
			{ label: 'Open in Wheelhouse', url: 'http://127.0.0.1:4310/decisions' }
		]);
	});

	it('sends a question with several calls to Wheelhouse for its picks', async () => {
		cards = [
			palettes([
				{ id: '1', prompt: 'Header', options: ['A', 'B'] },
				{ id: '2', prompt: 'Footer', options: ['A', 'B'] }
			])
		];
		await pairCaptain();
		await askColour();
		expect(channel.sent[0].m.buttons?.map((b) => b.label)).toEqual([
			'Fix',
			'Skip',
			'Open in Wheelhouse'
		]);
	});

	it('keeps a card’s pull request link, sending the picks to Wheelhouse when the options would crowd it out', async () => {
		const c = palettes([{ id: 'main', prompt: 'Palette', options: ['A', 'B', 'C'] }]);
		cards = [
			{
				...c,
				evidence: {
					...c.evidence,
					pr: {
						number: 42,
						url: 'https://github.com/example/lumen/pull/42'
					} as InboxCard['evidence']['pr']
				}
			}
		];
		await pairCaptain();
		await askColour();
		expect(channel.sent[0].m.buttons?.map((b) => b.label)).toEqual([
			'Fix',
			'Skip',
			'Open in Wheelhouse',
			'Open PR'
		]);
	});

	it('refuses a Decisions answer the browser already gave', async () => {
		cards = [card()];
		await pairCaptain();
		const task = taskSummary('colour', 'needs-decision', {
			attention: { kind: 'decision', owner: 'captain', text: 'Navy or teal?', url: null }
		});
		ring(raise(alertsFor(task, clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
		// The captain answers in the Decisions view first.
		const c = card();
		await messenger.send({
			requestId: 'inbox-browser-1',
			text: answerText(c, 'fix', null),
			taskId: c.taskId
		});
		const { token, ref } = channel.button('Approve');
		channel.press(CAPTAIN, token, ref);
		await flush();
		expect(fm.notes).toHaveLength(1);
		expect(fm.notes[0].requestId).toBe('inbox-browser-1');
		expect(channel.updates[0].m.text).toMatch(/✓ Already answered: Fix\.$/);
	});

	it('says a closed question is closed', async () => {
		cards = [card()];
		await pairCaptain();
		const task = taskSummary('colour', 'needs-decision', {
			attention: { kind: 'decision', owner: 'captain', text: 'Navy or teal?', url: null }
		});
		ring(raise(alertsFor(task, clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
		cards = [];
		const { token, ref } = channel.button('Fix');
		channel.press(CAPTAIN, token, ref);
		await flush();
		expect(fm.notes).toEqual([]);
		expect(channel.updates[0].m.text).toMatch(/no longer open/);
	});

	it('ignores a button pressed by anyone but the captain, and refuses an expired one', async () => {
		await pairCaptain();
		ring(raise(alertsFor(prGreen('lumen-export'), clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
		const { token, ref } = channel.button('Merge');
		channel.press(STRANGER, token, ref);
		await flush();
		expect(channel.acks).toEqual([]);
		expect(fm.notes).toEqual([]);

		clock.t += 25 * 3600_000;
		channel.press(CAPTAIN, token, ref);
		await flush();
		expect(channel.acks).toEqual([
			{ id: expect.any(String), text: expect.stringMatching(/expired/) }
		]);
		expect(fm.notes).toEqual([]);

		channel.press(CAPTAIN, 'made-up-token', ref);
		await flush();
		expect(channel.acks[1].text).toMatch(/no longer works/);
	});

	it('tells the captain a session question is answered at the keyboard, with no buttons', async () => {
		await pairCaptain();
		const draft = sessionAlert({
			signature: 'sig',
			title: 'Allow Bash(rm -rf build)?'
		} as Parameters<typeof sessionAlert>[0]);
		ring(raise(draft, '2026-10-29T10:00:00Z'));
		await flush();
		expect(channel.sent[0].m.text).toMatch(/answer it at the keyboard\.$/);
		expect(channel.sent[0].m.buttons).toBeUndefined();
	});

	it('sends only the alert kinds the captain picked', async () => {
		await pairCaptain();
		ring(raise(alertsFor(taskSummary('done-1', 'landed'), clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
		expect(channel.sent).toEqual([]);
		await gw.setAlerts('discord', ['landed']);
		ring(raise(alertsFor(taskSummary('done-1', 'landed'), clock.t)[0], '2026-10-29T10:01:00Z'));
		ring(raise(alertsFor(prGreen('lumen-export'), clock.t)[0], '2026-10-29T10:01:00Z'));
		await flush();
		expect(channel.sent.map((s) => s.m.text.split('\n')[0])).toEqual(['Merge landed: done-1']);
	});

	it('sends alerts and decisions as their titles only when asked, buttons kept', async () => {
		cards = [card()];
		await pairCaptain();
		await gw.setTitlesOnly('discord', true);
		expect((await gw.view()).channels[0].titlesOnly).toBe(true);
		ring(raise(alertsFor(prGreen('lumen-export'), clock.t)[0], '2026-10-29T10:00:00Z'));
		const task = taskSummary('colour', 'needs-decision', {
			attention: { kind: 'decision', owner: 'captain', text: 'Navy or teal?', url: null }
		});
		ring(raise(alertsFor(task, clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
		expect(channel.sent.map((s) => s.m.text)).toEqual([
			'PR green: lumen-export',
			'Decision: Pick a palette\nReply to this message to answer in your own words.'
		]);
		expect(channel.sent[0].m.buttons?.map((b) => b.label)).toContain('Merge');
		expect(channel.sent[1].m.buttons?.map((b) => b.label)).toEqual(['Approve', 'Fix', 'Skip']);
	});

	it('sends nothing while unpaired', async () => {
		ring(raise(alertsFor(prGreen('lumen-export'), clock.t)[0], '2026-10-29T10:00:00Z'));
		await flush();
		expect(channel.sent).toEqual([]);
	});
});

it('keeps the bot token out of its record, its audit log and its view', async () => {
	await pairCaptain();
	channel.text(CAPTAIN, 'hello');
	ring(raise(alertsFor(prGreen('lumen-export'), clock.t)[0], '2026-10-29T10:00:00Z'));
	await flush();
	expect(readFileSync(path.join(dir, 'state', 'gateway.json'), 'utf8')).not.toContain(TOKEN);
	expect(readFileSync(auditFile(), 'utf8')).not.toContain(TOKEN);
	expect(JSON.stringify(await gw.view())).not.toContain(TOKEN);
});
