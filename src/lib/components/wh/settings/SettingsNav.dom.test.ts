import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	data: { features: { events: false, remotes: false } },
	url: new URL('http://127.0.0.1:4310/settings/experimental')
}));

vi.mock('$app/state', () => ({ page: state }));

const { default: SettingsNav } = await import('./SettingsNav.svelte');
let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	state.data.features.events = false;
	state.data.features.remotes = false;
});

function render() {
	app = mount(SettingsNav, { target: document.body });
	flushSync();
}

describe('Settings navigation feature flags', () => {
	it('shows Fleet to everyone, first, with Experimental features reachable', () => {
		render();
		const links = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(links[0]).toBe('/settings/fleet');
		expect(document.querySelector('a[href="/settings/fleet"]')?.textContent).toBe('Fleet');
		expect(document.querySelector('a[href="/settings/gateway"]')).toBeNull();
		expect(document.querySelector('a[href="/settings/cloud"]')).toBeNull();
		expect(document.querySelector('a[href="/settings/experimental"]')).not.toBeNull();
	});

	it('keeps Fleet when Remotes is enabled, without a separate Gateway tab', () => {
		state.data.features.remotes = true;
		render();
		expect(document.querySelectorAll('a[href="/settings/fleet"]')).toHaveLength(1);
		expect(document.querySelector('a[href="/settings/gateway"]')).toBeNull();
	});

	it('hides Events while its feature flag is off', () => {
		render();
		expect(document.querySelector('a[href="/settings/events"]')).toBeNull();
	});

	it('shows Events when its flag is enabled', () => {
		state.data.features.events = true;
		render();
		expect(document.querySelector('a[href="/settings/events"]')?.textContent).toBe('Events');
	});
});
