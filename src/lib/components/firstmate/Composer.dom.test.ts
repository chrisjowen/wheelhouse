import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachments } from '$lib/client/attach.svelte';
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

describe('replying to a message', () => {
	let cancelled: number;

	beforeEach(() => {
		unmount(app);
		document.body.innerHTML = '';
		cancelled = 0;
		app = mount(Composer, {
			target: document.body,
			props: {
				via: 'session',
				reason: null,
				working: false,
				token: 't',
				commands: [],
				reply: { who: 'firstmate', snippet: 'Queued for 3.0.' },
				oncancelreply: () => cancelled++
			}
		});
		flushSync();
	});

	it('shows what is being answered above the box', () => {
		const draft = document.querySelector('[aria-label="Replying to a message"]');
		expect(draft?.textContent).toMatch(/Replying to Firstmate/);
		expect(draft?.textContent).toMatch(/Queued for 3\.0\./);
	});

	it('sends the quote with the captain’s words, then lets the reply go', async () => {
		editor().textContent = 'And onboarding?';
		editor().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		key('keydown', { key: 'Enter' });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(sent()).toEqual(['> Replying to Firstmate: “Queued for 3.0.”\n\nAnd onboarding?']);
		expect(cancelled).toBe(1);
	});

	it('sends a slash command as a plain command, without the quote, and lets the reply go', async () => {
		editor().textContent = '/compact';
		editor().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		key('keydown', { key: 'Enter' });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(sent()).toEqual(['/compact']);
		expect(cancelled).toBe(1);
	});

	it('cancels with its button or Escape', () => {
		click(document.querySelector<HTMLButtonElement>('button[aria-label="Cancel the reply"]')!);
		expect(cancelled).toBe(1);
		key('keydown', { key: 'Escape' });
		expect(cancelled).toBe(2);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('attaching files', () => {
	/** Stands in for the browser's upload: each request waits until the test answers it. */
	class FakeXhr {
		static all: FakeXhr[] = [];
		headers: Record<string, string> = {};
		url = '';
		body: unknown = null;
		status = 0;
		responseText = '';
		aborted = false;
		upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		open(_m: string, url: string) {
			this.url = url;
		}
		setRequestHeader(k: string, v: string) {
			this.headers[k.toLowerCase()] = v;
		}
		send(body: unknown) {
			this.body = body;
			FakeXhr.all.push(this);
		}
		abort() {
			this.aborted = true;
		}
		answer(status: number, body: unknown) {
			this.status = status;
			this.responseText = JSON.stringify(body);
			this.onload?.();
			flushSync();
		}
	}

	const DIR = '/home/me/.local/state/wheelhouse/uploads/2026-10-31';
	const savedAs = (name: string, size: number, type: string, id = '0a1b2c3d4e5f') => ({
		path: `${DIR}/${id}/${name}`,
		name,
		size,
		type
	});
	const input = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
	const rows = () => [...document.querySelectorAll('[aria-label="Attached files"] li')];
	const pick = (...files: File[]) => {
		Object.defineProperty(input(), 'files', { value: files, configurable: true });
		input().dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
	};

	beforeEach(() => {
		attachments.drafts = [];
		FakeXhr.all = [];
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		vi.stubGlobal(
			'URL',
			Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
		);
	});

	it('uploads a picked file at once with the session token, then sends its line', async () => {
		pick(new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' }));
		expect(FakeXhr.all).toHaveLength(1);
		const xhr = FakeXhr.all[0];
		expect(xhr.url).toBe('/api/firstmate/uploads');
		expect(xhr.headers['x-wheelhouse-session']).toBe('t');
		expect(xhr.headers['x-wheelhouse-filename']).toBe('report.pdf');
		expect(rows()[0].textContent).toMatch(/report\.pdf.*Uploading/);
		// Send waits for the upload.
		expect(send().disabled).toBe(true);
		key('keydown', { key: 'Enter' });
		expect(fetchMock).not.toHaveBeenCalled();

		xhr.answer(201, savedAs('report.pdf', 8, 'application/pdf'));
		expect(rows()[0].textContent).toMatch(/report\.pdf\s*PDF · 8 B/);
		expect(send().disabled).toBe(false);

		editor().textContent = 'Please read this';
		editor().dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		key('keydown', { key: 'Enter' });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		expect(sent()).toEqual([
			`Please read this\n[attached file ${DIR}/0a1b2c3d4e5f/report.pdf — report.pdf, 8 B, application/pdf]`
		]);
		expect(rows()).toHaveLength(0);
	});

	it('sends files on their own, without words', async () => {
		pick(new File(['hi'], 'a.txt', { type: 'text/plain' }));
		FakeXhr.all[0].answer(201, savedAs('a.txt', 2, 'text/plain'));
		click(send());
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		expect(sent()[0]).toMatch(/^\[attached file .*a\.txt — a\.txt, 2 B, text\/plain\]$/);
	});

	it('attaches a pasted image under a readable name instead of typing it', () => {
		const data = new DataTransfer();
		data.items.add(new File(['png'], 'image.png', { type: 'image/png' }));
		editor().dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
		);
		flushSync();
		expect(FakeXhr.all).toHaveLength(1);
		expect(decodeURIComponent(FakeXhr.all[0].headers['x-wheelhouse-filename'])).toMatch(
			/^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/
		);
		expect(rows()[0].querySelector('img')).not.toBeNull();
		expect(editor().textContent).toBe('');
	});

	it('keeps the name of a pasted file that has its own', () => {
		const data = new DataTransfer();
		data.items.add(new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' }));
		editor().dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
		);
		flushSync();
		expect(FakeXhr.all).toHaveLength(1);
		expect(decodeURIComponent(FakeXhr.all[0].headers['x-wheelhouse-filename'])).toBe(
			'report.pdf'
		);
	});

	it('types pasted text rather than attaching the picture of it the clipboard also holds', () => {
		// happy-dom has no execCommand; stand in for the browser typing the text.
		Object.defineProperty(document, 'execCommand', {
			configurable: true,
			value: (_: string, __: boolean, text: string) => {
				editor().textContent += text;
				return true;
			}
		});
		const data = new DataTransfer();
		data.setData('text/plain', 'A1\tB1');
		data.items.add(new File(['png'], 'image.png', { type: 'image/png' }));
		editor().dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
		);
		flushSync();
		expect(FakeXhr.all).toHaveLength(0);
		expect(rows()).toHaveLength(0);
		expect(editor().textContent).toBe('A1\tB1');
		delete (document as { execCommand?: unknown }).execCommand;
	});

	it('refuses a file over the limit without uploading it, saying why', () => {
		const big = new File(['x'], 'huge.mov', { type: 'video/quicktime' });
		Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
		pick(big);
		expect(FakeXhr.all).toHaveLength(0);
		expect(rows()[0].textContent).toMatch(/Too large · 25 MB at most/);
		expect(send().disabled).toBe(true);
	});

	it('shows why an upload failed, keeps it out of the message, and lets it be removed', async () => {
		pick(
			new File(['a'], 'ok.txt', { type: 'text/plain' }),
			new File(['b'], 'bad.txt', { type: 'text/plain' })
		);
		FakeXhr.all[0].answer(201, savedAs('ok.txt', 1, 'text/plain'));
		FakeXhr.all[1].answer(500, { message: 'Wheelhouse could not save the file.' });
		expect(rows()[1].textContent).toMatch(/could not save the file/);
		click(send());
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		expect(sent()[0]).toMatch(/ok\.txt/);
		expect(sent()[0]).not.toMatch(/bad\.txt/);
		expect(rows()).toHaveLength(1);
		click(document.querySelector<HTMLButtonElement>('button[aria-label="Remove bad.txt"]')!);
		expect(rows()).toHaveLength(0);
	});

	it('stops an upload still under way when its file is removed', () => {
		pick(new File(['a'], 'slow.txt', { type: 'text/plain' }));
		click(document.querySelector<HTMLButtonElement>('button[aria-label="Remove slow.txt"]')!);
		expect(FakeXhr.all[0].aborted).toBe(true);
		expect(rows()).toHaveLength(0);
	});
});
