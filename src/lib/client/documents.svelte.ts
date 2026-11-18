import {
	findDocRefs,
	prototypesForTask,
	recordForTask,
	resolveDocRef,
	type DocumentsIndex,
	type ResolvedDoc
} from '$lib/documents';
import { act, sendToInbox, type ActionResult } from './chat.svelte';

/**
 * The fleet's documents in the browser, for the link chips on chat messages,
 * task cards and decision cards: read from /api/documents the first time a
 * chip asks, and again at most once a minute while chips keep asking, so a
 * record that appears when a task finishes gets its chip.
 */
const STALE_MS = 60_000;

const isIndex = (v: unknown): v is DocumentsIndex =>
	!!v &&
	typeof v === 'object' &&
	['records', 'prototypes', 'library'].every((k) =>
		Array.isArray((v as Record<string, unknown>)[k])
	);

class Documents {
	value = $state<DocumentsIndex | null>(null);
	private loadedAt = 0;
	private loading: Promise<void> | null = null;

	/** Read the index now when it is missing or old; never throws. */
	want(): void {
		if (typeof window === 'undefined' || this.loading) return;
		if (this.value && Date.now() - this.loadedAt < STALE_MS) return;
		this.loading = fetch('/api/documents', { cache: 'no-store' })
			.then((r) => (r.ok ? (r.json() as Promise<DocumentsIndex>) : null))
			.then((v) => {
				if (isIndex(v)) this.value = v;
				this.loadedAt = Date.now();
			})
			.catch(() => {})
			.finally(() => (this.loading = null));
	}

	/** Use this index (a page that loaded it already), instead of fetching. */
	seed(v: DocumentsIndex | null | undefined): void {
		if (!isIndex(v)) return;
		this.value = v;
		this.loadedAt = Date.now();
	}

	/** Read again soon: something changed (a promotion). */
	stale(): void {
		this.loadedAt = 0;
		this.want();
	}

	recordFor(taskId: string) {
		this.want();
		return this.value ? recordForTask(this.value, taskId) : null;
	}

	prototypesFor(taskId: string) {
		this.want();
		return this.value ? prototypesForTask(this.value, taskId) : [];
	}

	/** The documents a piece of text mentions that are in the index, each once. */
	mentioned(text: string): ResolvedDoc[] {
		const refs = findDocRefs(text);
		if (!refs.length) return [];
		this.want();
		const index = this.value;
		if (!index) return [];
		const out: ResolvedDoc[] = [];
		const seen: string[] = [];
		for (const ref of refs) {
			const d = resolveDocRef(index, ref);
			if (!d) continue;
			const k = `${d.kind}:${d.kind === 'record' ? d.record.key : d.kind === 'library' ? d.doc.key : d.prototype.id}`;
			if (seen.includes(k)) continue;
			seen.push(k);
			out.push(d);
		}
		return out;
	}
}

export const documents = new Documents();

/**
 * Ask Firstmate something about a document, in the same conversation as the
 * chat: typed into its session when Wheelhouse runs it, else sent to its inbox.
 */
export async function askFirstmate(text: string, token: string): Promise<ActionResult> {
	const typed = await act('/api/firstmate/input', token, { text });
	return typed.ok ? typed : sendToInbox(text, token);
}
