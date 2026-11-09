import {
	MAX_LINE_CHARS,
	batchText,
	type HelperReply,
	type HelperTurn,
	type Pointer
} from '$lib/previewhelper';
import { sendToInbox } from './chat.svelte';
import { SESSION_HEADER } from './messages';

/**
 * The preview helper in the browser (lib/previewhelper.ts): one conversation
 * and one feedback list per task, kept in this browser so the inline Preview
 * tab and its full screen share them and a reload keeps them. Asking posts
 * the conversation to /api/tasks/<id>/preview/helper; nothing reaches
 * Firstmate until `send`, which posts the whole list as one inbox note about
 * the task (`batchText`), the same way every Wheelhouse message goes.
 */

export interface Said extends HelperTurn {
	id: string;
	/** The lines the helper proposed with this reply, and whether each is on the list. */
	suggest?: { text: string; added: boolean }[];
	/** A note from Wheelhouse itself (sent, failed), never sent to the helper. */
	notice?: boolean;
}

export interface Line {
	id: string;
	text: string;
	points: Pointer | null;
}

export interface Conversation {
	said: Said[];
	list: Line[];
	asking: boolean;
	error: string | null;
	/** The latest batch sent from here, until the list grows again. */
	sent: { at: string; count: number } | null;
}

const KEY = 'wheelhouse-preview-helper';
const empty = (): Conversation => ({ said: [], list: [], asking: false, error: null, sent: null });
const EMPTY: Conversation = Object.freeze(empty()) as Conversation;
const id = () => crypto.randomUUID();

class PreviewHelpers {
	byTask = $state<Record<string, Conversation>>({});
	private loaded = false;

	/** Read the saved conversations once, in the browser (from onMount, never while drawing). */
	load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Conversation>;
			if (v && typeof v === 'object') {
				for (const c of Object.values(v)) c.asking = false;
				this.byTask = v;
			}
		} catch {
			this.byTask = {};
		}
	}

	private save() {
		try {
			localStorage.setItem(KEY, JSON.stringify(this.byTask));
		} catch {
			// storage unavailable; the conversation lasts for this page only
		}
	}

	/** A task's conversation, for drawing: never changes anything. */
	view(taskId: string): Conversation {
		return this.byTask[taskId] ?? EMPTY;
	}

	private of(taskId: string): Conversation {
		this.load();
		if (!this.byTask[taskId]) this.byTask[taskId] = empty();
		return this.byTask[taskId];
	}

	/** Say something to the helper, pointing at part of the page or not, and wait for its answer. */
	async ask(taskId: string, text: string, points: Pointer | null, token: string) {
		const c = this.of(taskId);
		const words = text.trim();
		if ((!words && !points) || c.asking) return;
		c.said.push({ id: id(), who: 'captain', text: words || 'What about this?', points });
		c.asking = true;
		c.error = null;
		this.save();
		const turns = c.said
			.filter((s) => !s.notice)
			.map((s) => ({ who: s.who, text: s.text, points: s.points ?? null }));
		try {
			const r = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/preview/helper`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
				body: JSON.stringify({ turns, list: c.list.map((l) => l.text) })
			});
			const body = (await r.json().catch(() => null)) as
				(HelperReply & { message?: string }) | null;
			if (!r.ok || !body?.reply) {
				c.error = body?.message ?? `The helper could not answer (${r.status}).`;
			} else {
				c.said.push({
					id: id(),
					who: 'helper',
					text: body.reply,
					suggest: body.suggest.map((s) => ({ text: s, added: false }))
				});
			}
		} catch {
			c.error = 'Wheelhouse could not be reached. Try again.';
		} finally {
			c.asking = false;
			this.save();
		}
	}

	/** Put a line the helper proposed on the list, pointing where the captain pointed. */
	accept(taskId: string, saidId: string, i: number) {
		const c = this.of(taskId);
		const at = c.said.findIndex((s) => s.id === saidId);
		const s = c.said[at]?.suggest?.[i];
		if (!s || s.added) return;
		s.added = true;
		const asked = c.said
			.slice(0, at)
			.reverse()
			.find((x) => x.who === 'captain');
		c.list.push({ id: id(), text: s.text, points: asked?.points ?? null });
		c.sent = null;
		this.save();
	}

	addOwn(taskId: string, text: string, points: Pointer | null = null) {
		const t = text.trim().slice(0, MAX_LINE_CHARS);
		if (!t) return;
		const c = this.of(taskId);
		c.list.push({ id: id(), text: t, points });
		c.sent = null;
		this.save();
	}

	edit(taskId: string, lineId: string, text: string) {
		const l = this.of(taskId).list.find((x) => x.id === lineId);
		if (!l) return;
		l.text = text.slice(0, MAX_LINE_CHARS);
		this.save();
	}

	remove(taskId: string, lineId: string) {
		const c = this.of(taskId);
		const line = c.list.find((l) => l.id === lineId);
		c.list = c.list.filter((l) => l.id !== lineId);
		// The helper's proposal can be added again.
		for (const s of c.said)
			for (const x of s.suggest ?? []) if (line && x.text === line.text) x.added = false;
		this.save();
	}

	/**
	 * Send the list to Firstmate as one message about the task, which it passes
	 * to that task's worker. Returns whether Firstmate's inbox took it.
	 */
	async send(task: { id: string; title: string }, url: string, token: string): Promise<boolean> {
		const c = this.of(task.id);
		const lines = c.list.filter((l) => l.text.trim());
		if (!lines.length) return false;
		c.error = null;
		const r = await sendToInbox(batchText(task, url, lines), token, task.id);
		if (!r.ok) {
			c.error = r.error;
			this.save();
			return false;
		}
		c.sent = { at: new Date().toISOString(), count: lines.length };
		// A second mate's task (`<task>@<mate>`) has its list go to that second mate.
		const at = task.id.lastIndexOf('@');
		const to = at > 0 ? `second mate ${task.id.slice(at + 1)}` : 'Firstmate';
		c.list = [];
		c.said.push({
			id: id(),
			who: 'helper',
			notice: true,
			text: `Sent to ${to}: ${lines.length} ${lines.length === 1 ? 'note' : 'notes'}, which it passes to this task. Keep going if you spot more; they make a new list.`
		});
		this.save();
		return true;
	}

	/** Start the conversation over (the list stays). */
	clear(taskId: string) {
		const c = this.of(taskId);
		c.said = [];
		c.error = null;
		this.save();
	}
}

export const previewHelpers = new PreviewHelpers();
