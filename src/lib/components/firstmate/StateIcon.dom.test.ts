import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { LineState } from '$lib/ondeck';
import StateIcon from './StateIcon.svelte';

/** A line's state as a nautical icon: its words are its tooltip and label, and moving work moves. */

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

function icon(state: LineState, props: { still?: boolean; decorative?: boolean } = {}) {
	app = mount(StateIcon, { target: document.body, props: { state, ...props } });
	flushSync();
	return document.querySelector('svg')!;
}

describe('a state icon', () => {
	it('names its state as its accessible label and in its own tooltip, not the browser’s', () => {
		const svg = icon({ label: 'Not responding', icon: 'becalmed', tone: 'warning' });
		expect(svg.getAttribute('role')).toBe('img');
		expect(svg.getAttribute('aria-label')).toBe('Not responding');
		expect(svg.querySelector('title')).toBeNull();
		const tip = document.querySelector('.tip')!;
		expect(tip.textContent).toBe('Not responding');
		expect(tip.getAttribute('aria-hidden')).toBe('true');
		expect(svg.dataset.icon).toBe('becalmed');
		expect(svg.dataset.tone).toBe('warning');
		expect(svg.hasAttribute('data-live')).toBe(false);
	});

	it('sails while its crew works, and is still when told', () => {
		const working: LineState = { label: 'Working', icon: 'sailing', tone: 'busy' };
		const svg = icon(working);
		expect(svg.hasAttribute('data-live')).toBe(true);
		expect(svg.querySelector('.boat')).not.toBeNull();
		expect(svg.querySelector('.wake')).not.toBeNull();
		unmount(app!);
		expect(icon(working, { still: true }).hasAttribute('data-live')).toBe(false);
	});

	it('sweeps its beam only while checks run', () => {
		expect(
			icon({ label: 'Checks: Review', icon: 'lighthouse', tone: 'busy' }).hasAttribute('data-live')
		).toBe(true);
		unmount(app!);
		expect(
			icon({ label: 'Checks: Review', icon: 'lighthouse', tone: 'muted' }).hasAttribute('data-live')
		).toBe(false);
	});

	it('flashes what has gone wrong', () => {
		expect(
			icon({ label: 'Stuck', icon: 'aground', tone: 'danger' }).hasAttribute('data-live')
		).toBe(true);
		unmount(app!);
		expect(
			icon({ label: 'Checks failed', icon: 'danger', tone: 'danger' }).hasAttribute('data-live')
		).toBe(true);
	});

	it('hides from screen readers, with no tooltip, beside its own words', () => {
		const svg = icon({ label: 'Your review', icon: 'flag', tone: 'sea' }, { decorative: true });
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.hasAttribute('role')).toBe(false);
		expect(svg.hasAttribute('aria-label')).toBe(false);
		expect(document.querySelector('.tip')).toBeNull();
	});
});
