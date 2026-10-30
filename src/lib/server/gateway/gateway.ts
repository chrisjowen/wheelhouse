import { digest } from '../../bell';
import {
	GATEWAY_CHANNELS,
	type GatewayChannel,
	type GatewayChannelView,
	type GatewayView
} from '../../gateway';
import { awaitsAnswer, choiceLabel, type InboxCard, type InboxView } from '../../inbox';
import type { AlertKind, FleetView, MessagesView, ShipAlert } from '../../types';
import type { BellEvent } from '../bell/bell';
import type { AnswerResult } from '../inbox/service';
import { validateSend, type Messenger } from '../store/messenger';
import type {
	ButtonEvent,
	ChannelAdapter,
	InboundEvent,
	OutboundButton,
	Peer,
	SentRef
} from './adapter';
import { Pairing } from './pairing';
import type { AuditEntry, AuditLog, ButtonGrant, GatewayRecord } from './record';
import {
	alertDraft,
	cardDraft,
	HELP_TEXT,
	localCommand,
	provenance,
	splitText,
	statusText,
	type Draft
} from './render';
import { defaultSettings, type GatewaySettings, type PairedPeer, type Settings } from './settings';

/**
 * The messaging gateway: lets the captain reach Firstmate from a chat app on
 * their phone, through the same audited, idempotent path as the browser.
 *
 *   in   A direct message from the paired account becomes a message to
 *        Firstmate (Messenger.send, so `fm-inbox.sh note`), its request id
 *        made from the platform's message id so a redelivery repeats nothing,
 *        with a first line saying it came from the phone. A reply to one of
 *        the gateway's messages carries that message's task (`Re: <task>`).
 *        `status` and `help` are answered here and wake nobody. Anyone else
 *        is ignored, silently.
 *   out  Firstmate's reply to such a note goes back under it; the bell's
 *        alerts of the kinds the captain picked go out with their buttons; a
 *        question that has a Decisions card goes out as that card, its
 *        choices as buttons.
 *   buttons  Each carries an opaque single-use token for an action kept here:
 *        an alert's own note, with the alert's request id, so a tap on the
 *        phone and a click in the browser are one note; or a Decisions
 *        answer, refused once the card has closed or been answered.
 *
 * Nothing from a channel types into the Firstmate session, answers its
 * question picker or permission prompts, or reaches a worker. Every accept,
 * refusal and send is written to the channel's audit log.
 */

/** How long a button keeps working. */
export const BUTTON_TTL_MS = 24 * 3600_000;
/** Messages from a channel that may reach Firstmate a minute, and a day: each one wakes it. */
export const RATE_PER_MINUTE = 6;
export const RATE_PER_DAY = 200;
/** Decisions cards sent for one question alert. */
const CARDS_PER_ALERT = 3;
const POLL_MS = 3_000;
const DELIVERED = '📥';
const READ = '👀';

export interface GatewayDeps {
	settings: GatewaySettings;
	record: GatewayRecord;
	audit: (channel: GatewayChannel) => AuditLog;
	messenger: Pick<Messenger, 'send' | 'view' | 'subscribe'>;
	bell: { subscribe(fn: (e: BellEvent) => void): () => void };
	inbox: {
		view(): Promise<InboxView>;
		answer(requestId: string | null, body: Record<string, unknown>): Promise<AnswerResult>;
	};
	fleet: () => FleetView;
	onWatch: () => boolean | null;
	/** Makes a channel's adapter for its bot token. */
	adapter: (channel: GatewayChannel, token: string) => ChannelAdapter;
	/** Why the gateway cannot run here at all (e.g. its settings would sit in the Firstmate home). */
	problem?: string | null;
	now?: () => number;
	/** How often the settings files are checked for a change the CLI made; 0 never. */
	pollMs?: number;
	/** Where Wheelhouse is served, for a card's "Open in Wheelhouse"; null when not known. */
	wheelhouseUrl?: string | null;
}

interface Live {
	adapter: ChannelAdapter;
	abort: AbortController;
	token: string;
}

type Outcome = { ok: true; settled: string } | { ok: false; why: string };

const label = (c: GatewayChannel) => GATEWAY_CHANNELS.find((x) => x.channel === c)?.label ?? c;

export class Gateway {
	private settings: Settings = defaultSettings();
	private settingsError: string | null = null;
	private stampSeen = '';
	/** Where each channel's bot token is kept, or null when none is set. */
	private tokens = new Map<GatewayChannel, string | null>();
	private live = new Map<GatewayChannel, Live>();
	private pairings = new Map<GatewayChannel, Pairing>();
	private rate = new Map<GatewayChannel, number[]>();
	private slowNotice = new Map<GatewayChannel, number>();
	private pressing = new Set<string>();
	private work: Promise<void> = Promise.resolve();
	/** Reloads and settings changes, one at a time. */
	private settingsWork: Promise<void> = Promise.resolve();
	private stopped = false;
	private unsubscribe: (() => void)[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private now: () => number;

	constructor(private deps: GatewayDeps) {
		this.now = deps.now ?? Date.now;
	}

	async start(): Promise<void> {
		await this.reload();
		this.unsubscribe.push(
			this.deps.bell.subscribe((e) => {
				if (e.type === 'alert') void this.queue(() => this.onAlert(e.data));
			}),
			this.deps.messenger.subscribe((v) => void this.queue(() => this.onMessages(v)))
		);
		// Replies that came while Wheelhouse was down go out now.
		void this.queue(() => this.onMessages(this.deps.messenger.view()));
		const every = this.deps.pollMs ?? POLL_MS;
		if (every > 0) {
			this.timer = setInterval(() => void this.reloadIfChanged(), every);
			this.timer.unref?.();
		}
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		for (const off of this.unsubscribe) off();
		this.unsubscribe = [];
		for (const l of this.live.values()) l.abort.abort();
		this.live.clear();
	}

	/** Wait until nothing is queued, including work queued while waiting (tests). */
	async idle(): Promise<void> {
		let w: Promise<void>;
		do {
			w = this.work;
			await w;
		} while (w !== this.work);
	}

	/** Run work in order; what fails is logged in its channel's audit log, or every channel's when it spans them. */
	private queue(fn: () => Promise<void>, channel?: GatewayChannel): Promise<void> {
		this.work = this.work.then(fn).catch((e) => {
			for (const c of channel ? [channel] : GATEWAY_CHANNELS.map((x) => x.channel)) {
				this.log(c, { event: 'error', reason: (e as Error).message });
			}
		});
		return this.work;
	}

	private pairing(channel: GatewayChannel): Pairing {
		let p = this.pairings.get(channel);
		if (!p) {
			p = new Pairing(this.now);
			this.pairings.set(channel, p);
		}
		return p;
	}

	private log(channel: GatewayChannel, entry: AuditEntry): void {
		void this.deps.audit(channel).write(entry);
	}

	/* ------------------------------------------------------------ settings */

	async reloadIfChanged(): Promise<void> {
		const stamp = await this.deps.settings.stamp();
		if (stamp !== this.stampSeen) await this.reload();
	}

	/**
	 * Read the settings and tokens, and connect, reconnect or disconnect each
	 * channel to match. One at a time, so two never both connect a channel.
	 */
	reload(): Promise<void> {
		return this.inTurn(() => this.load());
	}

	private inTurn(fn: () => Promise<void>): Promise<void> {
		const next = this.settingsWork.then(fn);
		this.settingsWork = next.catch(() => {});
		return next;
	}

	private async load(): Promise<void> {
		this.stampSeen = await this.deps.settings.stamp();
		const { settings, error } = await this.deps.settings.read();
		this.settings = settings;
		this.settingsError = error;
		for (const { channel } of GATEWAY_CHANNELS) {
			const found = await this.deps.settings.find(channel);
			this.tokens.set(channel, found?.where ?? null);
			const token = found?.token ?? null;
			const want =
				token && settings[channel].enabled && !this.deps.problem && !this.stopped ? token : null;
			const cur = this.live.get(channel);
			if (cur && cur.token === want) continue;
			if (cur) {
				cur.abort.abort();
				this.live.delete(channel);
				this.log(channel, { event: 'disconnect', reason: want ? 'new token' : 'turned off' });
			}
			if (want) this.connect(channel, want);
		}
	}

	private connect(channel: GatewayChannel, token: string): void {
		const adapter = this.deps.adapter(channel, token);
		const abort = new AbortController();
		this.live.set(channel, { adapter, abort, token });
		this.log(channel, { event: 'connect' });
		void adapter
			.run((e) => this.onEvent(channel, adapter, e), abort.signal)
			.catch((e) => this.log(channel, { event: 'error', reason: (e as Error).message }));
		// Replies and marks that waited while the channel was off go out now.
		void this.queue(() => this.onMessages(this.deps.messenger.view()));
	}

	private change(channel: GatewayChannel, fn: (s: Settings[GatewayChannel]) => void) {
		return this.inTurn(async () => {
			this.settings = await this.deps.settings.update((s) => fn(s[channel]));
			this.settingsError = null;
			this.stampSeen = await this.deps.settings.stamp();
		});
	}

	/* ------------------------------------------------------------ the Settings page */

	async view(): Promise<GatewayView> {
		const channels: GatewayChannelView[] = GATEWAY_CHANNELS.map(({ channel, label }) => {
			const s = this.settings[channel];
			const health = this.live.get(channel)?.adapter.health() ?? null;
			const tokenStore = this.tokens.get(channel) ?? null;
			const token = tokenStore !== null;
			const pairing = this.pairing(channel);
			return {
				channel,
				label,
				token,
				tokenStore,
				enabled: s.enabled,
				state: this.deps.problem
					? 'down'
					: !token
						? 'no-token'
						: !s.enabled
							? 'off'
							: (health?.state ?? 'connecting'),
				reason: this.deps.problem ?? this.settingsError ?? health?.reason ?? null,
				bot: health?.self ?? null,
				paired: s.paired ? { id: s.paired.id, name: s.paired.name, at: s.paired.at } : null,
				pairing: pairing.open(),
				pairingNote: pairing.note,
				alerts: [...s.alerts],
				titlesOnly: s.titlesOnly
			};
		});
		return {
			schema: 'wheelhouse-gateway.v1',
			available: !this.deps.problem,
			reason: this.deps.problem ?? null,
			settingsDir: this.deps.settings.dir,
			channels
		};
	}

	/** Start pairing: the code is returned to the page that asked, and nowhere else. */
	async startPairing(
		channel: GatewayChannel
	): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
		if (this.deps.problem) return { ok: false, error: this.deps.problem };
		await this.reload();
		const live = this.live.get(channel);
		if (!live) {
			return {
				ok: false,
				error: !this.tokens.get(channel)
					? `Set the bot token first: run \`wheelhouse gateway connect ${channel}\` in a terminal.`
					: `${label(channel)} is turned off. Turn it on first.`
			};
		}
		const p = this.pairing(channel).start();
		this.log(channel, { event: 'pair', what: 'pairing started' });
		return { ok: true, ...p };
	}

	cancelPairing(channel: GatewayChannel): void {
		this.pairing(channel).cancel();
	}

	async unbind(channel: GatewayChannel): Promise<void> {
		const was = this.settings[channel].paired;
		await this.change(channel, (s) => (s.paired = null));
		if (!was) return;
		this.log(channel, { event: 'unbind', from: was.id });
		const live = this.live.get(channel);
		if (live) {
			await this.post(channel, live.adapter, was, {
				text: 'This account is no longer bound to Wheelhouse. Messages here no longer reach Firstmate.',
				taskId: null,
				actions: [],
				links: []
			});
		}
	}

	async setEnabled(channel: GatewayChannel, on: boolean): Promise<void> {
		await this.change(channel, (s) => (s.enabled = on));
		await this.reload();
	}

	async setAlerts(channel: GatewayChannel, kinds: AlertKind[]): Promise<void> {
		await this.change(channel, (s) => (s.alerts = [...new Set(kinds)]));
	}

	async setTitlesOnly(channel: GatewayChannel, on: boolean): Promise<void> {
		await this.change(channel, (s) => (s.titlesOnly = on));
	}

	/* ------------------------------------------------------------ in */

	private onEvent(channel: GatewayChannel, adapter: ChannelAdapter, e: InboundEvent): void {
		// A press is acknowledged at once (the platform's deadline is seconds); its action queues.
		if (e.kind === 'button') void this.onButton(channel, adapter, e);
		else void this.queue(() => this.onText(channel, adapter, e), channel);
	}

	/** The paired account, when this event is from it in a direct message. */
	private captain(channel: GatewayChannel, e: InboundEvent): PairedPeer | null {
		const p = this.settings[channel].paired;
		return e.dm && p && p.id === e.from ? p : null;
	}

	private async onText(
		channel: GatewayChannel,
		adapter: ChannelAdapter,
		e: Extract<InboundEvent, { kind: 'text' }>
	): Promise<void> {
		if (!e.dm) {
			this.log(channel, {
				event: 'refuse',
				from: e.from,
				id: e.id,
				reason: 'not a direct message'
			});
			return;
		}
		const captain = this.captain(channel, e);
		if (!captain) {
			const offer = this.pairing(channel).offer(e.text);
			if (offer === 'match') return this.bind(channel, adapter, e);
			// Strangers get silence: no reply, not even to say they are not paired.
			this.log(channel, {
				event: 'refuse',
				from: e.from,
				id: e.id,
				reason: offer === 'wrong' ? 'not the pairing code' : 'not the paired account'
			});
			return;
		}
		// The paired account sending the code pairs again, rather than handing the code to Firstmate.
		if (this.pairing(channel).offer(e.text, { count: false }) === 'match') {
			return this.bind(channel, adapter, e);
		}
		if (captain.dm !== e.chat)
			await this.change(channel, (s) => s.paired && (s.paired.dm = e.chat));
		const peer: Peer = { id: captain.id, dm: e.chat };
		const ref: SentRef = { chat: e.chat, id: e.id };
		const say = (text: string) => this.post(channel, adapter, peer, notice(text), ref);

		const command = localCommand(e.text);
		if (command) {
			this.log(channel, { event: 'accept', from: e.from, id: e.id, what: command });
			await say(
				command === 'status' ? statusText(this.deps.fleet(), this.deps.onWatch()) : HELP_TEXT
			);
			return;
		}
		const text = e.text.trim();
		if (!text) {
			this.log(channel, { event: 'refuse', from: e.from, id: e.id, reason: 'no text' });
			if (e.extras)
				await say(
					'Only text reaches Firstmate: attachments, stickers and forwards are not passed on.'
				);
			return;
		}
		const requestId = `${channel}:${e.id}`;
		const taskId = e.inReplyTo ? (this.deps.record.sentAt(e.inReplyTo)?.taskId ?? null) : null;
		const valid = validateSend(requestId, `${provenance(label(channel))}\n${text}`, taskId);
		if (!valid.ok) {
			this.log(channel, { event: 'refuse', from: e.from, id: e.id, reason: valid.error });
			await say(valid.error);
			return;
		}
		// A redelivered message repeats its note, which the messenger replays.
		if (this.deps.record.note(requestId)) {
			const r = await this.deps.messenger.send(valid.input);
			this.log(
				channel,
				r.ok
					? { event: 'accept', from: e.from, id: e.id, requestId, taskId, what: 'redelivered' }
					: { event: 'refuse', from: e.from, id: e.id, requestId, reason: r.error }
			);
			return;
		}
		const held = this.held(channel);
		if (held) {
			this.log(channel, { event: 'refuse', from: e.from, id: e.id, reason: held });
			const last = this.slowNotice.get(channel) ?? 0;
			if (this.now() - last > 60_000) {
				this.slowNotice.set(channel, this.now());
				await say(held);
			}
			return;
		}
		this.deps.record.addNote({
			requestId,
			channel,
			from: e.from,
			ref,
			taskId,
			at: new Date(this.now()).toISOString(),
			delivered: false,
			read: false,
			failed: false,
			replied: null
		});
		await this.deps.record.save();
		const r = await this.deps.messenger.send(valid.input);
		if (!r.ok) {
			this.log(channel, { event: 'refuse', from: e.from, id: e.id, requestId, reason: r.error });
			const n = this.deps.record.note(requestId);
			if (n) n.failed = true;
			await this.deps.record.save();
			await say(`Firstmate did not get this: ${r.error}`);
			return;
		}
		this.log(channel, { event: 'accept', from: e.from, id: e.id, requestId, taskId });
		if (e.extras) await say('Only your text went to Firstmate: attachments are not passed on.');
	}

	/** Why a message is held back by the rate limit or the daily cap, or null. */
	private held(channel: GatewayChannel): string | null {
		const now = this.now();
		const recent = (this.rate.get(channel) ?? []).filter((t) => now - t < 24 * 3600_000);
		if (recent.length >= RATE_PER_DAY) {
			return `Held back: at most ${RATE_PER_DAY} messages a day reach Firstmate from ${label(channel)}, since each one wakes it.`;
		}
		if (recent.filter((t) => now - t < 60_000).length >= RATE_PER_MINUTE) {
			return `Held back: at most ${RATE_PER_MINUTE} messages a minute reach Firstmate from ${label(channel)}. Send it again in a minute.`;
		}
		recent.push(now);
		this.rate.set(channel, recent);
		return null;
	}

	private async bind(
		channel: GatewayChannel,
		adapter: ChannelAdapter,
		e: Extract<InboundEvent, { kind: 'text' }>
	): Promise<void> {
		const peer: PairedPeer = {
			id: e.from,
			name: e.fromName,
			dm: e.chat,
			at: new Date(this.now()).toISOString()
		};
		await this.change(channel, (s) => (s.paired = peer));
		this.log(channel, { event: 'pair', from: e.from, id: e.id, what: 'paired' });
		await this.post(
			channel,
			adapter,
			peer,
			notice(
				'Paired with Wheelhouse. What you write here goes to Firstmate, and its answers, alerts and decisions come back here. Send help to see what else works.'
			),
			{ chat: e.chat, id: e.id }
		);
	}

	private async onButton(
		channel: GatewayChannel,
		adapter: ChannelAdapter,
		e: ButtonEvent
	): Promise<void> {
		if (!this.captain(channel, e)) {
			this.log(channel, {
				event: 'refuse',
				from: e.from,
				id: e.id,
				reason: 'a button from an account that is not paired'
			});
			return;
		}
		const found = this.deps.record.button(e.token);
		const busy = found.ok && this.pressing.has(found.grant.token);
		if (!found.ok || busy) {
			const why = found.ok ? 'That is on its way already.' : found.why;
			this.log(channel, { event: 'refuse', from: e.from, id: e.id, reason: why });
			await adapter.ack(e, why).catch(() => {});
			return;
		}
		const grant = found.grant;
		this.pressing.add(grant.token);
		await adapter.ack(e).catch(() => {});
		await this.queue(async () => {
			try {
				const outcome = await this.perform(channel, grant, e);
				this.log(channel, {
					event: 'button',
					from: e.from,
					id: e.id,
					what: grant.action.kind === 'note' ? grant.action.requestId : grant.action.cardId,
					reason: outcome.ok ? undefined : outcome.why
				});
				await this.settle(channel, adapter, grant, e, outcome);
			} finally {
				this.pressing.delete(grant.token);
			}
		}, channel);
	}

	private async perform(
		channel: GatewayChannel,
		grant: ButtonGrant,
		e: ButtonEvent
	): Promise<Outcome> {
		const a = grant.action;
		if (a.kind === 'note') {
			const r = await this.deps.messenger.send({
				requestId: a.requestId,
				text: a.text,
				taskId: a.taskId
			});
			if (!r.ok) return { ok: false, why: r.error };
			if (r.message.delivery === 'failed') {
				return { ok: false, why: r.message.deliveryDetail ?? 'Firstmate did not take it.' };
			}
			return { ok: true, settled: `${a.sent}.` };
		}
		const view = await this.deps.inbox.view();
		const card = view.cards.find((c) => c.id === a.cardId);
		if (!card) {
			return {
				ok: true,
				settled: 'This question is no longer open; Firstmate may have settled it already.'
			};
		}
		if (!awaitsAnswer(card) && card.sent) {
			return { ok: true, settled: `Already answered: ${choiceLabel(card, card.sent.choice)}.` };
		}
		const r = await this.deps.inbox.answer(`${channel}:${e.id}`, {
			cardId: a.cardId,
			choice: a.choice,
			note: null,
			picks: a.picks
		});
		if (!r.ok) return { ok: false, why: r.error };
		if (r.message.delivery === 'failed') {
			return { ok: false, why: r.message.deliveryDetail ?? 'Firstmate did not take it.' };
		}
		return { ok: true, settled: `Sent to Firstmate: ${a.label}.` };
	}

	/** A used button settles its message (its buttons go, its links stay); a failed one says why and stays usable. */
	private async settle(
		channel: GatewayChannel,
		adapter: ChannelAdapter,
		grant: ButtonGrant,
		e: ButtonEvent,
		outcome: Outcome
	): Promise<void> {
		const ref = e.message ?? grant.ref;
		const peer: Peer = { id: e.from, dm: e.chat };
		if (!outcome.ok) {
			await this.post(
				channel,
				adapter,
				peer,
				notice(`That did not go through: ${outcome.why}`),
				ref
			);
			return;
		}
		this.deps.record.spend(grant.ref, grant.token);
		await this.deps.record.save();
		if (!ref) return;
		const sent = this.deps.record.sentAt(ref);
		const text = sent?.text ? `${sent.text}\n\n✓ ${outcome.settled}` : `✓ ${outcome.settled}`;
		await adapter
			.update(ref, { text, buttons: (sent?.links ?? []).map((l) => ({ ...l })) })
			.catch((err) => this.log(channel, { event: 'error', reason: (err as Error).message }));
	}

	/* ------------------------------------------------------------ out */

	/** Delivery marks and Firstmate's replies for the notes that came from a channel. */
	private async onMessages(view: MessagesView): Promise<void> {
		let changed = false;
		for (const m of view.messages) {
			const n = this.deps.record.note(m.requestId);
			if (!n) continue;
			const live = this.live.get(n.channel);
			const paired = this.settings[n.channel].paired;
			if (!live || !paired || paired.id !== n.from) continue;
			const adapter = live.adapter;
			const mark = async (emoji: string) => {
				try {
					await adapter.react(n.ref, emoji);
					return true;
				} catch (e) {
					this.log(n.channel, {
						event: 'error',
						requestId: n.requestId,
						reason: (e as Error).message
					});
					return false;
				}
			};
			if (!n.delivered && m.delivery === 'delivered' && (await mark(DELIVERED))) {
				n.delivered = changed = true;
			}
			if (!n.read && m.acknowledged && (await mark(READ))) n.read = changed = true;
			const peer: Peer = { id: paired.id, dm: paired.dm };
			if (!n.failed && m.delivery === 'failed') {
				n.failed = changed = true;
				await this.post(
					n.channel,
					adapter,
					peer,
					notice(`Firstmate did not take this: ${m.deliveryDetail ?? 'it refused the message.'}`),
					n.ref
				);
			}
			if (m.reply) {
				const key = `${m.reply.at ?? ''}:${digest(m.reply.body)}`;
				if (n.replied !== key) {
					const sent = await this.post(
						n.channel,
						adapter,
						peer,
						{ text: m.reply.body, taskId: n.taskId, actions: [], links: [] },
						n.ref,
						'reply'
					);
					if (sent) {
						n.replied = key;
						changed = true;
					}
				}
			}
		}
		if (changed) await this.deps.record.save();
	}

	private async onAlert(alert: ShipAlert): Promise<void> {
		const targets = GATEWAY_CHANNELS.map((c) => c.channel).filter((c) => {
			const s = this.settings[c];
			return this.live.has(c) && s.paired && s.alerts.includes(alert.kind);
		});
		if (!targets.length) return;
		let cards: InboxCard[] = [];
		if (alert.kind === 'question' && alert.taskId) {
			const view = await this.deps.inbox.view().catch(() => null);
			cards = (view?.cards ?? [])
				.filter((c) => c.taskId === alert.taskId && c.owner === 'captain' && awaitsAnswer(c))
				.slice(0, CARDS_PER_ALERT);
		}
		for (const channel of targets) {
			const live = this.live.get(channel);
			const { paired, titlesOnly } = this.settings[channel];
			if (!live || !paired) continue;
			const drafts: Draft[] = cards.length
				? cards.map((c) =>
						cardDraft(c, titlesOnly, {
							buttons: live.adapter.limits.buttons,
							wheelhouse: this.deps.wheelhouseUrl ?? null
						})
					)
				: [alertDraft(alert, titlesOnly)];
			for (const d of drafts) await this.post(channel, live.adapter, paired, d, null, alert.kind);
		}
	}

	/**
	 * Send a draft, split to the channel's limit, its buttons on the last
	 * piece; returns where that piece went, or null when it could not be sent.
	 */
	private async post(
		channel: GatewayChannel,
		adapter: ChannelAdapter,
		to: Peer,
		draft: Draft,
		replyTo: SentRef | null = null,
		what = 'notice'
	): Promise<SentRef | null> {
		const record = this.deps.record;
		const actions = draft.actions.slice(0, adapter.limits.buttons);
		const tokens = actions.map((a) => record.grant(channel, a.action, BUTTON_TTL_MS));
		const buttons: OutboundButton[] = [
			...actions.map((a, i) => ({ label: a.label, token: tokens[i], style: a.style })),
			...draft.links.map((l) => ({ label: l.label, url: l.url }))
		].slice(0, adapter.limits.buttons);
		const pieces = splitText(draft.text, adapter.limits.text);
		const peer: Peer = { id: to.id, dm: to.dm };
		let ref: SentRef | null = null;
		try {
			for (let i = 0; i < pieces.length; i++) {
				const last = i === pieces.length - 1;
				ref = await adapter.send(peer, {
					text: pieces[i],
					buttons: last && buttons.length ? buttons : undefined,
					replyTo: i === 0 ? replyTo : null
				});
			}
		} catch (e) {
			record.revoke(tokens);
			this.log(channel, { event: 'error', what, reason: (e as Error).message });
			return null;
		}
		if (!ref) return null;
		record.attach(tokens, ref);
		record.addSent({
			channel,
			ref,
			taskId: draft.taskId,
			at: new Date(this.now()).toISOString(),
			// Kept only where a button may settle the message later.
			text: tokens.length ? pieces[pieces.length - 1] : '',
			links: draft.links.filter((l) => buttons.some((b) => 'url' in b && b.url === l.url))
		});
		await record.save();
		this.log(channel, { event: 'send', from: to.id, id: ref.id, taskId: draft.taskId, what });
		return ref;
	}
}

function notice(text: string): Draft {
	return { text, taskId: null, actions: [], links: [] };
}
