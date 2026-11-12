import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BarKey } from '$lib/terminalkeys';

const { default: TerminalKeyBar } = await import('./TerminalKeyBar.svelte');

let app: ReturnType<typeof mount> | null;
let onkey: ReturnType<typeof vi.fn<(key: BarKey) => void>>;
let onctrl: ReturnType<typeof vi.fn<() => void>>;

const key = (name: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;

const show = (props: { ctrl?: boolean; disabled?: boolean } = {}) => {
	app = mount(TerminalKeyBar, {
		target: document.body,
		props: { ctrl: false, ...props, onkey, onctrl }
	});
	flushSync();
};

beforeEach(() => {
	app = null;
	onkey = vi.fn<(key: BarKey) => void>();
	onctrl = vi.fn<() => void>();
	document.body.innerHTML = '';
});

afterEach(() => {
	if (app) unmount(app);
});

describe('the terminal key bar', () => {
	it('sends each key it shows', () => {
		show();
		const names: [string, BarKey][] = [
			['Escape', 'esc'],
			['Tab', 'tab'],
			['Control C', 'ctrl-c'],
			['Left arrow', 'left'],
			['Up arrow', 'up'],
			['Down arrow', 'down'],
			['Right arrow', 'right']
		];
		for (const [name] of names) key(name).click();
		expect(onkey.mock.calls.map(([k]) => k)).toEqual(names.map(([, k]) => k));
	});

	it('toggles Ctrl and shows when it is armed', () => {
		show({ ctrl: true });
		const ctrl = key('Control: applies to the next key');
		expect(ctrl.getAttribute('aria-pressed')).toBe('true');
		ctrl.click();
		expect(onctrl).toHaveBeenCalledOnce();
		expect(onkey).not.toHaveBeenCalled();
	});

	it('never takes focus from the terminal', () => {
		show();
		const input = document.createElement('textarea');
		document.body.append(input);
		input.focus();
		for (const button of document.querySelectorAll('[data-terminal-keys] button')) {
			expect(button.getAttribute('tabindex')).toBe('-1');
			for (const type of ['pointerdown', 'mousedown']) {
				const e = new Event(type, { bubbles: true, cancelable: true });
				button.dispatchEvent(e);
				expect(e.defaultPrevented).toBe(true);
			}
		}
		expect(document.activeElement).toBe(input);
	});

	it('does nothing while the terminal is not connected', () => {
		show({ disabled: true });
		key('Escape').click();
		expect(onkey).not.toHaveBeenCalled();
	});
});
