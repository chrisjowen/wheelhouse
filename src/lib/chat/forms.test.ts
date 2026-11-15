import { describe, expect, it } from 'vitest';
import type { BridgeMessage, Delivery } from '../types';
import type { Item, Part } from './fold';
import { answerText, chatForms, dismissText, formAtEnd, parseAnswer } from './forms';

const user = (id: string, text: string): Item => ({
	kind: 'user',
	id,
	text,
	at: '2026-11-05T09:00:00.000Z',
	queued: false,
	command: false
});
const turn = (id: string, parts: Part[], at = '2026-11-05T09:00:05.000Z'): Item => ({
	kind: 'turn',
	id,
	parts,
	at,
	durationMs: null,
	done: true,
	interrupted: false,
	trigger: 'captain'
});
const text = (id: string, t: string): Part => ({ kind: 'text', id, text: t });
/** A message from the page not shown yet, sent when `after` was the chat's last item. */
const sending = (t: string, after: string | null) => ({ text: t, after });
/** A note Wheelhouse sent to Firstmate's inbox. */
const note = (t: string, submittedAt: string, delivery: Delivery = 'delivered'): BridgeMessage => ({
	requestId: `wh-${submittedAt}`,
	text: t,
	taskId: null,
	submittedAt,
	delivery,
	deliveryDetail: null,
	acknowledged: null,
	noteId: null,
	reply: null
});

const SHIP =
	'Two ways to go.\n\n```decision-form\nWhich should ship?\n- Welcome page, tour behind a link: a "Show me around" link opens it (recommended)\n- Welcome page only\n- Three-step tour\n```';
const MERGE = 'Checks are green.\n\n```decision-form\nMerge it now?\n- Merge\n- Not yet\n```\n';

const SHIP_ANSWER = (words: string) => `Decided: ${words} — for: “Which should ship?”`;
const MERGE_ANSWER = (words: string) => `Decided: ${words} — for: “Merge it now?”`;

describe('formAtEnd', () => {
	it('reads the form a reply ends with, and the words before it', () => {
		const r = formAtEnd(SHIP)!;
		expect(r.form.kind).toBe('choice');
		expect(r.form.prompt).toBe('Which should ship?');
		expect(r.form.from).toBe('firstmate');
		expect(r.words).toBe('Two ways to go.');
		expect(formAtEnd(MERGE)?.form.kind).toBe('buttons');
	});

	it('leaves a block with more words after it, such as an example, as text', () => {
		expect(formAtEnd(`${SHIP}\n\nThat is how a form looks.`)).toBeNull();
		expect(formAtEnd('No form here.')).toBeNull();
	});

	it('keeps an example block earlier in the reply in its words', () => {
		const example = 'A form looks like this:\n\n```decision-form\nReady?\n- Yes\n- No\n```';
		const r = formAtEnd(`${example}\n\n${MERGE}`)!;
		expect(r.form.prompt).toBe('Merge it now?');
		expect(r.words).toBe(`${example}\n\nChecks are green.`);
	});
});

describe('answerText and parseAnswer', () => {
	const ship = formAtEnd(SHIP)!.form;
	const a = { choice: 'approve' as const, picks: null, decided: 'Welcome page only' };

	it('names the words decided and the question, with a note after a blank line, and reads them back', () => {
		expect(answerText(ship, a, null)).toBe(SHIP_ANSWER('Welcome page only'));
		expect(answerText(ship, a, '  After the release.  ')).toBe(
			`${SHIP_ANSWER('Welcome page only')}\n\nAfter the release.`
		);
		expect(parseAnswer(`${SHIP_ANSWER('Welcome page only')}\n\nAfter the release.`)).toEqual({
			words: 'Welcome page only',
			question: 'Which should ship?',
			other: false,
			dismissed: null
		});
	});

	it('names no question for a form without one, and reads an answer that names none', () => {
		const bare = formAtEnd('```decision-form\n- Yes\n- No\n```')!.form;
		expect(bare.prompt).toBeNull();
		expect(answerText(bare, { ...a, decided: 'Yes' }, null)).toBe('Decided: Yes');
		expect(parseAnswer('Decided: Welcome page only')).toEqual({
			words: 'Welcome page only',
			question: null,
			other: false,
			dismissed: null
		});
	});

	it('marks the captain’s own words on a form without a question, which any of its asking takes', () => {
		const bare = formAtEnd('```decision-form\n- Yes\n- No\n```')!.form;
		const own = { ...a, decided: 'Only on Fridays', other: true };
		expect(answerText(bare, own, null)).toBe('Decided (other): Only on Fridays');
		expect(answerText(ship, own, null)).toBe(SHIP_ANSWER('Only on Fridays'));
		const items = [turn('t1', [text('p1', '```decision-form\n- Yes\n- No\n```')])];
		const answered = chatForms(
			[...items, user('u1', 'Decided (other): Only on Fridays')],
			new Set()
		);
		expect(answered.get('p1')).toMatchObject({ decided: 'Only on Fridays', active: false });
	});

	it('says a form was dismissed, with the reason, and reads it back as no answer', () => {
		expect(dismissText(ship, '  Already sorted elsewhere ')).toBe(
			'Dismissed — for: “Which should ship?”\n\nReason: Already sorted elsewhere'
		);
		expect(dismissText(ship, null)).toBe('Dismissed — for: “Which should ship?”');
		expect(parseAnswer(dismissText(ship, 'Wrong question'))).toEqual({
			words: '',
			question: 'Which should ship?',
			other: false,
			dismissed: 'Wrong question'
		});
		const items = [turn('t1', [text('p1', SHIP)])];
		const gone = chatForms([...items, user('u1', dismissText(ship, 'Wrong question'))], new Set());
		expect(gone.get('p1')).toMatchObject({
			decided: null,
			dismissed: 'Wrong question',
			active: false
		});
	});

	it('reads the decision a form names on its fence', () => {
		const named = formAtEnd(
			'Your call.\n\n```decision-form id=fm-inbox-fix-call\nApply the fix?\n- Yes\n- No\n```'
		)!;
		expect(named.id).toBe('fm-inbox-fix-call');
		expect(named.form.prompt).toBe('Apply the fix?');
		expect(formAtEnd(SHIP)!.id).toBeNull();
		expect(formAtEnd('```decision-form id=\nQ?\n- Yes\n```')!.id).toBeNull();
	});

	it('puts a written answer on one line, and sends nothing without words', () => {
		expect(answerText(ship, { ...a, decided: 'Ship\n it  Friday' }, null)).toBe(
			SHIP_ANSWER('Ship it Friday')
		);
		expect(answerText(ship, { ...a, decided: '  ' }, 'note')).toBe('');
		expect(parseAnswer('Let us go with the welcome page.')).toBeNull();
	});
});

describe('chatForms', () => {
	it('opens the latest form until the captain decides, then shows what was decided', () => {
		const items = [user('u1', 'How should onboarding work?'), turn('t1', [text('p1', SHIP)])];
		expect(chatForms(items, new Set()).get('p1')).toMatchObject({
			words: 'Two ways to go.',
			decided: null,
			active: true
		});
		const answered = [...items, user('u2', SHIP_ANSWER('Welcome page only'))];
		expect(chatForms(answered, new Set()).get('p1')).toMatchObject({
			decided: 'Welcome page only',
			active: false
		});
	});

	it('keeps a form open through other messages, and answers it from one still being sent', () => {
		const items = [
			turn('t1', [text('p1', SHIP)]),
			user('u1', 'What does the tour cost?'),
			turn('t2', [text('p2', 'About a day.')])
		];
		expect(chatForms(items, new Set()).get('p1')?.active).toBe(true);
		expect(
			chatForms(items, new Set(), [sending(SHIP_ANSWER('Three-step tour'), 't2')]).get('p1')
		).toMatchObject({
			decided: 'Three-step tour',
			active: false
		});
	});

	it('keeps each form answerable on its own when a later one is asked', () => {
		const items = [turn('t1', [text('p1', SHIP)]), turn('t2', [text('p2', MERGE)])];
		const forms = chatForms(items, new Set());
		expect(forms.get('p1')).toMatchObject({ decided: null, active: true });
		expect(forms.get('p2')).toMatchObject({ decided: null, active: true });
		const after = chatForms([...items, user('u1', SHIP_ANSWER('Welcome page only'))], new Set());
		expect(after.get('p1')).toMatchObject({ decided: 'Welcome page only', active: false });
		expect(after.get('p2')).toMatchObject({ decided: null, active: true });
	});

	it('answers the form an answer queued during a busy turn names, not a later one that turn asked', () => {
		// The captain answers p1 while the turn goes on; the turn then asks p2, and the answer lands after it.
		const items = [turn('t1', [text('p1', SHIP), text('p2', MERGE)])];
		const queued = chatForms(items, new Set(), [sending(SHIP_ANSWER('Welcome page only'), 't1')]);
		expect(queued.get('p1')).toMatchObject({ decided: 'Welcome page only', active: false });
		expect(queued.get('p2')).toMatchObject({ decided: null, active: true });
		const landed = [...items, user('u1', SHIP_ANSWER('Welcome page only'))];
		expect(chatForms(landed, new Set()).get('p2')).toMatchObject({ decided: null, active: true });
		const both = chatForms([...landed, user('u2', MERGE_ANSWER('Merge'))], new Set());
		expect(both.get('p1')?.decided).toBe('Welcome page only');
		expect(both.get('p2')?.decided).toBe('Merge');
	});

	it('gives an answer naming no question to the latest form only when it is one of its options', () => {
		const items = [turn('t1', [text('p1', SHIP), text('p2', MERGE)])];
		const stray = chatForms([...items, user('u1', 'Decided: Welcome page only')], new Set());
		expect(stray.get('p1')?.decided).toBeNull();
		expect(stray.get('p2')).toMatchObject({ decided: null, active: true });
		const fits = chatForms([...items, user('u1', 'Decided: Merge')], new Set());
		expect(fits.get('p2')?.decided).toBe('Merge');
		const written = [
			turn('t1', [text('p1', '```decision-form\nWhich browsers?\n- (written)\n```')])
		];
		expect(
			chatForms([...written, user('u1', 'Decided: The last two years')], new Set()).get('p1')
				?.decided
		).toBe('The last two years');
	});

	it('closes a form a later one with the same question replaced', () => {
		const again =
			'Still two ways.\n\n```decision-form\nWhich should ship?\n- Welcome page only\n- Three-step tour\n```';
		const items = [turn('t1', [text('p1', SHIP)]), turn('t2', [text('p2', again)])];
		const forms = chatForms([...items, user('u1', SHIP_ANSWER('Three-step tour'))], new Set());
		expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
		expect(forms.get('p2')).toMatchObject({ decided: 'Three-step tour', active: false });
	});

	it('closes a form without a question once a later form is asked', () => {
		const bare = '```decision-form\n- Yes\n- No\n```';
		const forms = chatForms([turn('t1', [text('p1', bare), text('p2', MERGE)])], new Set());
		expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
		expect(forms.get('p2')?.active).toBe(true);
	});

	it('leaves forms in a decision’s thread to that decision', () => {
		const items = [turn('t1', [text('p1', SHIP)])];
		expect(chatForms(items, new Set(['t1'])).size).toBe(0);
	});

	describe('one answer message counts once, for one form', () => {
		const again = `Still green.\n\n${MERGE}`;

		it('gives a queued answer to the latest asking when one busy turn asks the same question twice', () => {
			const items = [turn('t1', [text('p1', MERGE), text('p2', again)])];
			for (const forms of [
				chatForms(items, new Set(), [sending(MERGE_ANSWER('Merge'), 't1')]),
				chatForms([...items, user('u1', MERGE_ANSWER('Merge'))], new Set())
			]) {
				expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
				expect(forms.get('p2')).toMatchObject({ decided: 'Merge', active: false });
			}
		});

		it('answers a later form and leaves the one it replaced closed', () => {
			const items = [turn('t1', [text('p1', MERGE)]), turn('t2', [text('p2', again)])];
			for (const forms of [
				chatForms(items, new Set(), [sending(MERGE_ANSWER('Merge'), 't2')]),
				chatForms([...items, user('u1', MERGE_ANSWER('Merge'))], new Set())
			]) {
				expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
				expect(forms.get('p2')).toMatchObject({ decided: 'Merge', active: false });
			}
		});

		it('never answers a form with the same answer given before it was asked', () => {
			const items = [
				turn('t1', [text('p0', MERGE)]),
				user('u0', MERGE_ANSWER('Merge')),
				turn('t2', [text('p1', again)])
			];
			const forms = chatForms(items, new Set());
			expect(forms.get('p0')).toMatchObject({ decided: 'Merge', active: false });
			expect(forms.get('p1')).toMatchObject({ decided: null, active: true });
			const bare = '```decision-form\n- Merge\n- Not yet\n```';
			const unnamed = chatForms(
				[
					turn('t1', [text('p0', bare)]),
					user('u0', 'Decided: Merge'),
					turn('t2', [text('p1', bare)])
				],
				new Set()
			);
			expect(unnamed.get('p0')?.decided).toBe('Merge');
			expect(unnamed.get('p1')).toMatchObject({ decided: null, active: true });
		});
	});

	describe('an answer stays answered after Firstmate’s next turn', () => {
		const T0 = '2026-11-05T09:00:00.000Z';
		const T1 = '2026-11-05T09:01:00.000Z';
		const T2 = '2026-11-05T09:02:00.000Z';

		it('from the transcript, for an answer typed into the session', () => {
			const items = [
				turn('t1', [text('p1', MERGE)], T0),
				user('u1', MERGE_ANSWER('Merge')),
				turn('t2', [text('r1', 'Merging now.')], T2)
			];
			expect(chatForms(items, new Set()).get('p1')).toMatchObject({
				decided: 'Merge',
				active: false
			});
		});

		it('from the inbox record, for an answer sent to Firstmate’s inbox', () => {
			const items = [turn('t1', [text('p1', MERGE)], T0), turn('t2', [text('r1', 'Merging.')], T2)];
			expect(
				chatForms(items, new Set(), [], [note(MERGE_ANSWER('Merge'), T1)]).get('p1')
			).toMatchObject({ decided: 'Merge', active: false });
		});

		it('but not from an inbox note whose delivery failed', () => {
			const items = [turn('t1', [text('p1', MERGE)], T0)];
			expect(
				chatForms(items, new Set(), [], [note(MERGE_ANSWER('Merge'), T1, 'failed')]).get('p1')
			).toMatchObject({ decided: null, active: true });
		});

		it('never from an inbox note sent before the form was asked', () => {
			const items = [
				turn('t0', [text('p0', MERGE)], T0),
				turn('t1', [text('p1', `Again.\n\n${MERGE}`)], T2)
			];
			const forms = chatForms(items, new Set(), [], [note(MERGE_ANSWER('Merge'), T1)]);
			expect(forms.get('p0')?.decided).toBe('Merge');
			expect(forms.get('p1')).toMatchObject({ decided: null, active: true });
		});
	});

	describe('a message still being sent counts once its own record shows it', () => {
		const again = `Still green.\n\n${MERGE}`;

		it('leaves out a pending copy the transcript already shows', () => {
			const items = [
				turn('t1', [text('p1', MERGE)]),
				turn('t2', [text('p2', again)]),
				user('u1', MERGE_ANSWER('Merge'))
			];
			const forms = chatForms(items, new Set(), [sending(MERGE_ANSWER('Merge'), 't2')]);
			expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
			expect(forms.get('p2')).toMatchObject({ decided: 'Merge', active: false });
		});

		it('leaves out a pending copy the inbox record already shows', () => {
			const items = [
				turn('t1', [text('p1', MERGE)], '2026-11-05T09:00:00.000Z'),
				turn('t2', [text('p2', again)], '2026-11-05T09:01:00.000Z')
			];
			const forms = chatForms(
				items,
				new Set(),
				[sending(MERGE_ANSWER('Merge'), 't2')],
				[note(MERGE_ANSWER('Merge'), '2026-11-05T09:02:00.000Z')]
			);
			expect(forms.get('p1')).toMatchObject({ decided: null, active: false });
			expect(forms.get('p2')).toMatchObject({ decided: 'Merge', active: false });
		});

		it('leaves out a pending copy whose inbox note failed, leaving the form open', () => {
			const items = [turn('t1', [text('p1', MERGE)], '2026-11-05T09:00:00.000Z')];
			const forms = chatForms(
				items,
				new Set(),
				[sending(MERGE_ANSWER('Not yet'), 't1')],
				[note(MERGE_ANSWER('Not yet'), '2026-11-05T09:01:00.000Z', 'failed')]
			);
			expect(forms.get('p1')).toMatchObject({ decided: null, active: true });
		});

		it('still counts a pending copy when only an earlier identical answer shows', () => {
			const items = [
				turn('t1', [text('p1', MERGE)]),
				user('u1', MERGE_ANSWER('Merge')),
				turn('t2', [text('p2', again)])
			];
			const forms = chatForms(items, new Set(), [sending(MERGE_ANSWER('Merge'), 't2')]);
			expect(forms.get('p1')?.decided).toBe('Merge');
			expect(forms.get('p2')?.decided).toBe('Merge');
		});
	});
});
