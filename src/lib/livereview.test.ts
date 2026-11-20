import { describe, expect, it } from 'vitest';
import {
	aboutWhat,
	askedTheScribe,
	mmss,
	packMessage,
	plainNote,
	quickPack,
	readAnswer,
	readNotes,
	readPack,
	readReviewRequest,
	shortTitle,
	timelineLines,
	type PagePart,
	type Remark,
	type ReviewEvent
} from './livereview';
import { parseBatch } from './previewhelper';

const part = (label: string, selector = `#${label}`): PagePart => ({
	label,
	text: label,
	tag: 'button',
	selector,
	rect: { x: 10, y: 10, w: 40, h: 20 }
});
const click = (id: string, t: number, label = 'save'): ReviewEvent => ({
	id,
	t,
	type: 'click',
	label: `Clicked the “${label}” button`,
	page: '/settings',
	el: part(label)
});
const claude = (out: object) => JSON.stringify({ is_error: false, structured_output: out });

describe('mmss', () => {
	it('writes minutes and seconds', () => {
		expect(mmss(0)).toBe('0:00');
		expect(mmss(65_400)).toBe('1:05');
	});
});

describe('aboutWhat', () => {
	it('is the click just before the remark', () => {
		const events = [click('e1', 1000, 'old'), click('e2', 20_000)];
		const a = aboutWhat(events, 'that was slow', 22_000, 25_000, null);
		expect('ev' in a && a.ev.id).toBe('e2');
	});

	it('is what the pointer is on when nothing was used lately', () => {
		const a = aboutWhat([click('e1', 1000)], 'too small', 30_000, 32_000, {
			...part('logo'),
			t: 29_000
		});
		expect(a).toEqual({ pointing: expect.objectContaining({ label: 'logo' }) });
	});

	it('follows the pointer for “this” once it has moved on from the click', () => {
		const events = [click('e1', 10_000)];
		const hover = { ...part('menu'), t: 12_000 };
		const a = aboutWhat(events, 'this is confusing', 13_000, 15_000, hover);
		expect(a).toEqual({ pointing: expect.objectContaining({ label: 'menu' }) });
		// Without “this”, the click it followed still wins.
		expect('ev' in aboutWhat(events, 'confusing', 13_000, 15_000, hover)).toBe(true);
	});

	it('is the area marked while the captain was saying it, even for “this”', () => {
		const mark = { ...click('e2', 14_000, 'marked area 1'), type: 'mark' as const };
		const hover = { ...part('menu'), t: 15_000 };
		const a = aboutWhat(
			[click('e1', 10_000), mark],
			'this bit is too cramped',
			12_000,
			16_000,
			hover
		);
		expect('ev' in a && a.ev.id).toBe('e2');
	});
});

describe('timelineLines', () => {
	it('puts events and remarks in time order, saying what each remark is about', () => {
		const remark: Remark = {
			id: 'u1',
			t0: 21_000,
			t1: 24_000,
			text: 'nothing happened',
			page: '/settings',
			anchor: 'e2',
			pointing: null,
			shotId: null
		};
		const lines = timelineLines([click('e1', 1000, 'open'), click('e2', 20_000)], [remark]);
		expect(lines).toEqual([
			'e1 0:01 Clicked the “open” button (on /settings)',
			'e2 0:20 Clicked the “save” button (on /settings)',
			'u1 0:21–0:24 captain said: “nothing happened” [about e2: Clicked the “save” button] (on /settings)'
		]);
	});
});

describe('readNotes', () => {
	it('reads the notes, keeping their ids unique and their kinds known', () => {
		const out = readNotes(
			claude({
				notes: [
					{
						id: 'n1',
						kind: 'problem',
						severity: 'must',
						text: 'Save does nothing.',
						quote: 'nothing happened',
						anchor: 'e2',
						utterances: ['u1']
					},
					{
						id: 'n1',
						kind: 'weird',
						severity: 'huge',
						text: 'Second.',
						quote: '',
						anchor: '',
						utterances: []
					},
					{ id: 'n3', text: '' }
				],
				heard: 'Noted.'
			})
		);
		expect(out?.heard).toBe('Noted.');
		expect(out?.notes.map((n) => [n.id, n.kind, n.severity])).toEqual([
			['n1', 'problem', 'must'],
			["n1'", 'change', 'should']
		]);
	});

	it('is null for a failed run', () => {
		expect(readNotes(JSON.stringify({ is_error: true, result: 'boom' }))).toBeNull();
		expect(readNotes('not json')).toBeNull();
	});
});

describe('readAnswer', () => {
	it('reads the answer, and an empty one as staying quiet', () => {
		expect(readAnswer(claude({ reply: ' It is the settings page. ' }))).toBe(
			'It is the settings page.'
		);
		expect(readAnswer(claude({ reply: '' }))).toBe('');
		expect(readAnswer(JSON.stringify({ is_error: true }))).toBeNull();
	});
});

describe('readPack', () => {
	it('reads the points, and is null when there are none', () => {
		const pack = readPack(
			claude({
				summary: 'Saving is broken.',
				issues: [
					{
						title: 'Save does nothing',
						detail: 'Make Save save.',
						severity: 'must',
						kind: 'problem',
						notes: ['n1'],
						anchor: 'e2',
						quote: 'nothing happened'
					}
				],
				openQuestions: ['Which page?']
			})
		);
		expect(pack?.issues[0].title).toBe('Save does nothing');
		expect(pack?.openQuestions).toEqual(['Which page?']);
		expect(readPack(claude({ summary: 'x', issues: [], openQuestions: [] }))).toBeNull();
	});
});

describe('the quick pack', () => {
	it('turns a remark the scribe has not filed into a plain note', () => {
		const u: Remark = {
			id: 'u2',
			t0: 0,
			t1: 1000,
			text: 'the save button is broken',
			page: '/',
			anchor: null,
			pointing: null,
			shotId: null
		};
		const n = plainNote('q1', u, 'the “save” button');
		expect(n).toMatchObject({ kind: 'problem', severity: 'must', utterances: ['u2'] });
		expect(n.text).toBe('The save button is broken (about the “save” button on /)');
		const pack = quickPack([n], { title: 'Settings', duration: 61_000 });
		expect(pack.summary).toBe('The captain reviewed Settings for 1:01 and raised 1 point.');
		expect(pack.issues[0].title).toBe('The save button is broken');
	});

	it('tells questions to the scribe from remarks', () => {
		expect(askedTheScribe('what is this page for?')).toBe(true);
		expect(askedTheScribe('how do I get back')).toBe(true);
		expect(askedTheScribe('the header is too tall')).toBe(false);
	});

	it('cuts a long title at a word', () => {
		expect(shortTitle('Make the map settle faster, that would really help everyone')).toBe(
			'Make the map settle faster'
		);
		expect(shortTitle('a '.repeat(50)).endsWith('…')).toBe(true);
	});
});

describe('packMessage', () => {
	it('is the preview feedback batch the chat shows as a card, with the live review’s detail', () => {
		const text = packMessage(
			{ id: 'wh-task', title: 'Settings page' },
			'http://127.0.0.1:5000/',
			{ duration: 125_000, remarks: 3, clicks: 1, pages: 2 },
			{
				summary: 'Saving is broken.',
				lines: [
					{
						severity: 'must',
						title: 'Save does nothing',
						detail: 'Make Save save.',
						where: 'the “save” button on /settings',
						quote: 'nothing happened',
						at: '0:21',
						shot: '/state/live-review/x/shots/s1.jpg'
					}
				],
				errors: ['0:20 on /settings: Console error: boom'],
				openQuestions: []
			},
			'/state/live-review/x/session.json'
		);
		expect(text).toContain(
			'Live review session: 2:05, 3 remarks, 1 click, 2 pages. Saving is broken.'
		);
		expect(text).toContain('   Captain said (0:21): “nothing happened”');
		expect(text).toContain('   Screenshot: /state/live-review/x/shots/s1.jpg');
		expect(text).toContain('- 0:20 on /settings: Console error: boom');
		const batch = parseBatch(text);
		expect(batch).toMatchObject({
			taskId: 'wh-task',
			title: 'Settings page',
			url: 'http://127.0.0.1:5000/'
		});
		expect(batch?.items).toEqual([
			{
				text: '[Must fix] Save does nothing. Make Save save.',
				points: 'the “save” button on /settings'
			}
		]);
	});
});

describe('readReviewRequest', () => {
	it('checks each action', () => {
		expect(readReviewRequest({ action: 'proxy' })).toEqual({ ok: true, action: 'proxy' });
		expect(readReviewRequest({ action: 'reply', said: '  ' })).toEqual({
			ok: false,
			error: 'Say something first.'
		});
		const reply = readReviewRequest({
			action: 'reply',
			said: 'what is this?',
			page: { url: 'http://x/', title: 'X', text: 'hello' },
			convo: [
				{ who: 'captain', text: 'hi' },
				{ who: 'someone', text: 'no' }
			]
		});
		expect(reply).toMatchObject({
			ok: true,
			reply: { said: 'what is this?', convo: [{ who: 'captain', text: 'hi' }] }
		});
		const save = readReviewRequest({
			action: 'save',
			shots: { s1: 'data:image/jpeg;base64,AA==', '../x': 'data:' }
		});
		expect(save).toMatchObject({ ok: true, shots: { s1: 'data:image/jpeg;base64,AA==' } });
		expect(save.ok && 'shots' in save && Object.keys(save.shots)).toEqual(['s1']);
		expect(readReviewRequest({ action: 'delete' }).ok).toBe(false);
	});
});
