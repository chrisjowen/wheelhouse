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
	it('hides Gateway while Remotes is disabled but keeps Experimental features reachable', () => {
		render();
		expect(document.querySelector('a[href="/settings/gateway"]')).toBeNull();
		expect(document.querySelector('a[href="/settings/cloud"]')).toBeNull();
		expect(document.querySelector('a[href="/settings/experimental"]')).not.toBeNull();
	});

	it('shows Gateway when Remotes is enabled', () => {
		state.data.features.remotes = true;
		render();
		expect(document.querySelector('a[href="/settings/gateway"]')?.textContent).toContain('Gateway');
	});

	it('hides Events while its feature flag is off', () => {
		render();
		expect(document.querySelector('a[href="/settings/events"]')).toBeNull();
	});

	it('shows Events when its flag is enabled without exposing disabled Remotes', () => {
		state.data.features.events = true;
		render();
		expect(document.querySelector('a[href="/settings/events"]')?.textContent).toBe('Events');
		expect(document.querySelector('a[href="/settings/gateway"]')).toBeNull();
	});
});
