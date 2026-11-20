import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { cardForm, formIn, type FormAnswer } from '$lib/decisionform';
import type { InboxChoices } from '$lib/inbox';
import DecisionForm from './DecisionForm.svelte';

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

const show = (
	form: ReturnType<typeof cardForm>,
	sent: [FormAnswer, string | null][],
	decided: string | null = null
) => {
	app = mount(DecisionForm, {
		target: document.body,
		props: {
			form,
			name: 'd1',
			decided,
			onAnswer: (a: FormAnswer, n: string | null) => sent.push([a, n])
		}
	});
	flushSync();
};
const button = (text: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith(text))!;

describe('DecisionForm', () => {
	it('sends a plain answer with one tap, with a note when one was added', () => {
		const sent: [FormAnswer, string | null][] = [];
		show(cardForm({ kind: 'merge', choices: null, recommendation: null }), sent);
		expect(button('Merge').textContent).toContain('recommended');
		button('Add a note').click();
		flushSync();
		const note = document.querySelector('textarea')!;
		note.value = 'After the release, please.';
		note.dispatchEvent(new Event('input'));
		button('Not yet').click();
		expect(sent).toEqual([
			[{ choice: 'skip', picks: null, decided: null }, 'After the release, please.']
		]);
	});

	it('picks an option, the recommended one first, and decides', () => {
		const sent: [FormAnswer, string | null][] = [];
		show(
			formIn(
				'```decision-form\nWhich should ship?\n- Welcome page, tour behind a link (recommended)\n- Welcome page only\n- Three-step tour\n```'
			)!,
			sent
		);
		expect(document.body.textContent).toContain('Which should ship?');
		const decide = document.querySelector<HTMLButtonElement>('[data-decide]')!;
		expect(decide.textContent!.trim()).toBe('Decide: Welcome page, tour behind a link');
		const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
		radios[2].click();
		flushSync();
		expect(decide.textContent!.trim()).toBe('Decide: Three-step tour');
		decide.click();
		expect(sent).toEqual([[{ choice: 'approve', picks: null, decided: 'Three-step tour' }, null]]);
	});

	const choices: InboxChoices = {
		intro: 'Gateway design calls',
		after: null,
		calls: [
			{
				id: '1',
				number: 1,
				prompt: 'Approach',
				required: true,
				options: [
					{ id: 'A', label: 'A', detail: 'core gateway', recommended: true },
					{ id: 'C', label: 'C', detail: 'Claude Code channels only', recommended: false }
				]
			},
			{
				id: '2',
				number: 2,
				prompt: 'First channel',
				required: true,
				options: [
					{ id: '1', label: 'Discord', detail: null, recommended: false },
					{ id: '2', label: 'Telegram', detail: null, recommended: false }
				]
			}
		]
	};

	it('keeps a card’s several calls, and decides once every call has a pick', () => {
		const sent: [FormAnswer, string | null][] = [];
		show(cardForm({ kind: 'hold', choices, recommendation: null }), sent);
		const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
		expect(radios.map((r) => [r.value, r.checked])).toEqual([
			['A', true],
			['C', false],
			['1', false],
			['2', false]
		]);
		const decide = document.querySelector<HTMLButtonElement>('[data-decide]')!;
		expect(decide.disabled).toBe(true);
		expect(document.body.textContent).toContain('Pick one for 2) First channel to decide.');
		radios[3].click();
		flushSync();
		expect(decide.disabled).toBe(false);
		decide.click();
		expect(sent).toEqual([[{ choice: 'approve', picks: { '2': '2' }, decided: null }, null]]);
	});

	it('takes a written answer', () => {
		const sent: [FormAnswer, string | null][] = [];
		show(formIn('```decision-form\nWhich browsers?\n- (written)\n```')!, sent);
		const box = document.querySelector<HTMLTextAreaElement>('textarea')!;
		box.value = 'The last two years';
		box.dispatchEvent(new Event('input'));
		flushSync();
		document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
		expect(sent).toEqual([
			[{ choice: 'approve', picks: null, decided: 'The last two years' }, null]
		]);
	});

	it('shows what was decided, with nothing left to press, once answered', () => {
		show(
			formIn('```decision-form\nWhich should ship?\n- Welcome page only\n- Three-step tour\n```')!,
			[],
			'Three-step tour'
		);
		expect(document.body.textContent).toContain('Which should ship?');
		expect(document.querySelector('[data-decided]')!.textContent!.trim()).toBe(
			'You decided Three-step tour'
		);
		expect(document.querySelectorAll('button, input, textarea')).toHaveLength(0);
	});

	it('names each of several calls, says which matter most and why, and sends some of them', () => {
		const call = (id: string, key: boolean) => ({
			id,
			number: null,
			prompt: `Question ${id}?`,
			required: true,
			tag: id,
			key,
			why: `Reason for ${id}.`,
			options: ['a', 'b'].map((o) => ({
				id: o,
				label: o,
				detail: `${id} ${o}`,
				recommended: o === 'a'
			}))
		});
		const choices: InboxChoices = {
			intro: 'Three calls.',
			calls: [call('D1', true), call('D2', false), call('D3', false)],
			after: null
		};
		const sent: [FormAnswer, string | null][] = [];
		show(cardForm({ kind: 'hold', choices, recommendation: null }), sent);
		expect([...document.querySelectorAll('[data-call-key]')]).toHaveLength(1);
		expect(document.querySelector('[data-call-why]')!.textContent).toContain(
			'Why (a) is recommended: Reason for D1.'
		);
		// Nothing picked: one button sends every call on its recommendation.
		expect(document.querySelector('[data-decide]')!.textContent!.trim()).toBe('Send all 3');
		expect(document.querySelector('[data-send-partial]')).toBeNull();
		document.querySelector<HTMLInputElement>('input[name="pick-d1-D2"][value="b"]')!.click();
		flushSync();
		expect(document.querySelector('[data-picks-left]')!.textContent).toContain('1 of 3 picked');
		const part = document.querySelector<HTMLButtonElement>('[data-send-partial]')!;
		expect(part.textContent!.trim()).toBe('Send 1, keep 2 waiting');
		part.click();
		expect(sent).toEqual([
			[{ choice: 'approve', picks: { D2: 'b' }, decided: null, partial: true }, null]
		]);
	});
});
