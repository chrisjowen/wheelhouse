import { captainMessage, fold, joinChats, type Chat } from '$lib/chat/fold';
import { lastId, unconfirmed, type Pending } from '$lib/chat/outbox';
import { SESSION_HEADER } from '$lib/client/messages';
import { watchedStream, type Connection } from '$lib/client/stream';
import { terminalWait } from '$lib/bell';
import type { Visibility } from '$lib/console';
import type {
	ChatSearchHit,
	FirstmateSessionView,
	SlashCommand,
	TranscriptSource
} from '$lib/types';

/**
 * The home page's live view of the Firstmate session: its status and the
 * transcript records from /api/firstmate/chat (server-sent events), folded into
 * the chat. Also the page's few actions on the session; each posts to
 * Wheelhouse with the launch's session token (checked with the Origin in
 * hooks.server.ts).
 */
/**
 * The most records the page follows live (the server keeps as many for pages that connect
 * later); older ones stay in the page as history.
 */
const MAX_RECORDS = 6000;
/** Records asked for at a time when reading back through the chat archive. */
const PAGE_RECORDS = 1500;
/** The most earlier records the page keeps once the captain is back at the latest; older ones are read again from the archive. */
const HISTORY_RECORDS = 6000;
/** How many of the page's oldest records a read back offers the archive to start from. */
const CURSORS = 8;
/**
 * A page hidden this long lets go of its chat stream (each open tab holds one),
 * and opens it again as soon as it is shown, catching up with the transcript.
 */
export const HIDDEN_CLOSE_MS = 60_000;

/** Where reading back through the chat archive stands. */
export type OlderState = 'unknown' | 'loading' | 'more' | 'none' | 'unavailable' | 'failed';

/* eslint-disable @typescript-eslint/no-explicit-any */

class FirstmateChat {
	session = $state<FirstmateSessionView | null>(null);
	source = $state<TranscriptSource | null>(null);
	/** The live session's records, as the feed sends them. */
	records = $state.raw<Record<string, any>[]>([]);
	/**
	 * Earlier records, oldest first and none of them in `records`: read back from
	 * the chat archive (earlier sessions with their dividers, and the start of a
	 * long session), and the records of sessions this page followed before
	 * Firstmate restarted.
	 */
	history = $state.raw<Record<string, any>[]>([]);
	older = $state<OlderState>('unknown');
	/** Our own connection to the Wheelhouse server. */
	connection = $state<Connection>('connecting');
	/** Bumps when the transcript starts over (a new file), so the page can jump to the end. */
	resets = $state(0);
	/**
	 * Whether this connection has the transcript as it stands yet. Until then the
	 * chat is still filling in, and anything placed in it can still move.
	 */
	synced = $state(false);
	commands = $state<SlashCommand[]>([]);
	private historyIds = $derived(new Set(this.history.map((r) => r.uuid)));
	/** Where history's last turn starts: history is folded once up to there, and the rest with the live records. */
	private cut = $derived(Math.max(0, this.history.findLastIndex(captainMessage)));
	private earlier: Chat = $derived(fold(this.history.slice(0, this.cut)));
	private latest: Chat = $derived(
		fold(
			this.cut < this.history.length
				? [...this.history.slice(this.cut), ...this.records]
				: this.records
		)
	);
	readonly chat: Chat = $derived(joinChats(this.earlier, this.latest));
	/**
	 * Firstmate is mid-turn. Wheelhouse's own session says so from its screen; for another,
	 * the transcript's open turn is the best sign.
	 */
	readonly working: boolean = $derived.by(() => {
		const last = this.chat.items[this.chat.items.length - 1];
		return (
			this.session?.busy === true || (last?.kind === 'turn' && !last.done && !last.interrupted)
		);
	});
	/** Firstmate is at work in Wheelhouse's own session, not waiting on a question, a menu, a sign-in or its terminal. */
	readonly atWork: boolean = $derived(
		this.connection === 'open' &&
			this.session?.state === 'ours' &&
			!this.session.picker &&
			!this.session.menu &&
			!this.session.signIn &&
			!this.session.terminal &&
			this.working
	);
	/** Wheelhouse's own session waits on the captain: a question, a sign-in, or its terminal. */
	readonly needsYou: boolean = $derived(
		this.connection === 'open' &&
			this.session?.state === 'ours' &&
			this.session.canSend &&
			(!!this.session.picker || !!this.session.signIn || !!terminalWait(this.session))
	);
	/** Messages the captain sent from this page that the transcript does not show yet. */
	private outbox = $state<Pending[]>([]);
	readonly pending: Pending[] = $derived(unconfirmed(this.outbox, this.chat.items));

	private close: (() => void) | null = null;
	/** The source of the session whose records last went into history, until the next one starts. */
	private left: string | null = null;
	/** The chat archive has answered, so history it lets go of can be read back from it. */
	private archived = false;

	connect(doc: Visibility | null = typeof document === 'undefined' ? null : document): () => void {
		if (this.close) return () => {};
		const listen = (es: EventSource) => {
			es.addEventListener('session', (e) => {
				this.session = JSON.parse((e as MessageEvent).data);
				this.connection = 'open';
			});
			es.addEventListener('reset', (e) => {
				const next: TranscriptSource | null = JSON.parse((e as MessageEvent).data);
				// A new session: the one before stays, as history, and the new one starts after its divider.
				if (this.records.length && next?.file !== this.source?.file) {
					this.history = [...this.history, ...this.records];
					this.left = this.source?.file ?? null;
				}
				if (next && this.left) {
					if (next.file !== this.left && next.session)
						this.history = [
							...this.history,
							{
								type: 'wh-session',
								uuid: `wh-session:${next.session}`,
								timestamp: new Date().toISOString(),
								first: false
							}
						];
					this.left = null;
				}
				this.source = next;
				this.records = [];
				this.resets++;
			});
			es.addEventListener('records', (e) => {
				const added: Record<string, any>[] = JSON.parse((e as MessageEvent).data);
				this.leaveHistory(added);
				const next = [...this.records, ...added];
				if (next.length > MAX_RECORDS) {
					// A page's worth at a time, so history is folded again only that often.
					const keep = MAX_RECORDS - PAGE_RECORDS;
					this.history = [...this.history, ...next.slice(0, next.length - keep)];
					this.records = next.slice(-keep);
				} else this.records = next;
			});
			es.addEventListener('replace', (e) => {
				const next: Record<string, any>[] = JSON.parse((e as MessageEvent).data);
				this.leaveHistory(next);
				this.records = next.length > MAX_RECORDS ? next.slice(-MAX_RECORDS) : next;
			});
			es.addEventListener('synced', () => (this.synced = true));
		};
		let stream: (() => void) | null = null;
		const open = () => {
			this.synced = false;
			stream = watchedStream('/api/firstmate/chat', listen, (s) => (this.connection = s));
		};
		const shut = () => {
			stream?.();
			stream = null;
			this.connection = 'connecting';
		};
		// A hidden page lets go of its stream after a while; shown again, it opens a fresh one.
		let idle: ReturnType<typeof setTimeout> | undefined;
		const visibility = () => {
			clearTimeout(idle);
			if (!doc) return;
			if (doc.hidden) idle = setTimeout(() => doc.hidden && shut(), HIDDEN_CLOSE_MS);
			else if (!stream) open();
		};
		open();
		doc?.addEventListener('visibilitychange', visibility);
		if (doc?.hidden) visibility();
		this.close = () => {
			clearTimeout(idle);
			doc?.removeEventListener('visibilitychange', visibility);
			stream?.();
			stream = null;
		};
		void this.loadCommands();
		return () => {
			this.close?.();
			this.close = null;
			this.connection = 'connecting';
		};
	}

	/** Everything the page holds, oldest first. */
	get all(): Record<string, any>[] {
		return [...this.history, ...this.records];
	}

	/** Takes out of history what the live records now hold. */
	private leaveHistory(live: Record<string, any>[]) {
		const ids = this.historyIds;
		if (!live.some((r) => r.uuid && ids.has(r.uuid))) return;
		const now = new Set(live.map((r) => r.uuid));
		this.history = this.history.filter((r) => !now.has(r.uuid));
	}

	/**
	 * Lets go of the oldest history beyond HISTORY_RECORDS, from a captain's
	 * message or a divider where it can; reading back reads it again. For when
	 * the captain is back at the latest. Without the archive, history is the only
	 * copy and is all kept.
	 */
	trim() {
		const over = this.history.length - HISTORY_RECORDS;
		if (over <= 0) return;
		// Not read back yet: ask whether the archive holds what would be let go, then trim.
		if (!this.archived) return void this.probeArchive();
		const at = this.history.findIndex(
			(r, i) => i >= over && (captainMessage(r) || r.type === 'wh-session')
		);
		this.history = this.history.slice(at >= 0 ? at : over);
		if (this.older === 'none') this.older = 'more';
	}

	/**
	 * Read back through the chat archive: the records before the earliest this
	 * page has (the newest the archive has, when it has none), and with `until`,
	 * back to that record at least. Answers whether anything was read.
	 */
	async loadOlder(until: string | null = null): Promise<boolean> {
		if (this.older === 'loading' || this.older === 'unavailable') return false;
		if (this.older === 'none' && !until) return false;
		// The oldest records the archive may hold (it keeps no side-chain), and their time should it hold none.
		const oldest = this.cursors();
		const at = oldest.find((r) => r.timestamp)?.timestamp;
		const q = new URLSearchParams([
			['limit', String(PAGE_RECORDS)],
			...oldest.map((r) => ['before', r.uuid]),
			...(at ? [['at', at]] : []),
			...(until ? [['until', until]] : [])
		]);
		this.older = 'loading';
		try {
			const res = await fetch(`/api/firstmate/chat/history?${q}`);
			if (!res.ok) throw new Error(String(res.status));
			const body = (await res.json()) as {
				available: boolean;
				records: Record<string, any>[];
				more: boolean;
			};
			if (!body.available) {
				this.older = 'unavailable';
				this.archived = false;
				return false;
			}
			this.archived = true;
			// The page's oldest records changed meanwhile: what came back may not join on.
			if (this.cursors()[0]?.uuid !== oldest[0]?.uuid) {
				this.older = 'unknown';
				return false;
			}
			const known = new Set(this.all.map((r) => r.uuid));
			const fresh = body.records.filter((r) => !known.has(r.uuid));
			this.history = [...fresh, ...this.history];
			this.older = body.more && fresh.length ? 'more' : 'none';
			return fresh.length > 0;
		} catch {
			this.older = 'failed';
			return false;
		}
	}

	private probing = false;
	/** Whether the chat archive is there, so history it holds can be let go of (and read back). */
	private async probeArchive() {
		if (this.probing || this.older === 'unavailable') return;
		this.probing = true;
		try {
			const res = await fetch('/api/firstmate/chat/history?limit=1');
			if (!res.ok) return;
			const body = (await res.json()) as { available: boolean };
			if (!body.available) this.older = 'unavailable';
			else {
				this.archived = true;
				this.trim();
			}
		} catch {
			// asked again on the next trim
		} finally {
			this.probing = false;
		}
	}

	/** The oldest records the archive may hold (it keeps no side-chain). */
	private cursors() {
		const out: Record<string, any>[] = [];
		for (const r of this.history) if (out.length < CURSORS && r.uuid && !r.isSidechain) out.push(r);
		for (const r of this.records) if (out.length < CURSORS && r.uuid && !r.isSidechain) out.push(r);
		return out;
	}

	/** Whether the page holds a record, by its uuid. */
	has(uuid: string): boolean {
		return this.historyIds.has(uuid) || this.records.some((r) => r.uuid === uuid);
	}

	/** Messages in the chat archive holding every word of `q`, newest first; null when it cannot be searched. */
	async search(q: string): Promise<ChatSearchHit[] | null> {
		try {
			const res = await fetch(`/api/firstmate/chat/search?${new URLSearchParams({ q })}`);
			if (!res.ok) return null;
			const body = (await res.json()) as { available: boolean; hits: ChatSearchHit[] };
			return body.available ? body.hits : null;
		} catch {
			return null;
		}
	}

	/**
	 * Send a message, showing it at once as a pending bubble. `busy`: Firstmate is
	 * mid-turn, so Claude Code queues it until the turn ends.
	 */
	async send(text: string, via: 'session' | 'inbox', token: string, busy: boolean) {
		this.prune();
		this.outbox.push({
			id: crypto.randomUUID(),
			text,
			via,
			state: 'sending',
			error: null,
			after: lastId(this.chat.items)
		});
		return this.deliver(this.outbox[this.outbox.length - 1], token, busy);
	}

	/** Try a failed message again. */
	retry(id: string, token: string, busy: boolean) {
		const p = this.outbox.find((m) => m.id === id);
		if (!p || p.state !== 'failed') return;
		p.after = lastId(this.chat.items);
		void this.deliver(p, token, busy);
	}

	dismiss(id: string) {
		this.outbox = this.outbox.filter((m) => m.id !== id);
	}

	private async deliver(p: Pending, token: string, busy: boolean): Promise<ActionResult> {
		p.state = 'sending';
		p.error = null;
		const r =
			p.via === 'inbox'
				? await sendToInbox(p.text, token)
				: await act('/api/firstmate/input', token, { text: p.text });
		if (r.ok) p.state = busy && p.via === 'session' ? 'queued' : 'delivered';
		else {
			p.state = 'failed';
			p.error = r.error;
		}
		return r;
	}

	/** Forget messages the transcript has since shown. */
	private prune() {
		const shown = new Set(this.pending.map((m) => m.id));
		this.outbox = this.outbox.filter((m) => shown.has(m.id));
	}

	private async loadCommands() {
		try {
			const res = await fetch('/api/firstmate/commands');
			if (res.ok) this.commands = ((await res.json()) as { commands: SlashCommand[] }).commands;
		} catch {
			// the menu stays empty; typing a command still works
		}
	}
}

export const firstmateChat = new FirstmateChat();

/** `pending`: Wheelhouse saved the message but has not confirmed delivery yet (it keeps trying). */
export type ActionResult = { ok: true; pending?: boolean } | { ok: false; error: string };

/** POST to one of the session's endpoints with the session token. */
export async function act(path: string, token: string, body?: unknown): Promise<ActionResult> {
	try {
		const res = await fetch(path, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				[SESSION_HEADER]: token
			},
			body: JSON.stringify(body ?? {})
		});
		if (res.ok) return { ok: true };
		const data = (await res.json().catch(() => null)) as { message?: string } | null;
		return { ok: false, error: data?.message ?? `Wheelhouse answered ${res.status}.` };
	} catch {
		return { ok: false, error: 'Could not reach the Wheelhouse server.' };
	}
}

/**
 * Send to Firstmate's inbox (`fm-inbox.sh note`), for a Firstmate session
 * Wheelhouse cannot type into, or about one task (`taskId`: the note starts
 * `Re: <task-id>` and Firstmate passes it to that task's worker). The request
 * id makes a retry safe: Firstmate keeps one note per id. Pass a stable
 * `requestId` for a note that must go only once, however often it is sent.
 */
export async function sendToInbox(
	text: string,
	token: string,
	taskId: string | null = null,
	requestId: string = `wh-${crypto.randomUUID()}`
): Promise<ActionResult> {
	try {
		const res = await fetch('/api/firstmate/messages', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'idempotency-key': requestId,
				[SESSION_HEADER]: token
			},
			body: JSON.stringify({ text, taskId })
		});
		if (res.ok) return { ok: true, pending: res.status === 202 };
		const data = (await res.json().catch(() => null)) as { message?: string } | null;
		return { ok: false, error: data?.message ?? `Wheelhouse answered ${res.status}.` };
	} catch {
		return { ok: false, error: 'Could not reach the Wheelhouse server.' };
	}
}
