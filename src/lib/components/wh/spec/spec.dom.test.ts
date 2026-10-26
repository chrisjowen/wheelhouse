import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dictation } from '$lib/voice/dictation.svelte';
import { setDictationEngine, webSpeechEngine } from '$lib/voice/engine';
import { FakeEngine } from '$lib/voice/fake-engine';
import { emptySpec, type SpecDraft } from '$lib/spec';
import Interview from './Interview.svelte';
import SpecDocument from './SpecDocument.svelte';

const NOW = new Date('2026-10-27T09:00:00Z');

function draft(): SpecDraft {
	return {
		...emptySpec('spec-abc123def', NOW),
		title: 'Shared trip albums',
		requirements: ['Guests can add photos'],
		interview: {
			turns: [
				{
					role: 'captain',
					text: 'Shared trip albums',
					at: NOW.toISOString(),
					options: [],
					recommended: null,
					changed: []
				},
				{
					role: 'agent',
					text: 'Who should be able to add photos?',
					at: NOW.toISOString(),
					options: ['Account holders only', 'Guests invited by email'],
					recommended: 1,
					changed: ['project', 'requirements']
				}
			],
			done: false,
			usage: { turns: 1, inputTokens: 2000, outputTokens: 150, costUsd: 0.0123 }
		},
		comments: [
			{
				id: 'c-aaaaaa',
				section: 'requirements',
				quote: 'Guests',
				text: 'Only invited guests',
				at: NOW.toISOString(),
				resolvedAt: NOW.toISOString(),
				reply: 'Limited to invited guests.'
			}
		]
	};
}

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

const interviewProps = (over: Record<string, unknown> = {}) => ({
	draft: draft(),
	busy: false,
	streaming: '',
	activity: null,
	error: null,
	pending: null,
	model: 'sonnet',
	effort: 'low',
	onAnswer: vi.fn(async () => true),
	onRetry: vi.fn(),
	...over
});

describe('Interview', () => {
	it('offers the agent’s answers, marking its recommendation; picking one fills the box to send', async () => {
		const props = interviewProps();
		const app = mount(Interview, { target: document.body, props });
		flushSync();
		const chips = [...document.querySelectorAll('[aria-label="Suggested answers"] button')];
		expect(chips.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Account holders only',
			'Guests invited by email Recommended'
		]);
		(chips[1] as HTMLButtonElement).click();
		await Promise.resolve();
		flushSync();
		const box = document.querySelector<HTMLTextAreaElement>('textarea[data-answer]')!;
		expect(box.value).toBe('Guests invited by email');
		box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		expect(props.onAnswer).toHaveBeenCalledWith('Guests invited by email');
		expect(document.body.textContent).toContain('Claude sonnet, low effort, read-only');
		expect(document.body.textContent).toContain('1 turn, 2.0k tokens in, 150 out');
		unmount(app);
	});

	it('dictates into the answer box', () => {
		const app = mount(Interview, { target: document.body, props: interviewProps() });
		flushSync();
		document.querySelector<HTMLButtonElement>('button[aria-label="Dictate"]')!.click();
		flushSync();
		engine.hear('guests by email');
		flushSync();
		expect(document.querySelector<HTMLTextAreaElement>('textarea[data-answer]')!.value).toBe(
			'guests by email'
		);
		unmount(app);
	});

	it('streams the agent’s message while it works, with no answers offered meanwhile', () => {
		const app = mount(Interview, {
			target: document.body,
			props: interviewProps({ busy: true, pending: 'Guests', streaming: 'Got it.' })
		});
		flushSync();
		expect(document.body.textContent).toContain('Got it.');
		expect(document.body.textContent).toContain('Guests');
		expect(document.querySelector('[aria-label="Suggested answers"]')).toBeNull();
		unmount(app);
	});

	it('offers to ask again when an answer has no reply', () => {
		const d = draft();
		d.interview.turns.pop();
		const props = interviewProps({ draft: d, error: 'Invalid API key' });
		const app = mount(Interview, { target: document.body, props });
		flushSync();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain('Invalid API key');
		[...document.querySelectorAll('button')]
			.find((b) => b.textContent?.includes('Try again'))!
			.click();
		expect(props.onRetry).toHaveBeenCalled();
		unmount(app);
	});
});

describe('SpecDocument', () => {
	it('shows every section, marks what changed and shows resolved comments', () => {
		const app = mount(SpecDocument, {
			target: document.body,
			props: {
				draft: draft(),
				imageUrl: () => '',
				changed: ['requirements'],
				busy: false,
				onComment: vi.fn(async () => true),
				onRemoveComment: vi.fn()
			}
		});
		flushSync();
		const req = document.querySelector('[data-section="requirements"]')!;
		expect(req.classList.contains('is-updated')).toBe(true);
		expect(req.textContent).toContain('Updated');
		expect(req.textContent).toContain('Limited to invited guests.');
		expect(document.querySelector('[data-section="scope"]')?.textContent).toContain(
			'Not covered yet.'
		);
		expect(document.body.textContent).toContain('Just changed: Requirements.');
		unmount(app);
	});

	it('takes a comment on a section from its comment button', async () => {
		const onComment = vi.fn(async () => true);
		const app = mount(SpecDocument, {
			target: document.body,
			props: {
				draft: draft(),
				imageUrl: () => '',
				changed: [],
				busy: false,
				onComment,
				onRemoveComment: vi.fn()
			}
		});
		flushSync();
		document
			.querySelector<HTMLButtonElement>('button[aria-label="Comment on Scope and non-goals"]')!
			.click();
		await Promise.resolve();
		flushSync();
		const box = document.querySelector<HTMLTextAreaElement>('[data-comment-box] textarea')!;
		box.value = 'Sharing should be in scope';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		[...document.querySelectorAll<HTMLButtonElement>('[data-comment-box] button')]
			.find((b) => b.textContent?.trim() === 'Comment')!
			.click();
		await Promise.resolve();
		expect(onComment).toHaveBeenCalledWith({
			section: 'scope',
			quote: '',
			text: 'Sharing should be in scope'
		});
		unmount(app);
	});
});
