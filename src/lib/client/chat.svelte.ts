import { fold, type Chat } from '$lib/chat/fold';
import { SESSION_HEADER } from '$lib/client/messages';
import type { FirstmateSessionView, SlashCommand, TranscriptSource } from '$lib/types';

/**
 * The home page's live view of the Firstmate session: its status and the
 * transcript records from /api/firstmate/chat (server-sent events), folded into
 * the chat. Also the page's few actions on the session; each posts to
 * Wheelhouse with the launch's session token (checked with the Origin in
 * hooks.server.ts).
 */
/** The most records the page keeps (the server keeps as many for pages that connect later). */
const MAX_RECORDS = 6000;

/* eslint-disable @typescript-eslint/no-explicit-any */
class FirstmateChat {
	session = $state<FirstmateSessionView | null>(null);
	source = $state<TranscriptSource | null>(null);
	records = $state.raw<Record<string, any>[]>([]);
	/** Our own connection to the Wheelhouse server. */
	connection = $state<'connecting' | 'open' | 'lost'>('connecting');
	/** Bumps when the transcript starts over (a new file), so the page can jump to the end. */
	resets = $state(0);
	commands = $state<SlashCommand[]>([]);
	readonly chat: Chat = $derived(fold(this.records));

	private es: EventSource | null = null;

	connect(): () => void {
		if (this.es) return () => {};
		const es = new EventSource('/api/firstmate/chat');
		this.es = es;
		es.addEventListener('open', () => (this.connection = 'open'));
		es.addEventListener('error', () => {
			this.connection = es.readyState === EventSource.CLOSED ? 'lost' : 'connecting';
		});
		es.addEventListener('session', (e) => {
			this.session = JSON.parse((e as MessageEvent).data);
			this.connection = 'open';
		});
		es.addEventListener('reset', (e) => {
			this.source = JSON.parse((e as MessageEvent).data);
			this.records = [];
			this.resets++;
		});
		es.addEventListener('records', (e) => {
			const next = [...this.records, ...JSON.parse((e as MessageEvent).data)];
			this.records = next.length > MAX_RECORDS ? next.slice(-MAX_RECORDS) : next;
		});
		void this.loadCommands();
		return () => {
			es.close();
			this.es = null;
		};
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
 * id makes a retry safe: Firstmate keeps one note per id.
 */
export async function sendToInbox(
	text: string,
	token: string,
	taskId: string | null = null
): Promise<ActionResult> {
	try {
		const res = await fetch('/api/firstmate/messages', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'idempotency-key': `wh-${crypto.randomUUID()}`,
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
