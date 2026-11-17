import { page } from '$app/state';
import {
	aboutWhat,
	askedTheScribe,
	mmss,
	packMessage,
	plainNote,
	quickPack,
	timelineLines,
	type Note,
	type Pack,
	type PackIssue,
	type PagePart,
	type Remark,
	type ReviewEvent,
	type Turn
} from '$lib/livereview';
import { sendToInbox } from './chat.svelte';
import { SESSION_HEADER } from './messages';

/**
 * One live review session (see lib/livereview.ts), run by the review's panel
 * on the page under review (ReviewDock, framed by the recorder the proxy adds
 * to the page): the recorder's messages, comments on a part the captain
 * picked, push-to-talk with the browser's speech recogniser, the scribe's
 * notes and answers, the screenshots, and the pack. The page can load again
 * (a link to another page of it), and the panel with it: the session is kept
 * in this tab (`save`, `restore`) and carries on.
 */

/** Whether live review sessions (the experimental `livereview` feature) are on, as the layout read it. */
export const liveReviewOn = (): boolean =>
	(page.data.features as { livereview?: boolean } | undefined)?.livereview === true;

/**
 * Where a task's preview opens for a live review: the page itself, through the
 * recording proxy, with the review's panel leading back to this page.
 */
export const liveReviewHref = (
	taskId: string,
	back = location.pathname + location.search
): string => `/tasks/${encodeURIComponent(taskId)}/live?back=${encodeURIComponent(back)}`;

/** What the recorder in the page sends (see server/livereview/recorder.js). */
interface FrameMessage {
	__wh: 1;
	rect?: { x: number; y: number; w: number; h: number };
	on?: boolean;
	n?: number;
	type: string;
	url?: string;
	title?: string;
	el?: PagePart | null;
	at?: { x: number; y: number };
	vw?: number;
	vh?: number;
	value?: string | null;
	length?: number;
	how?: string;
	pct?: number;
	kind?: string;
	message?: string;
	key?: string;
	down?: boolean;
	id?: string;
	image?: string | null;
	text?: string;
}

export interface Shot {
	id: string;
	t: number;
	image: string | null;
	vw: number;
	vh: number;
	el: PagePart | null;
	/** Where a click landed, marked when the part clicked has gone by the time of the shot. */
	point: { x: number; y: number; vw: number } | null;
	pending: boolean;
}

export interface ConvoItem extends Turn {
	t: number;
	/** The remark (for the captain's words), or the remark answered (for the scribe's). */
	uid: string;
	error?: boolean;
}

export interface PackPoint extends PackIssue {
	key: string;
	include: boolean;
	el: PagePart | null;
	shotId: string | null;
	page: string;
	t: number;
}

export interface PackView {
	summary: string;
	points: PackPoint[];
	openQuestions: string[];
	errors: string[];
	duration: number;
	from: 'notes' | 'scribe';
	tidying: boolean;
	better: Pack | null;
	tidyFailed: string | null;
	edited: boolean;
	sending: boolean;
	sent: { dir: string } | null;
	error: string | null;
}

interface Hearing {
	t0: number;
	t1: number;
	finals: string;
	interim: string;
	hover: (PagePart & { t: number }) | null;
	shotId: string | null;
	pointShot: string | null;
	done?: boolean;
	dropped?: boolean;
}

interface Recogniser {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult:
		| ((e: {
				resultIndex: number;
				results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
		  }) => void)
		| null;
	onerror: ((e: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}

const TAP_MS = 260;
const DOUBLE_TAP_MS = 450;

/** The browser's speech recogniser, when it has one. */
function recogniser(): (new () => Recogniser) | null {
	const w = globalThis as unknown as Record<string, unknown>;
	return ((w.SpeechRecognition ?? w.webkitSpeechRecognition) as new () => Recogniser) ?? null;
}

const pathOf = (u: string | undefined) => {
	const x = URL.parse(u ?? '');
	return x ? x.pathname + x.hash || '/' : u || '/';
};

export class LiveReviewSession {
	readonly taskId: string;
	readonly title: string;
	readonly token: string;

	/** The preview's own address (the captain uses the recorded copy of it). */
	previewUrl = '';
	problem = $state<string | null>(null);
	on = $state(false);
	paused = $state(false);
	started = 0;
	now = $state(0);

	mode = $state<'talk' | 'notes'>('talk');
	speak = $state(true);
	mask = $state(true);
	shootClicks = $state(true);

	events = $state<ReviewEvent[]>([]);
	remarks = $state<Remark[]>([]);
	notes = $state<Note[]>([]);
	convo = $state<ConvoItem[]>([]);
	shots = $state.raw<Record<string, Shot>>({});
	fresh = $state<string[]>([]);
	heard = $state('');
	page = $state('/');

	talking = $state(false);
	locked = $state(false);
	hearing = $state<{ finals: string; interim: string } | null>(null);
	scribeSays = $state<string | null>(null);
	notesBusy = $state(false);
	replyBusy = $state(false);
	speaking = $state(false);
	notice = $state<string | null>(null);

	pack = $state<PackView | null>(null);
	/** Marking areas of the page (the page dims and takes no input meanwhile). */
	marking = $state(false);
	/** Waiting for the captain to pick the part of the page a comment is about. */
	picking = $state(false);
	/** The part picked, for the comment being written. */
	picked = $state<{ el: PagePart; shotId: string } | null>(null);

	readonly canHear = recogniser() !== null;

	private peer: Window | null = null;
	private origin = '';
	private hover: (PagePart & { t: number }) | null = null;
	private pageText: { url: string; title: string; text: string; at: number } | null = null;
	private ev = 0;
	private ut = 0;
	private sh = 0;
	private lastShotAt = 0;
	private rec: Recogniser | null = null;
	private cur: Hearing | null = null;
	private pressAt = 0;
	private lastTap = 0;
	private chord = false;
	private quietEnd = false;
	private notesAgain = false;
	private replyNext: Remark | null = null;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a private cache, never drawn
	private outlinedCache = new Map<string, Promise<string | null>>();
	private clock: ReturnType<typeof setInterval> | null = null;

	constructor(task: { id: string; title: string }, token: string) {
		this.taskId = task.id;
		this.title = task.title;
		this.token = token;
	}

	private async call<T>(
		body: object
	): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
		try {
			const r = await fetch(`/api/tasks/${encodeURIComponent(this.taskId)}/livereview`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: this.token },
				body: JSON.stringify(body)
			});
			const data = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
			if (!r.ok || !data)
				return { ok: false, error: data?.message ?? `Wheelhouse answered ${r.status}.` };
			return { ok: true, value: data };
		} catch {
			return { ok: false, error: 'Could not reach the Wheelhouse server.' };
		}
	}

	/** The page under review (its window and origin), and the preview's own address. */
	connect(peer: Window | null, origin: string, previewUrl: string) {
		this.peer = peer;
		this.origin = origin;
		this.previewUrl = previewUrl;
	}

	private toFrame(msg: Record<string, unknown>) {
		if (this.origin) this.peer?.postMessage({ __wh: 1, ...msg }, this.origin);
	}

	get elapsed() {
		return this.on ? this.now - this.started : 0;
	}
	private t() {
		return this.started ? Date.now() - this.started : 0;
	}

	/** Whether there is anything to end: a recording, or comments. */
	get canDone() {
		return !this.pack && (this.on || this.remarks.length > 0);
	}

	/* ------------------------------------------------------- start and stop */

	start() {
		this.on = true;
		this.paused = false;
		this.started = Date.now();
		this.now = this.started;
		this.clock = setInterval(() => (this.now = Date.now()), 1000);
		this.addEvent({ type: 'start', label: `Started on ${this.page}` });
		this.toFrame({ type: 'record', on: true, mask: this.mask });
		this.toFrame({ type: 'gettext' });
	}

	setPaused(paused: boolean) {
		if (!this.on || this.paused === paused) return;
		if (paused) this.stopTalking();
		if (paused && this.marking) this.mark(false);
		this.paused = paused;
		this.toFrame({ type: 'record', on: !paused, mask: this.mask });
		this.addEvent({
			type: 'pause',
			label: paused ? 'Paused the recording' : 'Carried on recording'
		});
	}

	setMask(mask: boolean) {
		this.mask = mask;
		if (this.on) this.toFrame({ type: 'record', on: !this.paused, mask });
	}

	setMode(mode: 'talk' | 'notes') {
		this.mode = mode;
		if (mode === 'notes') this.hush();
	}

	/** Stop everything: the mic, the voice, the recorder and the clock. */
	close() {
		this.stopTalking(true);
		if (this.marking) this.mark(false);
		this.hush();
		this.toFrame({ type: 'record', on: false });
		this.on = false;
		if (this.clock) clearInterval(this.clock);
	}

	private stopTalking(drop = false) {
		if (this.locked) {
			this.quietEnd = true;
			this.locked = false;
		}
		if (this.talking) this.release(drop);
	}

	/* --------------------------------------------- what the recorder reports */

	private addEvent(e: Omit<ReviewEvent, 'id' | 't' | 'page'> & { page?: string }): ReviewEvent {
		const ev: ReviewEvent = { id: `e${++this.ev}`, t: this.t(), page: this.page, ...e };
		this.events.push(ev);
		return this.events[this.events.length - 1];
	}

	/** A message from the window, when it is the recorded preview's. */
	receive(e: MessageEvent) {
		if (!this.peer || e.source !== this.peer || e.origin !== this.origin) return;
		const m = e.data as FrameMessage;
		if (!m || m.__wh !== 1) return;
		if (m.type === 'hello') {
			const moved = this.on && pathOf(m.url) !== this.page;
			this.page = pathOf(m.url);
			if (this.on) {
				this.toFrame({ type: 'record', on: !this.paused, mask: this.mask });
				if (moved && !this.paused) this.addEvent({ type: 'nav', label: `Opened ${this.page}` });
			}
			return;
		}
		if (m.type === 'key') return this.frameKey(m);
		if (m.type === 'marking') {
			this.marking = !!m.on;
			return;
		}
		if (m.type === 'picked') {
			this.picking = false;
			const el = m.el ?? null;
			if (!this.started) this.started = Date.now();
			this.picked = el ? { el, shotId: this.shoot(el.selector, el.text) } : null;
			return;
		}
		if (m.type === 'text') {
			this.pageText = {
				url: m.url ?? '',
				title: m.title ?? '',
				text: m.text ?? '',
				at: Date.now()
			};
			return;
		}
		if (m.type === 'shot' && m.id) {
			const s = this.shots[m.id];
			if (!s) return;
			this.shots = {
				...this.shots,
				[m.id]: {
					...s,
					image: m.image ?? null,
					vw: m.vw ?? 0,
					vh: m.vh ?? 0,
					el: m.el ?? s.el,
					pending: false
				}
			};
			return;
		}
		if (!this.on || this.paused) return;
		if (m.url) this.page = pathOf(m.url);
		switch (m.type) {
			case 'click': {
				const ev = this.addEvent({
					type: 'click',
					label: `Clicked ${m.el?.label ?? 'a spot on the page'}`,
					el: m.el ?? null
				});
				if (this.shootClicks && Date.now() - this.lastShotAt > 900) {
					this.lastShotAt = Date.now();
					// After the page has reacted to the click.
					setTimeout(() => {
						ev.shotId = this.shoot(
							m.el?.selector ?? null,
							m.el?.text ?? null,
							m.at ? { ...m.at, vw: m.vw ?? 0 } : null
						);
					}, 350);
				}
				break;
			}
			case 'input':
				this.addEvent({
					type: 'input',
					label: `Typed ${m.value ? `“${m.value}”` : `${m.length ?? 0} characters`} in ${m.el?.label ?? 'a box'}`,
					el: m.el ?? null
				});
				break;
			case 'choose':
				this.addEvent({
					type: 'choose',
					label: `Set ${m.el?.label ?? 'a choice'} to ${m.value}`,
					el: m.el ?? null
				});
				break;
			case 'nav':
				this.addEvent({ type: 'nav', label: `Went to ${pathOf(m.url)}` });
				this.toFrame({ type: 'gettext' });
				break;
			case 'scroll': {
				const last = this.events[this.events.length - 1];
				if (last?.type === 'scroll' && this.t() - last.t < 4000) {
					last.label = `Scrolled to ${m.pct}%`;
					last.t = this.t();
				} else this.addEvent({ type: 'scroll', label: `Scrolled to ${m.pct}%` });
				break;
			}
			case 'area': {
				// An area the captain marked: outlined on its screenshot, and what they say links to it.
				if (!m.rect) break;
				const el: PagePart = {
					label: m.n ? `marked area ${m.n}` : 'the area you marked',
					text: '',
					tag: 'area',
					selector: '',
					rect: m.rect
				};
				const ev = this.addEvent({
					type: 'mark',
					label: `Marked ${el.label} on ${this.page}`,
					el
				});
				ev.shotId = this.shoot(null, null, null, el);
				break;
			}
			case 'hover':
				this.hover = m.el ? { ...m.el, t: this.t() } : null;
				break;
			case 'error':
				this.addEvent({
					type: 'error',
					label:
						m.kind === 'network'
							? `Request failed: ${m.message}`
							: `${m.kind === 'console' ? 'Console error' : 'Error'}: ${m.message}`
				});
				break;
		}
	}

	/** Take a screenshot of what is in view, finding the part again (only if it still says the same). */
	private shoot(
		selector: string | null,
		text: string | null,
		point: Shot['point'] = null,
		el: PagePart | null = null
	): string {
		const id = `s${++this.sh}`;
		this.shots = {
			...this.shots,
			[id]: { id, t: this.t(), image: null, vw: 0, vh: 0, el, point, pending: true }
		};
		this.toFrame({ type: 'shoot', id, selector, text });
		setTimeout(() => {
			const s = this.shots[id];
			if (s?.pending) this.shots = { ...this.shots, [id]: { ...s, pending: false } };
		}, 8000);
		return id;
	}

	/** A screenshot with the part it is about outlined and the rest dimmed; or where the click landed. */
	outlined(shotId: string | null): Promise<string | null> {
		const s = shotId ? this.shots[shotId] : null;
		if (!s?.image) return Promise.resolve(null);
		const key = `${s.id}:${s.image.length}`;
		const known = this.outlinedCache.get(key);
		if (known) return known;
		const made = new Promise<string | null>((resolve) => {
			const img = new Image();
			img.onload = () => {
				const c = document.createElement('canvas');
				c.width = img.width;
				c.height = img.height;
				const g = c.getContext('2d');
				if (!g) return resolve(s.image);
				g.drawImage(img, 0, 0);
				const k = img.width / (s.vw || img.width);
				const r = s.el?.rect;
				if (r && r.w > 0) {
					const pad = 6 * k;
					const [x, y, w, h] = [r.x * k - pad, r.y * k - pad, r.w * k + pad * 2, r.h * k + pad * 2];
					g.fillStyle = 'rgba(11,17,24,.38)';
					g.beginPath();
					g.rect(0, 0, c.width, c.height);
					g.roundRect(x, y, w, h, 6 * k);
					g.fill('evenodd');
					g.strokeStyle = '#e8b04a';
					g.lineWidth = Math.max(3, 3 * k);
					g.beginPath();
					g.roundRect(x, y, w, h, 6 * k);
					g.stroke();
				} else if (s.point) {
					const pk = img.width / (s.point.vw || s.vw || img.width);
					g.strokeStyle = '#e8b04a';
					g.lineWidth = Math.max(3, 3 * pk);
					g.beginPath();
					g.arc(s.point.x * pk, s.point.y * pk, 16 * pk, 0, Math.PI * 2);
					g.stroke();
				}
				resolve(c.toDataURL('image/jpeg', 0.85));
			};
			img.onerror = () => resolve(null);
			img.src = s.image!;
		});
		this.outlinedCache.set(key, made);
		return made;
	}

	/* --------------------------------------------------------- push to talk */

	private newHearing(): Hearing {
		const hover = this.hover && this.t() - this.hover.t < 20000 ? { ...this.hover } : null;
		return {
			t0: this.t(),
			t1: 0,
			finals: '',
			interim: '',
			hover,
			shotId: this.shoot(hover?.selector ?? null, hover?.text ?? null),
			pointShot: null
		};
	}

	press() {
		if (!this.on || this.paused || this.talking) return;
		this.talking = true;
		this.pressAt = Date.now();
		this.chord = false;
		this.hush();
		this.toFrame({ type: 'gettext' });
		this.toFrame({ type: 'talking', on: true });
		this.cur = this.newHearing();
		this.hearing = { finals: '', interim: '' };
		this.listen(this.cur);
	}

	/** Held long enough to count as talking, for the on-screen button (not a tap). */
	pressHeld() {
		this.press();
		this.pressAt = Date.now() - 1000;
	}

	private listen(first: Hearing) {
		const SR = recogniser();
		if (!SR) return;
		const rec = new SR();
		rec.lang = navigator.language || 'en-GB';
		rec.continuous = true;
		rec.interimResults = true;
		this.rec = rec;
		let u = first;
		rec.onresult = (e) => {
			let interim = '';
			for (let i = e.resultIndex; i < e.results.length; i++) {
				const r = e.results[i];
				if (r.isFinal) {
					u.finals += (u.finals ? ' ' : '') + r[0].transcript.trim();
					// Hands-free: each settled sentence is a remark of its own.
					if (this.locked && this.rec === rec) {
						u.interim = '';
						u.t1 = this.t();
						this.finish(u);
						u = this.newHearing();
						this.cur = u;
					}
				} else interim += r[0].transcript;
			}
			u.interim = interim;
			// “This” or “here”: what the pointer is on now is what they mean; catch it.
			if (
				!u.pointShot &&
				this.hover &&
				/\b(this|here|that one|these)\b/i.test(`${u.finals} ${interim}`)
			) {
				u.hover = { ...this.hover };
				u.pointShot = this.shoot(this.hover.selector, this.hover.text);
			}
			if (this.talking && this.cur === u) this.hearing = { finals: u.finals, interim: u.interim };
		};
		rec.onerror = (e) => {
			if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
				this.notice = 'The microphone is blocked for this page. Type to the scribe instead.';
			else if (e.error === 'network')
				this.notice =
					'The browser’s speech service could not be reached. Type to the scribe instead.';
		};
		rec.onend = () => {
			if (this.talking && this.locked && this.rec === rec) {
				try {
					rec.start();
				} catch {
					// already started again
				}
				return;
			}
			if (this.rec === rec) this.rec = null;
			this.finish(u);
		};
		try {
			rec.start();
		} catch {
			this.notice = 'The browser would not start listening. Type to the scribe instead.';
		}
	}

	release(drop = false) {
		if (!this.talking || !this.cur) return;
		this.talking = false;
		this.hearing = null;
		this.toFrame({ type: 'talking', on: false });
		const rec = this.rec;
		const u = this.cur;
		this.rec = null;
		u.t1 = this.t();
		const stop = (how: 'stop' | 'abort') => {
			try {
				rec?.[how]();
			} catch {
				// not listening
			}
		};
		const held = Date.now() - this.pressAt;
		if (drop || this.chord) {
			u.dropped = true;
			stop('abort');
			return;
		}
		if (!this.locked && held < TAP_MS && !u.finals && !u.interim) {
			// A tap, not a hold: two taps in a row keep the mic on.
			u.dropped = true;
			stop('abort');
			if (Date.now() - this.lastTap < DOUBLE_TAP_MS) {
				this.lastTap = 0;
				this.setLocked(true);
			} else this.lastTap = Date.now();
			return;
		}
		// The last words settle after the mic stops; the remark finishes when they have, or soon after.
		if (rec) {
			stop('stop');
			setTimeout(() => this.finish(u), 2500);
		} else this.finish(u);
	}

	setLocked(on: boolean) {
		this.locked = on;
		if (on && !this.talking) this.pressHeld();
		else if (!on && this.talking) {
			this.quietEnd = true;
			this.release();
		}
	}

	/**
	 * The talk key, from the panel or forwarded by the recorder: Space, held for
	 * 2 seconds (so it counts as talking at once, never as a tap).
	 */
	keyDown() {
		if (!this.on) return;
		if (this.locked) return this.setLocked(false);
		this.pressHeld();
	}
	keyUp() {
		if (this.on && !this.locked) this.release();
	}
	/** Another key while the talk key is held: it was a shortcut, not talking. */
	chorded() {
		if (this.talking && !this.locked) {
			this.chord = true;
			this.release();
		}
	}
	private frameKey(m: FrameMessage) {
		if (m.key === 'talk') {
			if (m.down) this.keyDown();
			else this.keyUp();
		} else if (m.key === 'chord') this.chorded();
		else if (m.key === 'mark') this.mark();
	}

	private finish(u: Hearing) {
		if (u.done || u.dropped) return;
		u.done = true;
		const text = `${u.finals} ${u.interim}`.replace(/\s+/g, ' ').trim();
		const quiet = this.quietEnd;
		this.quietEnd = false;
		if (!text) {
			if (!quiet && !this.locked)
				this.notice = 'Didn’t catch anything. Keep talking a little longer before you let go.';
			return;
		}
		this.addRemark(text, u.t0, u.t1 || this.t(), u.hover, u.pointShot ?? u.shotId);
	}

	/** Mark areas of the page: the page dims, takes no input, and each drag marks one. */
	mark(on = !this.marking) {
		if (on && (!this.on || this.paused)) return;
		this.marking = on;
		this.toFrame({ type: 'mark', on });
	}

	/** Pick a part of the page for a comment (the page outlines what is under the pointer). */
	pick(on = true) {
		this.picking = on;
		this.toFrame({ type: 'pick', on });
	}

	/**
	 * A comment: a remark about the part picked (or the page as a whole), at
	 * any time, recording or not. The scribe files it with the rest; Done turns
	 * it into a point of the pack.
	 */
	comment(text: string) {
		const words = text.trim();
		if (!words) return;
		if (!this.started) this.started = Date.now();
		const t = this.t();
		const picked = this.picked;
		const u: Remark = {
			id: `u${++this.ut}`,
			t0: t,
			t1: t + 600,
			text: words,
			page: this.page,
			anchor: null,
			pointing: picked?.el ?? null,
			shotId: picked?.shotId ?? this.shoot(null, null)
		};
		this.remarks.push(u);
		this.convo.push({ who: 'captain', text: words, t, uid: u.id });
		this.picked = null;
		if (this.on) void this.askNotes();
	}

	/* --------------------------------------------- kept across page loads */

	/** The session as it stands, to carry on with after the page loads again. */
	save(): string {
		const keep = (images: boolean) =>
			JSON.stringify({
				v: 1,
				on: this.on,
				paused: this.paused,
				started: this.started,
				mode: this.mode,
				speak: this.speak,
				mask: this.mask,
				shootClicks: this.shootClicks,
				page: this.page,
				events: this.events,
				remarks: this.remarks,
				notes: this.notes,
				convo: this.convo,
				shots: images
					? this.shots
					: Object.fromEntries(
							Object.entries(this.shots).map(([k, v]) => [k, { ...v, image: null }])
						),
				pack: this.pack,
				picked: this.picked,
				counts: [this.ev, this.ut, this.sh]
			});
		const whole = keep(true);
		// Screenshots are the bulk; past what a tab keeps, the session goes without them.
		return whole.length < 4_000_000 ? whole : keep(false);
	}

	/** Carry on with a session `save` kept. */
	restore(raw: string | null) {
		let d: Record<string, unknown> | null = null;
		try {
			d = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
		} catch {
			d = null;
		}
		if (!d || d.v !== 1) return;
		this.paused = !!d.paused;
		this.started = Number(d.started) || 0;
		this.mode = d.mode === 'notes' ? 'notes' : 'talk';
		this.speak = d.speak !== false;
		this.mask = d.mask !== false;
		this.shootClicks = d.shootClicks !== false;
		this.page = typeof d.page === 'string' ? d.page : '/';
		this.events = (d.events as ReviewEvent[]) ?? [];
		this.remarks = (d.remarks as Remark[]) ?? [];
		this.notes = (d.notes as Note[]) ?? [];
		this.convo = (d.convo as ConvoItem[]) ?? [];
		this.shots = (d.shots as Record<string, Shot>) ?? {};
		this.pack = (d.pack as PackView | null) ?? null;
		if (this.pack) this.pack.sending = false;
		this.picked = (d.picked as { el: PagePart; shotId: string } | null) ?? null;
		const [ev, ut, sh] = (d.counts as number[]) ?? [0, 0, 0];
		[this.ev, this.ut, this.sh] = [ev || 0, ut || 0, sh || 0];
		if (d.on) {
			this.on = true;
			this.now = Date.now();
			this.clock = setInterval(() => (this.now = Date.now()), 1000);
		}
	}

	/** A typed remark, the same as a spoken one. */
	type(text: string) {
		const words = text.trim();
		if (!words || !this.on || this.paused) return;
		const t = this.t();
		this.toFrame({ type: 'gettext' });
		const hover = this.hover;
		this.addRemark(
			words,
			t - 1500,
			t,
			hover,
			this.shoot(hover?.selector ?? null, hover?.text ?? null)
		);
	}

	private addRemark(
		text: string,
		t0: number,
		t1: number,
		hover: (PagePart & { t: number }) | null,
		shotId: string | null
	) {
		const a = aboutWhat(this.events, text, t0, t1, hover);
		const u: Remark = {
			id: `u${++this.ut}`,
			t0,
			t1: Math.max(t1, t0 + 600),
			text,
			page: this.page,
			anchor: 'ev' in a ? a.ev.id : null,
			pointing: 'pointing' in a ? a.pointing : null,
			shotId: 'ev' in a && a.ev.shotId ? a.ev.shotId : shotId
		};
		this.remarks.push(u);
		this.convo.push({ who: 'captain', text, t: t0, uid: u.id });
		this.heard = '';
		void this.askNotes();
		if (this.mode === 'talk') void this.askReply(u);
	}

	/** What the remark or event `id` is about, in words, and with which screenshot. */
	about(n: Note): {
		el: PagePart | null;
		shotId: string | null;
		page: string;
		t: number;
		clicked: boolean;
	} {
		const u = this.remarks.find((r) => n.utterances.includes(r.id));
		const ev = this.events.find((e) => e.id === (n.anchor || u?.anchor));
		return {
			el: ev?.el ?? u?.pointing ?? null,
			shotId: ev?.shotId ?? u?.shotId ?? null,
			page: ev?.page ?? u?.page ?? '',
			t: u?.t0 ?? ev?.t ?? 0,
			clicked: !!ev
		};
	}

	/** Point the page at a part again (a note clicked). */
	highlight(selector: string | null | undefined) {
		if (selector) this.toFrame({ type: 'highlight', selector });
	}

	/* ------------------------------------------------------------- the scribe */

	private async askNotes() {
		if (this.notesBusy) {
			this.notesAgain = true;
			return;
		}
		this.notesBusy = true;
		this.notesAgain = false;
		const r = await this.call<{ notes: Note[]; heard: string }>({
			action: 'notes',
			timeline: timelineLines(this.events, this.remarks),
			notes: this.notes
		});
		this.notesBusy = false;
		if (!this.on) return;
		if (r.ok) {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local lookup
			const before = new Map(this.notes.map((n) => [n.id, n.text]));
			this.notes = r.value.notes;
			this.fresh = r.value.notes.filter((n) => before.get(n.id) !== n.text).map((n) => n.id);
			this.heard = r.value.heard;
		} else
			this.notice = `The scribe could not take notes just then (${r.error}). It will try again with your next remark.`;
		if (this.notesAgain) void this.askNotes();
	}

	private async askReply(u: Remark) {
		if (this.replyBusy) {
			this.replyNext = u;
			return;
		}
		this.replyBusy = true;
		// The page's text was asked for when the captain began talking; give it a moment to arrive.
		for (let i = 0; i < 6 && !(this.pageText && Date.now() - this.pageText.at < 15000); i++)
			await new Promise((r) => setTimeout(r, 100));
		const r = await this.call<{ reply: string }>({
			action: 'reply',
			said: u.text,
			page: this.pageText,
			timeline: timelineLines(this.events, this.remarks),
			notes: this.notes.map((n) => n.text),
			convo: this.convo
				.filter((c) => c.uid !== u.id || c.who === 'scribe')
				.map(({ who, text }) => ({ who, text }))
		});
		this.replyBusy = false;
		if (!this.on) return;
		const next = this.replyNext;
		this.replyNext = null;
		// A newer remark is waiting: answer that instead of this one.
		if (next) return void this.askReply(next);
		if (r.ok && r.value.reply) {
			this.convo.push({ who: 'scribe', text: r.value.reply, t: this.t(), uid: u.id });
			this.say(r.value.reply);
		} else if (!r.ok) {
			this.convo.push({
				who: 'scribe',
				text: `I couldn’t answer just then (${r.error}) but I noted what you said.`,
				t: this.t(),
				uid: u.id,
				error: true
			});
		}
	}

	/** Say it: as a caption over the page, and out loud unless that is switched off. */
	private say(text: string) {
		this.scribeSays = text;
		const synth = globalThis.speechSynthesis;
		if (!this.speak || !synth) {
			setTimeout(
				() => {
					if (this.scribeSays === text) this.scribeSays = null;
				},
				Math.max(4000, text.split(' ').length * 380)
			);
			return;
		}
		synth.cancel();
		const ut = new SpeechSynthesisUtterance(text);
		const voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
		ut.voice =
			voices.find((v) =>
				/Google UK English Female|Daniel|Serena|Kate|Samantha|Google US English/.test(v.name)
			) ??
			voices[0] ??
			null;
		ut.rate = 1.04;
		ut.onstart = () => (this.speaking = true);
		ut.onend = ut.onerror = () => {
			this.speaking = false;
			setTimeout(() => {
				if (!this.speaking && this.scribeSays === text) this.scribeSays = null;
			}, 1200);
		};
		synth.speak(ut);
	}

	/** Stop the scribe talking (the captain talks over it). */
	hush() {
		globalThis.speechSynthesis?.cancel();
		this.speaking = false;
		this.scribeSays = null;
	}

	/* --------------------------------------------------------------- the pack */

	private point(issue: PackIssue, i: number): PackPoint {
		const n = this.notes.find((x) => issue.notes.includes(x.id));
		const a = n ? this.about(n) : null;
		const ev = this.events.find((e) => e.id === issue.anchor);
		return {
			...issue,
			key: `p${i}`,
			include: true,
			el: ev?.el ?? a?.el ?? null,
			shotId: ev?.shotId ?? a?.shotId ?? null,
			page: ev?.page ?? a?.page ?? '',
			t: a?.t ?? ev?.t ?? 0
		};
	}

	private view(p: Pack, from: PackView['from'], duration: number): PackView {
		const order = { must: 0, should: 1, could: 2, none: 3 };
		return {
			summary: p.summary,
			points: p.issues
				.map((x, i) => this.point(x, i))
				.sort((a, b) => order[a.severity] - order[b.severity]),
			openQuestions: p.openQuestions,
			errors: [
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local list
				...new Set(
					this.events
						.filter((e) => e.type === 'error')
						.map((e) => `${mmss(e.t)} on ${e.page}: ${e.label}`)
				)
			],
			duration,
			from,
			tidying: false,
			better: null,
			tidyFailed: null,
			edited: false,
			sending: false,
			sent: null,
			error: null
		};
	}

	/**
	 * End: the pack opens at once from the notes as they stand (with every
	 * remark the scribe has not filed yet, but not the questions it answered),
	 * and the scribe's tidier version replaces it when it arrives, unless the
	 * captain has started editing.
	 */
	async end() {
		this.stopTalking();
		if (this.marking) this.mark(false);
		this.hush();
		this.paused = true;
		this.toFrame({ type: 'record', on: false });
		const duration = this.t();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookups
		const filed = new Set(this.notes.flatMap((n) => n.utterances));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local lookups
		const answered = new Set(
			this.convo.filter((c) => c.who === 'scribe' && !c.error).map((c) => c.uid)
		);
		const loose = this.remarks
			.filter((u) => !filed.has(u.id) && !(answered.has(u.id) && askedTheScribe(u.text)))
			.map((u, i) =>
				plainNote(
					`q${i + 1}`,
					u,
					(u.anchor ? this.events.find((e) => e.id === u.anchor)?.el?.label : u.pointing?.label) ??
						null
				)
			);
		const notes = [...this.notes, ...loose];
		this.notes = notes;
		const mine = this.view(quickPack(notes, { title: this.title, duration }), 'notes', duration);
		mine.tidying = this.remarks.length > 0;
		this.pack = mine;
		if (!mine.tidying) return;
		const r = await this.call<Pack>({
			action: 'pack',
			timeline: timelineLines(this.events, this.remarks),
			notes
		});
		const now = this.pack;
		if (!now || now.sent || now.sending) return;
		now.tidying = false;
		if (r.ok && r.value.issues?.length) {
			if (now.edited) now.better = r.value;
			else this.pack = this.view(r.value, 'scribe', duration);
		} else now.tidyFailed = r.ok ? 'no points' : r.error;
	}

	useBetter() {
		if (this.pack?.better) this.pack = this.view(this.pack.better, 'scribe', this.pack.duration);
	}

	/** Back to the session after a look at the pack. */
	resume() {
		this.pack = null;
		this.setPaused(false);
	}

	stats() {
		return {
			remarks: this.remarks.length,
			clicks: this.events.filter((e) => e.type === 'click').length,
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a count
			pages: new Set(this.events.map((e) => e.page).filter(Boolean)).size,
			shots: Object.values(this.shots).filter((s) => s.image).length
		};
	}

	/** The message as Firstmate will get it (`files`: where the screenshots and session were kept). */
	message(files: { session: string; shots: Record<string, string> } | null): string {
		const p = this.pack;
		if (!p) return '';
		const st = this.stats();
		return packMessage(
			{ id: this.taskId, title: this.title },
			this.previewUrl,
			{ duration: p.duration, ...st },
			{
				summary: p.summary,
				lines: p.points
					.filter((x) => x.include)
					.map((x) => ({
						severity: x.severity,
						title: x.title,
						detail: x.detail,
						where: x.el
							? `${x.el.label}${x.page ? ` on ${x.page}` : ''}`
							: x.page
								? `the page ${x.page}`
								: null,
						quote: x.quote,
						at: mmss(x.t),
						shot: x.shotId
							? files
								? (files.shots[x.shotId] ?? null)
								: `(screenshot ${x.shotId})`
							: null
					})),
				errors: p.errors,
				openQuestions: p.openQuestions
			},
			files?.session ?? null
		);
	}

	/** Keep the session and its outlined screenshots as files, then send the pack to Firstmate. */
	async send(): Promise<boolean> {
		const p = this.pack;
		if (!p || p.sending || p.sent) return false;
		p.sending = true;
		p.error = null;
		const shots: Record<string, string> = {};
		for (const x of p.points.filter((x) => x.include && x.shotId)) {
			const url = await this.outlined(x.shotId);
			if (url) shots[x.shotId!] = url;
		}
		const saved = await this.call<{ dir: string; session: string; shots: Record<string, string> }>({
			action: 'save',
			session: {
				task: { id: this.taskId, title: this.title },
				preview: this.previewUrl,
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a timestamp
				startedAt: new Date(this.started).toISOString(),
				events: this.events,
				remarks: this.remarks,
				notes: this.notes,
				conversation: this.convo.map(({ who, text, t }) => ({ who, text, at: mmss(t) }))
			},
			shots
		});
		if (!saved.ok) {
			p.sending = false;
			p.error = saved.error;
			return false;
		}
		const sent = await sendToInbox(this.message(saved.value), this.token, this.taskId);
		p.sending = false;
		if (!sent.ok) {
			p.error = sent.error;
			return false;
		}
		p.sent = { dir: saved.value.dir };
		return true;
	}
}
