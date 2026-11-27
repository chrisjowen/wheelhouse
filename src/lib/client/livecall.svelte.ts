import { SESSION_HEADER } from '$lib/client/messages';
import {
	isEcho,
	forSpeech,
	nextSentences,
	parseReply,
	readBlock,
	speakableProse,
	type Visual
} from '$lib/live/reply';
import { dictationEngine, type DictationSession } from '$lib/voice/engine';
import { BROWSER, type VoiceView } from '$lib/voice/settings';
import type { CatchUpItem } from '$lib/live/catchup';
import { reportForCrew, scoutRequest } from '$lib/live/scout';
import {
	briefKey,
	briefMessage,
	discussionOf,
	keepDiscussion,
	parseKept,
	readBrief,
	type SaidLine
} from '$lib/live/briefing';
import { decisionDrafts } from './decisiondrafts.svelte';

/**
 * Live mode: a conversation with a discussion crew member while Firstmate
 * keeps the watch, on a screen of its own (LiveView). This holds the call.
 * The captain types, and the crew's replies stream in from /api/live. Voice
 * is off when a call starts; turned on (setVoice), replies are spoken a
 * sentence at a time (the provider chosen in Settings → Voice, else the
 * browser) and the captain is heard by the browser's recogniser, and, when a
 * provider hears too, by that provider from a recorded clip. Push to talk
 * (hold Space) or always on; either way, talking over the crew stops it and
 * the newest words are answered. Ending asks the crew for the Captain's
 * briefing and sends it to Firstmate straight away, as the captain's message:
 * that briefing is all the chat shows of the call, and the discussion is kept
 * in this browser for its "Show the discussion" (keptDiscussion).
 *
 * What the crew passes on to Firstmate is held as a hand-off card the captain
 * sends now or deletes; whatever is still waiting goes with the briefing (or
 * is discarded on Just quit), unless Settings → Discussion sends it straight
 * away. A scout, asked for by the captain or offered by the crew and OK'd on
 * its card, goes to Firstmate as a labelled captain's message; Wheelhouse
 * watches for the scout's task and report and brings the report back into the
 * conversation.
 */

export type LiveState =
	| 'off'
	| 'starting'
	| 'ready'
	| 'listening'
	| 'hearing'
	| 'transcribing'
	| 'thinking'
	| 'speaking'
	| 'muted'
	| 'ending';

export type InputMode = 'ptt' | 'always';

export interface CrewReply {
	kind: 'crew';
	id: string;
	at: string;
	/** Everything the crew has written, blocks included. */
	text: string;
	/** How much of the spoken prose has been said. */
	spoken: number;
	/** How much of the spoken prose has been queued to be said. */
	queued: number;
	streaming: boolean;
	interrupted: boolean;
	/** Drawn blocks, in order, read once each is complete. */
	visuals: Visual[];
	/** Server turn id; null until /say answers. */
	turn: string | null;
}

export type LiveEntry =
	| { kind: 'notice'; id: string; at: string; text: string }
	| {
			kind: 'captain';
			id: string;
			at: string;
			text: string;
			how: 'voice' | 'provider' | 'typed' | 'fixed';
			pending: boolean;
	  }
	| CrewReply
	| {
			kind: 'brief';
			id: string;
			at: string;
			briefing: string | null;
			/** The captain quit without asking for a briefing. */
			quit?: boolean;
			minutes: number;
			catchUp: CatchUpItem[];
			fleet: { live: number; decisions: number };
			/** Hand-offs still waiting when the call ended, attached word for word. */
			handoffs: string[];
			sent: boolean;
	  }
	| { kind: 'writing'; id: string; at: string; briefing: boolean }
	/** A scout the captain asked for from the composer, or a scout's report coming in. */
	| { kind: 'scout'; id: string; at: string; scout: string; report: boolean };

/**
 *   pending    held: goes with the briefing unless sent now or deleted
 *   sending    on its way to Firstmate
 *   sent       sent to Firstmate during the call
 *   failed     could not be sent; still goes with the briefing
 *   deleted    the captain deleted it
 *   briefing   attached to the briefing, which is not sent yet
 *   briefed    sent with the briefing
 *   discarded  the captain just quit
 */
export type HandoffState =
	'pending' | 'sending' | 'sent' | 'failed' | 'deleted' | 'briefing' | 'briefed' | 'discarded';

export interface Handoff {
	/** `<reply id>:<block index>`. */
	key: string;
	note: string;
	state: HandoffState;
	/** Sent at once because Settings → Discussion says so. */
	direct: boolean;
}

/**
 *   offered    the crew suggested it; waiting for the captain's OK
 *   declined   the captain said not now
 *   sending    the request is on its way to Firstmate
 *   failed     the request could not be sent
 *   requested  Firstmate has the request; no scout task seen yet
 *   running    the scout's task is under way
 *   reported   its report is in
 */
export type ScoutState =
	'offered' | 'declined' | 'sending' | 'failed' | 'requested' | 'running' | 'reported';

export interface Scout {
	/** `<reply id>:<block index>` for one the crew put up, else the entry's id. */
	key: string;
	ref: string;
	question: string;
	/** The captain asked for it (rather than OK'ing the crew's offer). */
	asked: boolean;
	state: ScoutState;
	sentAt: number;
	task: string | null;
	title: string | null;
	statusLabel: string | null;
	summary: string | null;
	report: string | null;
	/** The report has been given to the crew. */
	told: boolean;
}

/** Hand-offs that still go with the briefing. */
const WAITING: HandoffState[] = ['pending', 'failed'];
const SCOUT_POLL_MS = 15_000;
const SCOUT_WATCH_MS = 3 * 60 * 60_000;
const handoffText = (note: string) =>
	`Hand-off from a Live mode discussion in Wheelhouse (passed on by the discussion crew):\n\n${note}`;

interface Prefs {
	input: InputMode;
	headphones: boolean;
	speed: number;
}

const PREFS_KEY = 'wheelhouse.live.prefs';
const nowIso = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);

function loadPrefs(): Prefs {
	const fallback: Prefs = { input: 'ptt', headphones: false, speed: 1 };
	try {
		const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
		return {
			input: raw.input === 'always' ? 'always' : 'ptt',
			headphones: raw.headphones === true,
			speed: typeof raw.speed === 'number' && raw.speed >= 0.7 && raw.speed <= 1.3 ? raw.speed : 1
		};
	} catch {
		return fallback;
	}
}

interface SpeechItem {
	text: string;
	reply: CrewReply | null;
	/** The provider's audio, fetched as soon as the sentence is queued. */
	audio: Promise<Blob | null> | null;
}

export class LiveCall {
	state = $state<LiveState>('off');
	entries = $state<LiveEntry[]>([]);
	/** Words heard so far in this utterance: settled, then still forming. */
	heard = $state({ settled: '', forming: '' });
	prefs = $state<Prefs>({ input: 'ptt', headphones: false, speed: 1 });
	voice = $state<VoiceView | null>(null);
	startedAt = $state(0);
	/** When the last call ended (ms), so the chat keeps it where it happened; 0 while none has. */
	endedAt = $state(0);
	model = $state('');
	context = $state('');
	problem = $state<string | null>(null);
	pressing = $state(false);
	/** The captain asked to end and is choosing between a briefing and just quitting. */
	choosingEnd = $state(false);
	/** Whether the call now ending asked for a briefing. */
	briefing = $state(true);
	/** What the crew passed on to Firstmate during the call. */
	handoffs = $state<Handoff[]>([]);
	/** Scouts asked for or offered during the call. */
	scouts = $state<Scout[]>([]);
	/** Documents the captain brought into the call: attached in full, and listed by title. */
	docs = $state<{ attached: string[]; listed: string[] }>({ attached: [], listed: [] });
	/** Settings → Discussion: hold hand-offs for the captain, or send them at once. */
	handoffMode = $state<'hold' | 'direct'>('hold');
	/** Live mode's screen is up: from the start of a call until it ends, or the captain steps out to the app. */
	shown = $state(false);
	/** Talking and listening out loud; off when a call starts. */
	voiceOn = $state(false);
	/** Sends a captain's message to Firstmate through the chat; set by the chat. */
	toFirstmate: ((text: string) => Promise<boolean>) | null = null;

	private token = '';
	private id: string | null = null;
	private events: EventSource | null = null;
	private active: CrewReply | null = null;
	private early: { turn: string; events: { type: string; text?: string; ok?: boolean }[] }[] = [];
	// Speech out
	private queue: SpeechItem[] = [];
	private current: SpeechItem | null = null;
	private gen = 0;
	private player: HTMLAudioElement | null = null;
	private recent: { text: string; at: number } | null = null;
	// Speech in
	private session: DictationSession | null = null;
	private consumed = 0;
	private commitTimer: ReturnType<typeof setTimeout> | null = null;
	private utterStart = 0;
	private stream: MediaStream | null = null;
	private audioCtx: AudioContext | null = null;
	private micAnalyser: AnalyserNode | null = null;
	private outAnalyser: AnalyserNode | null = null;
	private recorder: { mr: MediaRecorder; chunks: Blob[]; t0: number } | null = null;
	private pulse = 0;
	private loudSince = 0;
	private scoutTimer: ReturnType<typeof setTimeout> | null = null;

	get on() {
		return this.state !== 'off';
	}

	/** How loud whoever is talking is now, 0–1, for the meter. */
	level(): number {
		const read = (a: AnalyserNode | null) => {
			if (!a) return 0;
			const buf = new Float32Array(a.fftSize);
			a.getFloatTimeDomainData(buf);
			let s = 0;
			for (const v of buf) s += v * v;
			return Math.min(
				1,
				Math.max(0, (20 * Math.log10(Math.sqrt(s / buf.length) + 1e-6) + 52) / 34)
			);
		};
		if (this.state === 'speaking') {
			this.pulse *= 0.96;
			return Math.max(this.player ? read(this.outAnalyser) : 0, this.pulse, 0.12);
		}
		const listening = this.prefs.input === 'always' ? this.state !== 'muted' : this.pressing;
		const lvl = listening ? read(this.micAnalyser) : 0;
		this.headphoneBargeIn(lvl);
		return lvl;
	}

	// ---------------------------------------------------------------- the call

	/**
	 * Start the call and bring up Live mode; `about` opens it on one decision
	 * (the Decisions page's Talk it through in Live), which the crew reads in
	 * full first. With a call already on, Live mode comes back up and the
	 * decision is raised in it instead.
	 */
	async start(token: string, about: { decision: string; title: string } | null = null) {
		if (this.on) {
			this.shown = true;
			if (about)
				this.type(
					`Let's talk through the decision "${about.title}" (decision id ${about.decision}).`
				);
			return;
		}
		this.token = token;
		this.prefs = loadPrefs();
		this.shown = true;
		this.voiceOn = false;
		this.entries = [];
		this.handoffs = [];
		this.scouts = [];
		this.docs = { attached: [], listed: [] };
		this.problem = null;
		this.endedAt = 0;
		this.state = 'starting';
		this.note(
			'Live mode: a discussion crew member joins to talk this through with you. Firstmate stays on watch.'
		);
		const r = await this.post('/api/live', about ? { decision: about.decision } : {});
		const body = (await r?.json().catch(() => null)) as {
			id?: string;
			model?: string;
			context?: string;
			handoffs?: 'hold' | 'direct';
			message?: string;
			knows?: { live: number; decisions: number };
		} | null;
		if (!r?.ok || !body?.id) {
			this.problem = body?.message ?? 'The discussion crew could not start.';
			this.note(this.problem);
			this.close();
			return;
		}
		this.id = body.id;
		this.model = body.model ?? '';
		this.context = body.context ?? '';
		this.handoffMode = body.handoffs === 'direct' ? 'direct' : 'hold';
		this.startedAt = Date.now();
		this.events = new EventSource(`/api/live/${body.id}/events`);
		this.events.onmessage = (m) => this.onEvent(JSON.parse(m.data));
		this.state = this.idle();
		this.applyInput();
		const k = body.knows ?? { live: 0, decisions: 0 };
		const greet: CrewReply = this.crew();
		greet.text = about
			? `I've read “${about.title}” and what it rests on. Where would you like to start? Or I can take you through the calls that matter most.`
			: `I'm here and I've read the fleet: ${k.live} under way, ${k.decisions} decision${k.decisions === 1 ? '' : 's'} waiting on you. What's on your mind?`;
		greet.streaming = false;
		this.active = greet;
		this.feedSpeech(greet, true);
	}

	/**
	 * End the call: with a briefing, the crew writes the Captain's briefing;
	 * without, it just stops. Either way the fleet's changes are summed up.
	 */
	async end(briefing = true) {
		if (!this.on || this.state === 'ending') return;
		const id = this.id;
		this.choosingEnd = false;
		this.briefing = briefing;
		this.stopSpeech();
		this.stopListening();
		this.state = 'ending';
		if (!id) return this.close();
		const writing: LiveEntry = { kind: 'writing', id: uid(), at: nowIso(), briefing };
		this.entries.push(writing);
		const waiting = this.handoffs.filter((h) => WAITING.includes(h.state));
		const notes = (states: HandoffState[]) =>
			this.handoffs.filter((h) => states.includes(h.state)).map((h) => h.note);
		const r = await this.post(`/api/live/${id}/end`, {
			brief: briefing,
			handoffs: {
				pending: waiting.map((h) => h.note),
				sent: notes(['sent', 'sending']),
				deleted: notes(['deleted'])
			},
			scouts: this.scouts
				.filter((s) => !['offered', 'declined', 'failed'].includes(s.state))
				.map((s) => s.question)
		});
		for (const h of waiting) h.state = briefing ? 'briefing' : 'discarded';
		const body = (await r?.json().catch(() => null)) as Omit<
			Extract<LiveEntry, { kind: 'brief' }>,
			'kind' | 'id' | 'at' | 'sent'
		> | null;
		// By id: the entry in the list is the state's proxy, never `writing` itself.
		this.entries = this.entries.filter((e) => e.id !== writing.id);
		if (body)
			this.entries.push({
				kind: 'brief',
				id: uid(),
				at: nowIso(),
				sent: false,
				...body,
				handoffs: briefing ? waiting.map((h) => h.note) : [],
				catchUp: body.catchUp ?? []
			});
		else
			this.note(
				briefing
					? 'The discussion ended, but the briefing could not be written.'
					: 'The discussion ended.'
			);
		this.close();
		const brief = this.entries[this.entries.length - 1];
		// The briefing goes to Firstmate at once; sent, Live mode steps aside and the chat shows it.
		if (brief?.kind === 'brief' && (brief.briefing || brief.handoffs.length)) {
			if (await this.sendBrief(brief)) this.shown = false;
		} else if (!briefing) this.shown = false;
	}

	/**
	 * Send the briefing to Firstmate as the captain's message, keeping the
	 * discussion in this browser for the chat's "Show the discussion".
	 */
	async sendBrief(entry: Extract<LiveEntry, { kind: 'brief' }>): Promise<boolean> {
		const text = this.briefText(entry);
		const ok = (await this.toFirstmate?.(text)) ?? false;
		if (!ok) return false;
		this.markSent(entry);
		keepDiscussionHere(briefKey(readBrief(text)?.body ?? text), discussionOf(this.entries));
		return true;
	}

	/** Out of Live mode's screen, to the app; a call still on carries on and the header brings it back. */
	stepOut() {
		this.shown = false;
	}

	/** Back to Live mode's screen while a call is on. */
	stepIn() {
		if (this.on) this.shown = true;
	}

	/** Put away what is left of an ended call (a briefing that could not be sent, or a failed start). */
	dismiss() {
		if (!this.on) this.shown = false;
	}

	/** Raise a decision in the discussion (the captain picked it in Live mode). */
	discussDecision(card: { id: string; title: string }) {
		this.type(`Let's talk through the decision "${card.title}" (decision id ${card.id}).`);
	}

	// ---------------------------------------------------------------- voice

	/** Turn talking out loud on or off; turned on by a click, so the browser lets it use the microphone and speak. */
	async setVoice(on: boolean) {
		if (on === this.voiceOn || !this.on || this.state === 'ending') return;
		this.voiceOn = on;
		if (!on) {
			this.stopSpeech();
			this.cancel();
			this.stopListening();
			this.closeMicrophone();
			if (this.state !== 'thinking' && this.state !== 'starting') this.state = this.idle();
			return;
		}
		this.problem = null;
		// Unlock audio on the click that turned voice on.
		if (typeof speechSynthesis !== 'undefined') {
			const warm = new SpeechSynthesisUtterance(' ');
			warm.volume = 0;
			speechSynthesis.speak(warm);
		}
		// What was already said is not read out: only what comes next.
		for (const e of this.entries)
			if (e.kind === 'crew') e.spoken = e.queued = speakableProse(e.text).length;
		await Promise.all([this.openMicrophone(), this.refreshVoice()]);
		if (!this.voiceOn || !this.on) return this.closeMicrophone();
		// The call may have moved on while the microphone opened.
		if (!(['starting', 'ending'] as LiveState[]).includes(this.state)) this.applyInput();
	}

	private close() {
		this.choosingEnd = false;
		this.events?.close();
		this.events = null;
		this.id = null;
		this.stopSpeech();
		this.stopListening();
		this.closeMicrophone();
		this.voiceOn = false;
		this.endedAt = Date.now();
		this.state = 'off';
	}

	private closeMicrophone() {
		this.stream?.getTracks().forEach((t) => t.stop());
		this.stream = null;
		this.micAnalyser = null;
		void this.audioCtx?.close().catch(() => {});
		this.audioCtx = null;
		this.outAnalyser = null;
	}

	setPrefs(next: Partial<Prefs>) {
		this.prefs = { ...this.prefs, ...next };
		try {
			localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
		} catch {
			// a private window keeps no preferences
		}
		if (this.on && this.state !== 'starting' && this.state !== 'ending') this.applyInput();
	}

	async refreshVoice() {
		this.voice = await fetch('/api/voice')
			.then((r) => (r.ok ? (r.json() as Promise<VoiceView>) : this.voice))
			.catch(() => this.voice);
	}

	/** The captain typed instead of talking. */
	type(text: string) {
		const t = text.trim();
		if (t) void this.send(t, 'typed');
	}

	/**
	 * Bring documents into the discussion: `full` attached in full (up to a
	 * size limit), `titles` listed by title with the file the crew can open.
	 * References are records (`<project>/<task>`), `lib:<key>` and `proto:<id>`.
	 */
	async addDocuments(full: string[], titles: string[]): Promise<string | null> {
		if (!this.id) return 'No Live discussion is open.';
		const r = await this.post('/api/documents/briefing', { full, titles });
		const body = (await r?.json().catch(() => null)) as {
			text?: string;
			attached?: string[];
			listed?: string[];
			cut?: string[];
		} | null;
		if (!r?.ok || !body?.text) return 'Those documents could not be read.';
		const attached = body.attached ?? [];
		const listed = body.listed ?? [];
		const add = (to: string[], more: string[]) => [...to, ...more.filter((t) => !to.includes(t))];
		this.docs = {
			attached: add(this.docs.attached, attached),
			listed: add(this.docs.listed, listed)
		};
		const said = [
			attached.length ? `attached in full: ${attached.join(', ')}` : '',
			listed.length ? `listed by title: ${listed.join(', ')}` : '',
			body.cut?.length ? `too long to attach, so listed: ${body.cut.join(', ')}` : ''
		].filter(Boolean);
		this.note(`Documents for the crew, ${said.join('; ')}.`);
		void this.send(body.text, 'typed', true);
		return null;
	}

	/** The captain corrected what was heard: the crew answers the corrected words instead. */
	fix(entry: Extract<LiveEntry, { kind: 'captain' }>, text: string) {
		const t = text.trim();
		if (!t || t === entry.text) return;
		const before = entry.text;
		entry.text = t;
		entry.how = 'fixed';
		void this.send(
			`(Correction: speech recognition got my last words wrong. I said "${t}", not "${before}". Answer that instead.)`,
			'fixed',
			true
		);
	}

	markSent(entry: Extract<LiveEntry, { kind: 'brief' }>) {
		entry.sent = true;
		for (const h of this.handoffs) if (h.state === 'briefing') h.state = 'briefed';
	}

	/** The briefing as the captain's message, with the hand-offs still waiting attached. */
	briefText(e: Extract<LiveEntry, { kind: 'brief' }>): string {
		return briefMessage(e);
	}

	/** Hand-offs that would go with the briefing, or be lost on Just quit. */
	get waitingHandoffs(): number {
		return this.handoffs.filter((h) => WAITING.includes(h.state)).length;
	}

	// ---------------------------------------------------------------- hand-offs and scouts

	handoff(key: string): Handoff | null {
		return this.handoffs.find((h) => h.key === key) ?? null;
	}

	scout(key: string): Scout | null {
		return this.scouts.find((s) => s.key === key) ?? null;
	}

	/** Send a hand-off to Firstmate now, as the captain's message. */
	async sendHandoff(key: string) {
		const h = this.handoff(key);
		if (!h || !['pending', 'failed'].includes(h.state)) return;
		h.state = 'sending';
		const ok = (await this.toFirstmate?.(handoffText(h.note))) ?? false;
		h.state = ok ? 'sent' : 'failed';
	}

	deleteHandoff(key: string) {
		const h = this.handoff(key);
		if (h && WAITING.includes(h.state)) h.state = 'deleted';
	}

	/** Undo a delete while the call is on. */
	restoreHandoff(key: string) {
		const h = this.handoff(key);
		if (h?.state === 'deleted' && this.on) h.state = 'pending';
	}

	/** The captain asked for a scout from the composer. */
	askScout(question: string) {
		const q = question.trim();
		if (!q || !this.id) return;
		const id = uid();
		this.entries.push({ kind: 'scout', id, at: nowIso(), scout: id, report: false });
		this.addScout(id, q, true);
		void this.send(
			`(Wheelhouse, not the captain speaking: the captain just sent a scout on this question: "${q}". Acknowledge it in a few words; you will hear when its report is in.)`,
			'typed',
			true
		);
	}

	/** The captain OK'd the crew's offer of a scout. */
	approveScout(key: string) {
		const s = this.scout(key);
		if (s && (s.state === 'offered' || s.state === 'failed')) void this.requestScout(s);
	}

	declineScout(key: string) {
		const s = this.scout(key);
		if (s?.state === 'offered') s.state = 'declined';
	}

	private addScout(key: string, question: string, asked: boolean): Scout {
		const ref = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) =>
			b.toString(16).padStart(2, '0')
		).join('');
		this.scouts.push({
			key,
			ref,
			question,
			asked,
			state: asked ? 'sending' : 'offered',
			sentAt: 0,
			task: null,
			title: null,
			statusLabel: null,
			summary: null,
			report: null,
			told: false
		});
		const s = this.scouts[this.scouts.length - 1];
		if (asked) void this.requestScout(s);
		return s;
	}

	private async requestScout(s: Scout) {
		s.state = 'sending';
		s.sentAt = Date.now();
		const ok =
			(await this.toFirstmate?.(
				scoutRequest({ ref: s.ref, question: s.question, session: this.id })
			)) ?? false;
		s.state = ok ? 'requested' : 'failed';
		if (ok) this.watchScouts();
	}

	/** Look for the scouts' tasks and reports until each report is in. */
	private watchScouts() {
		if (this.scoutTimer) return;
		const tick = async () => {
			this.scoutTimer = null;
			const watched = (s: Scout) =>
				(s.state === 'requested' || s.state === 'running') &&
				Date.now() - s.sentAt < SCOUT_WATCH_MS;
			const untold = (s: Scout) => !!this.id && s.state === 'reported' && !s.told;
			const open = this.scouts.filter(watched);
			const q = open.map((s) => `scout=${s.ref}:${s.sentAt}`).join('&');
			const body = (await (open.length ? fetch(`/api/live/scouts?${q}`) : Promise.reject())
				.then((r) => (r.ok ? r.json() : null))
				.catch(() => null)) as {
				scouts?: Record<
					string,
					{
						task: string;
						title: string;
						statusLabel: string;
						report: { summary: string; text: string } | null;
					} | null
				>;
			} | null;
			for (const s of open) {
				const found = body?.scouts?.[s.ref];
				if (!found) continue;
				s.task = found.task;
				s.title = found.title;
				s.statusLabel = found.statusLabel;
				if (found.report) {
					s.state = 'reported';
					s.summary = found.report.summary;
					s.report = found.report.text;
					this.entries.push({
						kind: 'scout',
						id: uid(),
						at: nowIso(),
						scout: s.key,
						report: true
					});
				} else s.state = 'running';
			}
			this.tellReports();
			if (this.scouts.some((s) => watched(s) || untold(s)))
				this.scoutTimer = setTimeout(() => void tick(), open.length ? SCOUT_POLL_MS : 3000);
		};
		this.scoutTimer = setTimeout(() => void tick(), 4000);
	}

	/** Give the crew a report that is in, once it is not talking or being talked to. */
	private tellReports() {
		if (!this.id || !['ready', 'listening', 'muted'].includes(this.state) || this.current) return;
		const s = this.scouts.find((x) => x.state === 'reported' && !x.told && x.report && x.task);
		if (!s) return;
		s.told = true;
		void this.send(
			reportForCrew({ question: s.question, task: s.task!, report: s.report! }),
			'typed',
			true
		);
	}

	/** What a talk about a decision came to, by reply block, once each (bookkeeping, not shown). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private decided = new Set<string>();

	/** New hand-offs, scouts and decision outcomes among a reply's blocks. */
	private takeUp(reply: CrewReply, index: number, visual: Visual) {
		const key = `${reply.id}:${index}`;
		if (visual.kind === 'decision' && !this.decided.has(key)) {
			this.decided.add(key);
			decisionDrafts.put(visual.decision, visual);
			return;
		}
		if (visual.kind === 'passon' && !this.handoff(key)) {
			const direct = this.handoffMode === 'direct';
			this.handoffs.push({ key, note: visual.note, state: 'pending', direct });
			if (direct) void this.sendHandoff(key);
		} else if (visual.kind === 'scout' && !this.scout(key))
			this.addScout(key, visual.question, visual.asked);
	}

	// ---------------------------------------------------------------- talking to the crew

	private crew(): CrewReply {
		const r: CrewReply = {
			kind: 'crew',
			id: uid(),
			at: nowIso(),
			text: '',
			spoken: 0,
			queued: 0,
			streaming: true,
			interrupted: false,
			visuals: [],
			turn: null
		};
		this.entries.push(r);
		return this.entries[this.entries.length - 1] as CrewReply;
	}

	private note(text: string) {
		this.entries.push({ kind: 'notice', id: uid(), at: nowIso(), text });
	}

	private async send(
		text: string,
		how: Extract<LiveEntry, { kind: 'captain' }>['how'],
		silent = false
	) {
		if (!this.id) return;
		if (this.active) this.bargeIn();
		if (!silent)
			this.entries.push({ kind: 'captain', id: uid(), at: nowIso(), text, how, pending: false });
		const reply = this.crew();
		this.active = reply;
		this.state = 'thinking';
		const r = await this.post(`/api/live/${this.id}/say`, { text });
		const body = (await r?.json().catch(() => null)) as { turn?: string } | null;
		if (this.active !== reply) return;
		if (!body?.turn) {
			reply.streaming = false;
			reply.text = 'The crew did not answer. Try again, or end the discussion.';
			this.state = this.idle();
			return;
		}
		reply.turn = body.turn;
		const held = this.early.find((e) => e.turn === body.turn);
		this.early = this.early.filter((e) => e !== held);
		for (const e of held?.events ?? []) this.onEvent({ ...e, turn: body.turn });
	}

	private onEvent(e: { type: string; turn?: string; text?: string; ok?: boolean; error?: string }) {
		if (e.type === 'gone') {
			if (this.on && this.state !== 'ending') {
				this.note('The discussion crew stopped.');
				this.close();
			}
			return;
		}
		const reply = this.active;
		if (!reply || !e.turn) return;
		if (reply.turn === null) {
			let held = this.early.find((x) => x.turn === e.turn);
			if (!held) this.early.push((held = { turn: e.turn, events: [] }));
			held.events.push(e);
			return;
		}
		if (e.turn !== reply.turn) return;
		if (e.type === 'delta' && e.text) {
			reply.text += e.text;
			this.readVisuals(reply);
			this.feedSpeech(reply, false);
		} else if (e.type === 'done') {
			reply.streaming = false;
			if (!reply.text.trim() && !reply.interrupted) {
				// Shown, not spoken: a voice reading out an error helps no one.
				reply.text = e.error
					? `I couldn’t answer: ${e.error}`
					: 'I couldn’t answer that. Try again?';
				reply.queued = reply.spoken = reply.text.length;
			}
			this.readVisuals(reply);
			this.feedSpeech(reply, true);
			if (!this.current && !this.queue.length) {
				this.state = this.idle();
				this.tellReports();
			}
		}
	}

	private readVisuals(reply: CrewReply) {
		const closed = parseReply(reply.text).filter((p) => p.type === 'block' && p.closed);
		for (let i = reply.visuals.length; i < closed.length; i++) {
			const p = closed[i] as Extract<(typeof closed)[number], { type: 'block' }>;
			const visual = readBlock(p.lang, p.body);
			reply.visuals.push(visual);
			this.takeUp(reply, i, visual);
		}
	}

	/** Speak each complete sentence of the reply's prose as soon as it is there. */
	private feedSpeech(reply: CrewReply, final: boolean) {
		const prose = speakableProse(reply.text);
		// Voice off: shown, never spoken.
		if (!this.voiceOn) {
			reply.queued = reply.spoken = prose.length;
			return;
		}
		const blockFollows = parseReply(reply.text).some((p) => p.type === 'block');
		const { sentences, to } = nextSentences(prose, reply.queued, final || blockFollows);
		reply.queued = to;
		for (const s of sentences) this.speak(s, reply);
	}

	/** The captain talked over the crew: stop speaking and stop its answer. */
	private bargeIn() {
		const reply = this.active;
		const live = reply && (reply.streaming || this.speakingFor(reply));
		this.stopSpeech();
		if (reply && live) {
			reply.interrupted = true;
			reply.streaming = false;
			if (this.id) void this.post(`/api/live/${this.id}/interrupt`, {});
		}
		this.active = null;
	}

	private speakingFor(reply: CrewReply) {
		return this.current?.reply === reply || this.queue.some((q) => q.reply === reply);
	}

	// ---------------------------------------------------------------- speech out

	private provider(): string {
		return this.voice?.effective.speak ?? BROWSER;
	}

	private speak(text: string, reply: CrewReply | null) {
		const said = forSpeech(text);
		if (!said) {
			if (reply) reply.spoken += text.length;
			return;
		}
		const item: SpeechItem = { text, reply, audio: null };
		if (this.provider() !== BROWSER) item.audio = this.fetchAudio(said);
		this.queue.push(item);
		this.pump();
	}

	private async fetchAudio(text: string): Promise<Blob | null> {
		const r = await this.post('/api/voice/speak', { text, speed: this.prefs.speed });
		if (!r || r.status !== 200) return null;
		return r.blob().catch(() => null);
	}

	private pump() {
		if (this.current || !this.queue.length) return;
		const item = this.queue.shift()!;
		const gen = this.gen;
		this.current = item;
		const finish = () => {
			if (gen !== this.gen || this.current !== item) return;
			if (item.reply) item.reply.spoken += item.text.length;
			this.recent = {
				text: `${this.recent && Date.now() - this.recent.at < 4000 ? this.recent.text : ''} ${item.text}`,
				at: Date.now()
			};
			this.current = null;
			this.player = null;
			if (this.queue.length) this.pump();
			else if (item.reply?.streaming) this.state = 'thinking';
			else if (this.state === 'speaking' || this.state === 'thinking') {
				this.state = this.idle();
				this.tellReports();
			}
		};
		const browser = () => {
			if (gen !== this.gen) return;
			if (typeof speechSynthesis === 'undefined') return finish();
			const u = new SpeechSynthesisUtterance(forSpeech(item.text));
			const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
			u.voice =
				['Google UK English Male', 'Daniel', 'Google UK English Female', 'Serena', 'Samantha']
					.map((n) => voices.find((v) => v.name.includes(n)))
					.find(Boolean) ?? null;
			u.rate = this.prefs.speed * 1.05;
			u.onstart = () => {
				if (gen === this.gen) this.state = 'speaking';
			};
			u.onboundary = () => (this.pulse = 0.45 + Math.random() * 0.35);
			const guard = setTimeout(finish, 4000 + item.text.length * 110);
			u.onend = u.onerror = () => {
				clearTimeout(guard);
				finish();
			};
			speechSynthesis.speak(u);
		};
		if (!item.audio) return browser();
		void item.audio.then((blob) => {
			if (gen !== this.gen) return;
			if (!blob) return browser();
			const a = new Audio(URL.createObjectURL(blob));
			this.player = a;
			try {
				if (this.audioCtx && this.outAnalyser)
					this.audioCtx.createMediaElementSource(a).connect(this.outAnalyser);
			} catch {
				// the meter falls back to a pulse
			}
			a.onplaying = () => {
				if (gen === this.gen) this.state = 'speaking';
			};
			a.onended = () => {
				URL.revokeObjectURL(a.src);
				finish();
			};
			a.onerror = () => browser();
			a.play().catch(() => browser());
		});
	}

	private stopSpeech() {
		this.gen++;
		this.queue = [];
		this.current = null;
		this.player?.pause();
		this.player = null;
		if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
	}

	// ---------------------------------------------------------------- speech in

	private idle(): LiveState {
		if (!this.voiceOn || this.prefs.input === 'ptt') return 'ready';
		return this.state === 'muted' ? 'muted' : 'listening';
	}

	private hearsWithProvider() {
		return (this.voice?.effective.hear ?? BROWSER) !== BROWSER;
	}

	private async openMicrophone() {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
			});
			this.audioCtx = new AudioContext();
			const src = this.audioCtx.createMediaStreamSource(this.stream);
			this.micAnalyser = this.audioCtx.createAnalyser();
			this.micAnalyser.fftSize = 1024;
			src.connect(this.micAnalyser);
			this.outAnalyser = this.audioCtx.createAnalyser();
			this.outAnalyser.fftSize = 512;
			this.outAnalyser.connect(this.audioCtx.destination);
		} catch {
			this.problem = 'No microphone: you can still type to the crew.';
		}
	}

	/** Start or stop listening to match push to talk or always on. */
	private applyInput() {
		if (!this.voiceOn) {
			if (!this.pressing) this.stopListening();
			if (['ready', 'listening', 'muted'].includes(this.state)) this.state = this.idle();
			return;
		}
		if (this.prefs.input === 'always' && this.state !== 'muted') {
			this.listen();
			if (this.hearsWithProvider() && !this.recorder) this.record();
		} else if (!this.pressing) this.stopListening();
		if (['ready', 'listening', 'muted'].includes(this.state)) this.state = this.idle();
	}

	toggleMute() {
		if (this.prefs.input !== 'always' || !this.on || !this.voiceOn) return;
		if (this.state === 'muted') {
			this.state = 'listening';
			this.applyInput();
		} else {
			this.stopListening();
			this.state = 'muted';
		}
	}

	private listen() {
		if (this.session) return;
		const engine = dictationEngine();
		if (!engine.supported()) return;
		this.consumed = 0;
		this.session = engine.start('en-GB', {
			text: (final, interim) => this.onHeard(final, interim),
			problem: (p) => {
				if (p === 'blocked' || p === 'no-microphone')
					this.problem = 'The microphone is blocked: allow it from the address bar, or type.';
			},
			end: () => {
				this.session = null;
				// Browsers stop listening after a pause; carry on while the call wants to hear.
				const wanted =
					this.on &&
					this.state !== 'ending' &&
					(this.prefs.input === 'always' ? this.state !== 'muted' : this.pressing);
				if (wanted) setTimeout(() => this.listen(), 100);
			}
		});
	}

	private stopListening(keep = false) {
		if (this.commitTimer) clearTimeout(this.commitTimer);
		const s = this.session;
		this.session = null;
		if (keep) s?.stop();
		else s?.abort();
		if (this.recorder) {
			try {
				this.recorder.mr.stop();
			} catch {
				// already stopped
			}
			this.recorder = null;
		}
	}

	private onHeard(final: string, interim: string) {
		const settled = final.slice(this.consumed).trim();
		const fresh = `${settled} ${interim}`.trim();
		if (!fresh || !this.on) return;
		if (this.prefs.input === 'ptt') {
			if (this.pressing) this.heard = { settled, forming: interim };
			return;
		}
		if (this.state === 'muted') return;
		const saying = `${this.current?.text ?? ''} ${this.queue.map((q) => q.text).join(' ')} ${this.recent && Date.now() - this.recent.at < 2500 ? this.recent.text : ''}`;
		if (!this.prefs.headphones && isEcho(fresh, saying)) {
			this.consumed = final.length;
			return;
		}
		const crewTalking = this.state === 'speaking' || !!this.current;
		if (crewTalking) {
			if (fresh.split(/\s+/).length < 2 && !settled) return;
			this.bargeIn();
		} else if (this.state === 'thinking' && fresh.split(/\s+/).length >= 2) this.bargeIn();
		if (!this.utterStart) this.utterStart = performance.now();
		this.heard = { settled, forming: interim };
		this.state = 'hearing';
		if (this.commitTimer) clearTimeout(this.commitTimer);
		this.commitTimer = setTimeout(() => void this.commit(final.length), interim ? 1500 : 850);
	}

	/** Always on: a pause ends the captain's turn. */
	private async commit(upTo: number) {
		const text = `${this.heard.settled} ${this.heard.forming}`.trim();
		this.consumed = Math.max(this.consumed, upTo);
		this.heard = { settled: '', forming: '' };
		const started = this.utterStart;
		this.utterStart = 0;
		if (!text) return;
		if (this.hearsWithProvider() && this.recorder) {
			const rec = this.recorder;
			const from = Math.max(0, (started - rec.t0) / 1000 - 1.6);
			this.recorder = null;
			const clip = this.stopRecorder(rec);
			this.record();
			const better = await this.transcribe(await clip, from, text);
			return this.send(better ?? text, better ? 'provider' : 'voice');
		}
		return this.send(text, 'voice');
	}

	/** Push to talk: Space (or the button) went down. */
	press() {
		if (!this.on || !this.voiceOn || this.pressing || this.prefs.input !== 'ptt' || !this.id)
			return;
		this.pressing = true;
		this.heard = { settled: '', forming: '' };
		if (this.active && (this.active.streaming || this.speakingFor(this.active))) this.bargeIn();
		else this.stopSpeech();
		this.state = 'hearing';
		if (this.hearsWithProvider()) this.record();
		this.listen();
		this.pressedAt = performance.now();
	}
	private pressedAt = 0;

	/** Push to talk: released, so send what was said. */
	/** Push to talk: slid away before letting go, so nothing is sent. */
	cancel() {
		if (!this.pressing) return;
		this.pressing = false;
		const rec = this.recorder;
		this.recorder = null;
		try {
			rec?.mr.stop();
		} catch {
			// already stopped
		}
		const s = this.session;
		this.session = null;
		s?.abort();
		this.heard = { settled: '', forming: '' };
		this.state = this.idle();
	}

	async release() {
		if (!this.pressing) return;
		this.pressing = false;
		const held = performance.now() - this.pressedAt;
		const rec = this.recorder;
		this.recorder = null;
		const clip = rec ? this.stopRecorder(rec) : null;
		const s = this.session;
		this.session = null;
		s?.stop();
		await new Promise((r) => setTimeout(r, 450));
		const text = `${this.heard.settled} ${this.heard.forming}`.trim();
		this.heard = { settled: '', forming: '' };
		if (held < 300 || (!text && !clip)) {
			this.state = this.idle();
			return;
		}
		if (clip) {
			const better = await this.transcribe(await clip, 0, text || '…');
			if (better || text) return this.send(better ?? text, better ? 'provider' : 'voice');
			this.state = this.idle();
			return;
		}
		if (text) return this.send(text, 'voice');
		this.state = this.idle();
	}

	private record() {
		if (!this.stream || typeof MediaRecorder === 'undefined') return;
		const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
			MediaRecorder.isTypeSupported(t)
		);
		const mr = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
		const rec = { mr, chunks: [] as Blob[], t0: performance.now() };
		mr.ondataavailable = (e) => {
			if (e.data.size) rec.chunks.push(e.data);
		};
		mr.start(250);
		this.recorder = rec;
	}

	private stopRecorder(rec: { mr: MediaRecorder; chunks: Blob[] }): Promise<Blob | null> {
		return new Promise((resolve) => {
			rec.mr.onstop = () =>
				resolve(new Blob(rec.chunks, { type: rec.mr.mimeType || 'audio/webm' }));
			try {
				rec.mr.stop();
			} catch {
				resolve(null);
			}
		});
	}

	/** A clip heard by the provider; shows the browser's words as pending meanwhile. */
	private async transcribe(clip: Blob | null, from: number, shown: string): Promise<string | null> {
		if (!clip || clip.size < 1500) return null;
		const pending: LiveEntry = {
			kind: 'captain',
			id: uid(),
			at: nowIso(),
			text: shown,
			how: 'voice',
			pending: true
		};
		this.entries.push(pending);
		this.state = 'transcribing';
		try {
			const r = await fetch(`/api/voice/hear?from=${from.toFixed(2)}`, {
				method: 'POST',
				headers: { 'content-type': clip.type, [SESSION_HEADER]: this.token },
				body: clip
			});
			const body = (await r.json().catch(() => null)) as { text?: string | null } | null;
			return body?.text?.trim() || null;
		} catch {
			return null;
		} finally {
			this.entries = this.entries.filter((e) => e.id !== pending.id);
		}
	}

	/** With headphones on, a sustained voice interrupts the crew at once. */
	private headphoneBargeIn(lvl: number) {
		if (
			!this.prefs.headphones ||
			this.prefs.input !== 'always' ||
			(this.state !== 'speaking' && this.state !== 'thinking')
		) {
			this.loudSince = 0;
			return;
		}
		if (lvl < 0.45) this.loudSince = 0;
		else if (!this.loudSince) this.loudSince = performance.now();
		else if (performance.now() - this.loudSince > 220) {
			this.loudSince = 0;
			this.bargeIn();
			this.state = 'hearing';
		}
	}

	private async post(path: string, body: unknown): Promise<Response | null> {
		try {
			return await fetch(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: this.token },
				body: JSON.stringify(body)
			});
		} catch {
			return null;
		}
	}
}

const KEPT_KEY = 'wheelhouse.live.discussions';

/** Keep a call's discussion in this browser, under its briefing's key. */
function keepDiscussionHere(key: string, lines: SaidLine[]) {
	if (!lines.length) return;
	try {
		const kept = keepDiscussion(parseKept(localStorage.getItem(KEPT_KEY)), key, lines, Date.now());
		localStorage.setItem(KEPT_KEY, JSON.stringify(kept));
	} catch {
		// a private window keeps nothing
	}
}

/** The discussion behind a briefing, when this browser kept it. */
export function keptDiscussion(key: string): SaidLine[] | null {
	try {
		return parseKept(localStorage.getItem(KEPT_KEY))[key]?.lines ?? null;
	} catch {
		return null;
	}
}

/** The one call Live mode holds. */
export const liveCall = new LiveCall();
