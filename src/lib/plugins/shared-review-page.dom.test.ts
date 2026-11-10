import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Shared review's review page (review/assets/shell.js), the page reviewers
 * see: comments on the whole review beside pinned ones, attachments shown
 * in place, and Edit and Delete on the reader's own comments only. The page
 * runs in a simulated browser against a stand-in for the review server.
 */

const REVIEW = path.resolve('plugins/shared-review/review');
const SHELL = readFileSync(path.join(REVIEW, 'assets/shell.js'), 'utf8');
const RID = 'AbCdEfGhIjKlMnOpQrStUv';
const api = (p: string) => `/_review/${RID}/api/${p}`;

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let comments: Record<string, unknown>[];

const comment = (o: Record<string, unknown>) => ({
	author: 'Ben',
	at: new Date().toISOString(),
	editedAt: null,
	parent: null,
	general: false,
	anchor: { path: '/', selector: '#pay', at: { x: 0.5, y: 0.5 }, label: 'the “Pay now” button' },
	attachments: [],
	mine: false,
	...o
});

beforeEach(async () => {
	calls = [];
	comments = [
		comment({
			id: 'g1',
			author: 'Ana',
			body: 'The <b>whole</b> flow',
			general: true,
			anchor: null,
			mine: true,
			attachments: [
				{ id: 'a1', name: 'shot.png', type: 'image/png', size: 2048, kind: 'image', seconds: null },
				{
					id: 'a2',
					name: 'voice-note.webm',
					type: 'audio/webm',
					size: 900,
					kind: 'voice',
					seconds: 75
				},
				{
					id: 'a3',
					name: 'spec.pdf',
					type: 'application/pdf',
					size: 4096,
					kind: 'file',
					seconds: null
				}
			]
		}),
		comment({ id: 'p1', body: 'Bigger button' })
	];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? null);
			calls.push({ method, url: String(url), body });
			const json = (v: unknown, status = 200) =>
				new Response(JSON.stringify(v), {
					status,
					headers: { 'content-type': 'application/json' }
				});
			if (url === api('comments') && method === 'GET') return json({ comments, limits: null });
			if (url === api('comments') && method === 'POST')
				return json({ comment: comment({ id: 'new', ...body, anchor: null, mine: true }) }, 201);
			if (url === api('comments/g1') && method === 'PATCH')
				return json({
					comment: { ...comments[0], body: body.body, editedAt: new Date().toISOString() }
				});
			if (url === api('comments/g1') && method === 'DELETE')
				return json({ ok: true, removed: ['g1'] });
			if (url === api('me')) return json({ name: 'Ana', current: true });
			return json({ error: 'not here' }, 404);
		})
	);
	vi.stubGlobal('confirm', () => true);
	const { shellPage } = await import(pathToFileURL(path.join(REVIEW, 'pages.mjs')).href);
	const html: string = shellPage({ rid: RID, title: 'Checkout', name: 'Ana', start: '/' });
	// No stylesheet, and a stand-in for the frame: the simulated browser loads neither.
	const doc = new DOMParser().parseFromString(
		html
			.replace(/<link [^>]*>/g, '')
			.replace(/<script [^>]*><\/script>/g, '')
			.replace(/<iframe [^>]*><\/iframe>/, '<div id="frame"></div>'),
		'text/html'
	);
	document.body.replaceWith(document.adoptNode(doc.body));
	new Function(SHELL)();
	await settle();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const settle = () => new Promise((r) => setTimeout(r, 30));
const threads = () => [...document.querySelectorAll('#threads > li')] as HTMLElement[];
const buttons = (root: ParentNode, label: string) =>
	[...root.querySelectorAll('button')].filter((b) => b.textContent === label);

describe('the review page', () => {
	it('shows whole-review comments beside pinned ones, with their attachments in place, as text', () => {
		const [g, p] = threads();
		expect(g.classList.contains('general')).toBe(true);
		expect(g.querySelector('.meta')!.textContent).toBe('On the whole review');
		expect(g.querySelector('.body')!.textContent).toBe('The <b>whole</b> flow');
		expect(g.querySelector('b')).toBeNull();
		expect(g.querySelector('img')!.getAttribute('src')).toBe(api('attachments/a1'));
		expect(g.querySelector('audio')!.getAttribute('src')).toBe(api('attachments/a2'));
		expect(g.textContent).toContain('Voice note · 1:15');
		const file = g.querySelector('a.file') as HTMLAnchorElement;
		expect(file.getAttribute('download')).toBe('spec.pdf');
		expect(file.textContent).toBe('spec.pdf · 4 KB');
		expect(p.querySelector('.meta')!.textContent).toContain('On the “Pay now” button');
		// Edit and Delete only on the reader's own.
		expect(buttons(g, 'Edit')).toHaveLength(1);
		expect(buttons(p, 'Edit')).toHaveLength(0);
		expect(buttons(p, 'Delete')).toHaveLength(0);
		expect(document.getElementById('general')).not.toBeNull();
	});

	it('posts a comment on the whole review from the panel', async () => {
		(document.getElementById('general-text') as HTMLTextAreaElement).value = 'Feels slow overall';
		(document.getElementById('general') as HTMLFormElement).requestSubmit();
		await settle();
		const post = calls.find((c) => c.method === 'POST' && c.url === api('comments'));
		expect(post?.body).toEqual({ body: 'Feels slow overall', general: true, attachments: [] });
		expect(threads()).toHaveLength(3);
	});

	it('edits and deletes the reader’s own comment', async () => {
		buttons(threads()[0], 'Edit')[0].click();
		const form = threads()[0].querySelector('form.edit-form') as HTMLFormElement;
		const area = form.querySelector('textarea')!;
		expect(area.value).toBe('The <b>whole</b> flow');
		area.value = 'The whole flow, edited';
		area.dispatchEvent(new Event('input'));
		// One attachment taken off before saving.
		(form.querySelector('.chip button') as HTMLButtonElement).click();
		form.requestSubmit();
		await settle();
		const patch = calls.find((c) => c.method === 'PATCH');
		expect(patch).toMatchObject({
			url: api('comments/g1'),
			body: { body: 'The whole flow, edited', attachments: ['a2', 'a3'] }
		});
		// Taking an attachment off a posted comment leaves the server to drop it on save.
		expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
		expect(threads()[0].querySelector('.body')!.textContent).toBe('The whole flow, edited');
		expect(threads()[0].textContent).toContain('edited');

		buttons(threads()[0], 'Delete')[0].click();
		await settle();
		expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: api('comments/g1') });
		expect(threads()).toHaveLength(1);
	});
});
