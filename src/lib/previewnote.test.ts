import { describe, expect, it } from 'vitest';
import { isBoard, linkedPreviews, pageOf, previewNoteOf } from './previewnote';

describe('previewNoteOf', () => {
	it('reads the preview convention, whatever the address', () => {
		expect(previewNoteOf('preview http://127.0.0.1:5173/')).toEqual({
			preview: 'http://127.0.0.1:5173/',
			board: null
		});
		expect(previewNoteOf(' preview: https://preview.example.com/x.').preview).toBe(
			'https://preview.example.com/x'
		);
	});

	it('reads a preview however the worker phrased it', () => {
		const lines = [
			'Preview ready for approval: review cards with live preview + passcode-in-link sign-in - http://127.0.0.1:4471/plugins/shared-review/reviews (also /tasks/demo-tides) via Wheelhouse',
			'preview up — http://127.0.0.1:5344/signin (Nana Rose → Write)',
			'three dense prototypes ready: A http://127.0.0.1:5288/a ; B http://127.0.0.1:5288/b',
			'child wh-chat-thumbs-up done: committed on fm/wh-chat-thumbs-up; preview http://127.0.0.1:38607/ still running'
		];
		expect(lines.map((l) => previewNoteOf(l).preview)).toEqual([
			'http://127.0.0.1:4471/plugins/shared-review/reviews',
			'http://127.0.0.1:5344/signin',
			'http://127.0.0.1:5288/a',
			'http://127.0.0.1:38607/'
		]);
	});

	it('tells a review board from the preview beside it', () => {
		expect(
			previewNoteOf(
				'prototype ready for captain review on Lavish board http://127.0.0.1:4387/session/c03d5022881d405d (direct preview http://127.0.0.1:4612/); report at data/x/report.md'
			)
		).toEqual({
			preview: 'http://127.0.0.1:4612/',
			board: 'http://127.0.0.1:4387/session/c03d5022881d405d'
		});
		expect(previewNoteOf('round 2 on the board: http://localhost:4390/b/7')).toEqual({
			preview: null,
			board: 'http://localhost:4390/b/7'
		});
		expect(
			previewNoteOf(
				'Preview: http://127.0.0.1:4791/ | Lavish board: http://127.0.0.1:4387/session/2a'
			)
		).toEqual({ preview: 'http://127.0.0.1:4791/', board: 'http://127.0.0.1:4387/session/2a' });
	});

	it('takes the address after the word preview when a line names several', () => {
		expect(
			previewNoteOf('API on http://127.0.0.1:8080/ and the preview at http://127.0.0.1:5173/')
				.preview
		).toBe('http://127.0.0.1:5173/');
	});

	it('takes no stray address for a preview or a board', () => {
		const lines = [
			'tests hit http://localhost:9222/json',
			'fixed redirect to http://localhost:3000/callback',
			'live at http://127.0.0.1:4310/',
			'Board live - please review http://127.0.0.1:5173/',
			'preview fixed; set the callback to `http://localhost:3000/callback`'
		];
		expect(lines.map(previewNoteOf)).toEqual(lines.map(() => ({ preview: null, board: null })));
		expect(previewNoteOf('`preview http://127.0.0.1:5173/` is the convention').preview).toBeNull();
	});

	it('reads nothing from a line with no address on this machine', () => {
		expect(previewNoteOf('PR https://github.com/o/r/pull/3 checks green')).toEqual({
			preview: null,
			board: null
		});
		expect(previewNoteOf('see http://user:pw@127.0.0.1:5173/').preview).toBeNull();
	});
});

describe('linkedPreviews', () => {
	it('finds every address on this machine a reply links, once each', () => {
		expect(
			linkedPreviews(
				'The board is up at **http://127.0.0.1:4387/session/8b4a**. Direct: http://localhost:5199/, and again http://localhost:5199/.'
			)
		).toEqual(['http://127.0.0.1:4387/session/8b4a', 'http://localhost:5199/']);
	});

	it('leaves out code, other machines and Wheelhouse itself', () => {
		const text =
			'Set the callback to `http://localhost:3000/api/auth/callback` and\n```\ncurl http://127.0.0.1:9000/\n```\nsee https://github.com/o/r and http://127.0.0.1:4310/second-mates and http://127.0.0.1:5173/';
		expect(linkedPreviews(text, '4310')).toEqual(['http://127.0.0.1:5173/']);
	});
});

describe('isBoard and pageOf', () => {
	it('knows a board session address', () => {
		expect(isBoard('http://127.0.0.1:4387/session/199ebc69d6704df7')).toBe(true);
		expect(isBoard('http://127.0.0.1:4387/')).toBe(false);
		expect(isBoard('https://example.com/session/1')).toBe(false);
	});

	it('names the page an address is on', () => {
		expect(pageOf('http://127.0.0.1:5288/a/?x=1#y')).toBe('http://127.0.0.1:5288/a');
		expect(pageOf('http://127.0.0.1:5288/')).toBe('http://127.0.0.1:5288');
	});
});
