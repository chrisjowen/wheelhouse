import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dictation, fieldTarget } from '$lib/voice/dictation.svelte';
import { setDictationEngine, webSpeechEngine } from '$lib/voice/engine';
import { FakeEngine } from '$lib/voice/fake-engine';

vi.mock('$app/state', () => ({ page: { data: { sessionToken: 't' } } }));

const { default: PreviewFeedback } = await import('./PreviewFeedback.svelte');

let engine: FakeEngine;

beforeEach(() => {
	engine = new FakeEngine();
	setDictationEngine(engine);
	document.body.innerHTML = '';
});

afterEach(() => {
	dictation.cancel();
	setDictationEngine(webSpeechEngine);
});

describe('dictating into a textarea', () => {
	it('fills the preview feedback box, which can then be sent by hand', () => {
		const app = mount(PreviewFeedback, {
			target: document.body,
			props: { taskId: 'task-1', url: 'http://127.0.0.1:4000/' }
		});
		flushSync();
		const box = document.querySelector('textarea')!;
		const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
		expect(submit.disabled).toBe(true);

		document.querySelector<HTMLButtonElement>('button[aria-label="Dictate"]')!.click();
		flushSync();
		engine.hear('make the header', ' darker');
		flushSync();
		expect(box.value).toBe('make the header darker');
		expect(submit.disabled).toBe(false);

		engine.end();
		flushSync();
		expect(box.value).toBe('make the header darker');
		unmount(app);
	});

	it('goes in at the caret, spaced from the words around it, and Esc restores the text', () => {
		const box = document.createElement('textarea');
		document.body.append(box);
		box.value = 'Move the button the footer';
		box.setSelectionRange(16, 16);
		const target = fieldTarget(box);
		dictation.start({}, target);
		engine.hear('into');
		expect(box.value).toBe('Move the button into the footer');
		expect(box.selectionStart).toBe(20);
		dictation.cancel();
		expect(box.value).toBe('Move the button the footer');
	});
});
