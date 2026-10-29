import type { WheelhouseUpdateView } from '$lib/updates';
import { SESSION_HEADER } from './messages';

/**
 * Wheelhouse's own updates in the browser, for the header's update menu: the
 * server's last check (it checks GitHub at most every six hours, or now when
 * the captain asks), and an upgrade the captain started. While an upgrade or
 * check runs this polls every second; across the restart that ends an upgrade
 * it keeps polling until the new server answers, then says it is done. Each
 * change is a POST carrying the session token.
 */

const POLL_MS = 1000;
const IDLE_MS = 30 * 60_000;

export class WheelhouseUpdates {
	view = $state<WheelhouseUpdateView | null>(null);
	/** Why the last thing the captain asked for did not happen. */
	error = $state<string | null>(null);
	/** An upgrade this page started is under way, through the restart that ends it. */
	upgrading = $state(false);
	/** The upgrade this page started finished and Wheelhouse came back. */
	upgraded = $state(false);
	/** A request from this page is under way. */
	sending = $state(false);

	private timer: ReturnType<typeof setTimeout> | null = null;
	private stopped = true;

	/** Whether the server is mid-job, so the page should keep asking. */
	private get active(): boolean {
		const v = this.view;
		return (
			this.upgrading ||
			!!v?.checking ||
			v?.job?.state === 'running' ||
			v?.job?.state === 'restarting'
		);
	}

	start(): () => void {
		this.stopped = false;
		void this.load();
		return () => {
			this.stopped = true;
			if (this.timer) clearTimeout(this.timer);
		};
	}

	private schedule() {
		if (this.timer) clearTimeout(this.timer);
		if (this.stopped) return;
		this.timer = setTimeout(() => void this.load(), this.active ? POLL_MS : IDLE_MS);
	}

	async load(): Promise<void> {
		try {
			const res = await fetch('/api/wheelhouse/update');
			if (res.ok) this.take((await res.json()) as WheelhouseUpdateView);
		} catch {
			// Wheelhouse is restarting, or gone for a moment: ask again shortly.
		}
		this.schedule();
	}

	private take(v: WheelhouseUpdateView) {
		if (this.upgrading && !v.job) {
			// A new server, which knows nothing of the upgrade: it came back.
			this.upgrading = false;
			this.upgraded = true;
		} else if (v.job?.state === 'failed') this.upgrading = false;
		this.view = v;
	}

	private async send(url: string, token: string, upgrade = false): Promise<void> {
		this.sending = true;
		this.error = null;
		this.upgraded = false;
		try {
			const res = await fetch(url, { method: 'POST', headers: { [SESSION_HEADER]: token } });
			const body = (await res.json().catch(() => null)) as
				(WheelhouseUpdateView & { message?: string }) | null;
			if (res.ok && body) {
				if (upgrade) this.upgrading = true;
				this.take(body);
			} else this.error = body?.message ?? `Wheelhouse answered ${res.status}.`;
		} catch {
			this.error = 'Wheelhouse did not answer.';
		} finally {
			this.sending = false;
			this.schedule();
		}
	}

	/** Check GitHub now. */
	check(token: string): Promise<void> {
		return this.send('/api/wheelhouse/update', token);
	}

	/** Fast-forward, reinstall, rebuild and restart Wheelhouse. */
	upgrade(token: string): Promise<void> {
		return this.send('/api/wheelhouse/upgrade', token, true);
	}
}

export const wheelhouseUpdates = new WheelhouseUpdates();
