import type { PreviewCheck } from '$lib/preview';

/**
 * Whether each task's reported preview answers right now, from the server's
 * check (api/tasks/[id]/preview), or, for a preview no task reported (one
 * Firstmate linked, a review board; keyed `url:<address>`, see urlKey), from
 * api/previews/check. Shared by every place that shows it: the
 * Preview tab, the chat's preview cards, Harbour cards and the task overview's
 * link. One check per task however many places watch it. A preview that
 * answers is checked again every 15 seconds; one that has stopped every 5, so
 * it shows again soon after the worker brings it back; every watched preview
 * is checked at once when the window regains focus, and none while the tab is
 * hidden.
 */

export const LIVE_RECHECK_MS = 15_000;

/** The key a preview no task reported is checked under, in place of a task id. */
export const urlKey = (url: string) => `url:${url}`;

/** Where a key's check comes from: the task's preview, or an address's. */
const checkUrl = (key: string) =>
	key.startsWith('url:')
		? `/api/previews/check?url=${encodeURIComponent(key.slice(4))}`
		: `/api/tasks/${encodeURIComponent(key)}/preview`;
export const STOPPED_RECHECK_MS = 5_000;

export class PreviewChecks {
	/** The latest check, by task id. */
	checks = $state<Record<string, PreviewCheck>>({});
	/** Task ids whose last check could not reach Wheelhouse. */
	failed = $state<Record<string, boolean>>({});
	// Bookkeeping, not shown: plain Maps.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private watching = new Map<
		string,
		{ count: number; timer: ReturnType<typeof setTimeout> | null }
	>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private running = new Map<string, Promise<void>>();
	private unlisten: (() => void) | null = null;

	/** Whether `taskId`'s preview has stopped: its last check found nothing answering. */
	stopped(taskId: string): boolean {
		return this.checks[taskId]?.state === 'down';
	}

	/** Keep `taskId`'s preview checked until the returned function is called. */
	watch(taskId: string): () => void {
		const w = this.watching.get(taskId);
		if (w) w.count++;
		else {
			this.watching.set(taskId, { count: 1, timer: null });
			void this.refresh(taskId);
		}
		this.listen();
		let stopped = false;
		return () => {
			if (stopped) return;
			stopped = true;
			const w = this.watching.get(taskId);
			if (!w || --w.count > 0) return;
			if (w.timer) clearTimeout(w.timer);
			this.watching.delete(taskId);
			if (!this.watching.size) {
				this.unlisten?.();
				this.unlisten = null;
			}
		};
	}

	/** Check `taskId`'s preview now; a watched one is then checked again on its schedule. */
	refresh(taskId: string): Promise<void> {
		const busy = this.running.get(taskId);
		if (busy) return busy;
		const p = this.load(taskId).finally(() => {
			this.running.delete(taskId);
			this.schedule(taskId);
		});
		this.running.set(taskId, p);
		return p;
	}

	/** Forget every check (tests). */
	clear() {
		for (const w of this.watching.values()) if (w.timer) clearTimeout(w.timer);
		this.watching.clear();
		this.unlisten?.();
		this.unlisten = null;
		this.checks = {};
		this.failed = {};
	}

	private async load(taskId: string) {
		try {
			const r = await fetch(checkUrl(taskId));
			if (!r.ok) throw new Error(String(r.status));
			this.checks[taskId] = (await r.json()) as PreviewCheck;
			this.failed[taskId] = false;
		} catch {
			this.failed[taskId] = true;
		}
	}

	private schedule(taskId: string) {
		const w = this.watching.get(taskId);
		if (!w) return;
		if (w.timer) clearTimeout(w.timer);
		const ms = this.checks[taskId]?.state === 'live' ? LIVE_RECHECK_MS : STOPPED_RECHECK_MS;
		w.timer = setTimeout(() => {
			w.timer = null;
			// A hidden tab waits; it is checked again when it is shown (listen).
			if (document.visibilityState !== 'hidden') void this.refresh(taskId);
		}, ms);
	}

	private listen() {
		if (this.unlisten) return;
		const all = () => {
			if (document.visibilityState === 'hidden') return;
			for (const id of this.watching.keys()) void this.refresh(id);
		};
		window.addEventListener('focus', all);
		document.addEventListener('visibilitychange', all);
		this.unlisten = () => {
			window.removeEventListener('focus', all);
			document.removeEventListener('visibilitychange', all);
		};
	}
}

export const previewChecks = new PreviewChecks();
