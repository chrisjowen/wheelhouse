import type { ServiceView } from '$lib/plugins/types';
import { addressRewrites } from './addresses.svelte';
import { SESSION_HEADER } from './messages';

/**
 * Plugin companion services in the browser: read whether one is up, and start
 * it on the captain's click, then open it. Starting is a POST that carries the
 * session token, as every change Wheelhouse makes does.
 */
export interface ServiceRef {
	plugin: string;
	service: string;
	project?: string | null;
}

const query = (r: ServiceRef) =>
	new URLSearchParams({
		plugin: r.plugin,
		service: r.service,
		...(r.project ? { project: r.project } : {})
	}).toString();

export async function serviceStatus(r: ServiceRef): Promise<ServiceView | null> {
	try {
		const res = await fetch(`/api/services?${query(r)}`);
		return res.ok ? ((await res.json()) as ServiceView) : null;
	} catch {
		return null;
	}
}

/**
 * Start the service and, once it answers, open `open` (or its own address) in
 * a new tab. The tab opens straight away, while the click still counts, so no
 * pop-up blocker stops it; it says the service is starting, and closes again
 * if the start fails.
 */
export async function launchAndOpen(
	r: ServiceRef,
	token: string,
	open: string | null = null
): Promise<ServiceView | null> {
	const tab = window.open('', '_blank');
	try {
		tab?.document.write(
			'<!doctype html><title>Starting…</title><body style="font:15px system-ui;margin:3rem;color:#14213d;background:#f6f2e9">Wheelhouse is starting it; this tab opens it when it answers.</body>'
		);
	} catch {
		// a tab Wheelhouse cannot write to: it still navigates below
	}
	let view: ServiceView | null = null;
	try {
		const res = await fetch('/api/services', {
			method: 'POST',
			headers: { 'content-type': 'application/json', [SESSION_HEADER]: token },
			body: JSON.stringify({ plugin: r.plugin, service: r.service, project: r.project ?? null })
		});
		view = res.ok
			? ((await res.json()) as ServiceView)
			: ({
					...((await res.json().catch(() => ({}))) as object),
					state: 'failed',
					reason: `Wheelhouse could not start it (${res.status}).`
				} as ServiceView);
	} catch {
		view = null;
	}
	const url = view?.state === 'running' ? (open ?? view.url) : null;
	if (url) {
		const to = addressRewrites.view(url);
		if (tab) tab.location.href = to;
		else window.open(to, '_blank');
	} else {
		tab?.close();
	}
	return view;
}
