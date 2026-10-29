import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dictation } from '$lib/voice/dictation.svelte';
import { setDictationEngine, webSpeechEngine } from '$lib/voice/engine';
import { FakeEngine } from '$lib/voice/fake-engine';

vi.mock('$app/state', () => ({ page: { data: {} } }));

const { default: Composer } = await import('./Composer.svelte');

let engine: FakeEngine;
let app: ReturnType<typeof mount>;
let fetchMock: ReturnType<typeof vi.fn>;

const editor = () => document.querySelector<HTMLElement>('[role="textbox"]')!;
const mic = () =>
	document.querySelector<HTMLButtonElement>(
		'button[aria-label="Dictate a message"], button[aria-label="Stop dictating"]'
	)!;
const send = () => document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
const click = (el: HTMLElement) => {
	el.click();
	flushSync();
};
const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
	editor().dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
	flushSync();
};
const shortcut = { code: 'Space', key: ' ', ctrlKey: true, shiftKey: true };
const sent = () =>
	fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).text);

beforeEach(() => {
	engine = new FakeEngine();
	setDictationEngine(engine);
	localStorage.clear();
	fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
	document.body.innerHTML = '';
	app = mount(Composer, {
		target: document.body,
		props: { via: 'session', reason: null, working: false, token: 't', commands: [] }
	});
	flushSync();
});

afterEach(() => {
	dictation.cancel();
	dictation.dismiss();
	unmount(app);
	setDictationEngine(webSpeechEngine);
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('while a menu is open in the session', () => {
	beforeEach(() => {
		unmount(app);
		document.body.innerHTML = '';
		app = mount(Composer, {
			target: document.body,
			props: {
				via: 'session',
				reason: null,
				working: false,
				held: 'Close the Claude Code menu above to send your message.',
				token: 't',
				commands: []
			}
		});
		flushSync();
	});

	it('keeps the message in the box instead of typing it into the menu', () => {
		editor().textContent = 'what is running?';
		editor().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(send().disabled).toBe(true);
		key('keydown', { key: 'Enter' });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(editor().textContent).toBe('what is running?');
		expect(document.querySelector('[data-held]')?.textContent).toBe(
			'Close the Claude Code menu above to send your message.'
		);
	});
});

describe('dictating into the composer', () => {
	it('shows words live as they are heard, the forming guess apart, and never sends', () => {
		click(mic());
		expect(engine.starts).toBe(1);
		expect(mic().getAttribute('aria-pressed')).toBe('true');
		expect(document.querySelector('[data-dictation-time]')?.textContent).toBe('0:00');

		engine.hear('', 'check the');
		flushSync();
		expect(editor().textContent).toBe('check the');
		expect(editor().querySelector('.dictation-forming')?.textContent).toBe('check the');
		expect(send().disabled).toBe(false);

		engine.hear(' check the build', ' on main');
		flushSync();
		expect(editor().textContent).toBe('check the build on main');
		expect(editor().querySelector('.dictation-forming')?.textContent).toBe(' on main');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps the words as plain, editable text when stopped', () => {
		click(mic());
		engine.hear('check the build');
		click(mic());
		expect(engine.stops).toBe(1);
		expect(document.querySelector('[data-dictation-time]')?.textContent).toBe('Finishing…');
		engine.hear('check the build please');
		engine.end();
		flushSync();
		expect(editor().textContent).toBe('check the build please');
		expect(editor().querySelector('[data-dictation]')).toBeNull();
		expect(mic().getAttribute('aria-label')).toBe('Dictate a message');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('adds to what is already typed, with a space between', () => {
		editor().textContent = 'Firstmate,';
		click(mic());
		engine.hear('pause the docs task');
		engine.end();
		flushSync();
		expect(editor().textContent).toBe('Firstmate, pause the docs task');
	});

	it('puts the box back as it was on Esc', () => {
		editor().textContent = 'Hello';
		click(mic());
		engine.hear('this will be dropped');
		flushSync();
		key('keydown', { key: 'Escape' });
		expect(editor().textContent).toBe('Hello');
		expect(engine.aborts).toBe(1);
		expect(mic().getAttribute('aria-pressed')).toBe('false');
	});

	it('puts back selected text that the words would have replaced on Esc', () => {
		editor().textContent = 'Hello foo';
		const range = document.createRange();
		range.setStart(editor().firstChild!, 6);
		range.setEnd(editor().firstChild!, 9);
		window.getSelection()!.removeAllRanges();
		window.getSelection()!.addRange(range);
		click(mic());
		engine.hear('bar');
		flushSync();
		expect(editor().textContent).toBe('Hello bar');
		key('keydown', { key: 'Escape' });
		expect(editor().textContent).toBe('Hello foo');
	});

	it('sends dictated words only when the captain presses Enter', async () => {
		click(mic());
		engine.hear('ship it', ' now');
		flushSync();
		key('keydown', { key: 'Enter' });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		expect(sent()).toEqual(['ship it now']);
		expect(engine.on).toBeNull();
	});

	it('hands the box back to typing on any other key', () => {
		click(mic());
		engine.hear('fix the', ' tests');
		flushSync();
		key('keydown', { key: 'a' });
		expect(mic().getAttribute('aria-pressed')).toBe('false');
		expect(editor().textContent).toBe('fix the tests');
		expect(editor().querySelector('[data-dictation]')).toBeNull();
	});

	it('toggles with Ctrl/⌘+Shift+Space, and listens only while held when held down', () => {
		vi.useFakeTimers();
		key('keydown', shortcut);
		key('keyup', shortcut);
		expect(engine.starts).toBe(1);
		expect(dictation.phase).toBe('listening');
		key('keydown', shortcut);
		expect(engine.stops).toBe(1);
		engine.end();
		flushSync();

		key('keydown', shortcut);
		expect(engine.starts).toBe(2);
		vi.advanceTimersByTime(1000);
		key('keyup', { code: 'ShiftLeft', key: 'Shift', ctrlKey: true });
		expect(engine.stops).toBe(2);
	});

	it('says plainly when the browser cannot dictate', () => {
		engine.available = false;
		click(mic());
		expect(engine.starts).toBe(0);
		expect(document.querySelector('[data-dictation-problem]')?.textContent).toMatch(
			/cannot turn speech into text/
		);
	});

	it('says plainly when the microphone is blocked', () => {
		engine.failWith = 'blocked';
		click(mic());
		flushSync();
		expect(document.querySelector('[data-dictation-problem]')?.textContent).toMatch(
			/microphone is blocked/
		);
		expect(mic().getAttribute('aria-pressed')).toBe('false');
		expect(editor().textContent).toBe('');
	});

	it('says once, before first use, where the audio goes', () => {
		engine.privacyNote = 'Chrome sends what you say to Google.';
		click(mic());
		expect(engine.starts).toBe(0);
		const note = document.querySelector('[data-dictation-note]');
		expect(note?.textContent).toMatch(/Google/);
		click([...note!.querySelectorAll('button')].find((b) => b.textContent === 'Start dictating')!);
		expect(engine.starts).toBe(1);
		click(mic());
		engine.end();
		flushSync();
		click(mic());
		expect(engine.starts).toBe(2);
		expect(document.querySelector('[data-dictation-note]')).toBeNull();
	});
});
