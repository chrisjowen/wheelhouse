import { describe, expect, it } from 'vitest';
import {
	batchText,
	helperPrompt,
	pageText,
	parseBatch,
	pluginBatchText,
	readReply,
	readRequest,
	type HelperContext,
	readSummary,
	summaryPrompt
} from './previewhelper';

const ctx: HelperContext = {
	task: {
		id: 'lumen-share',
		title: 'Shareable album links',
		project: 'Lumen',
		status: 'needs-review'
	},
	preview: {
		url: 'http://127.0.0.1:5240/',
		text: 'Share “Summer in Lisbon”\nLink expires In 7 days'
	},
	brief: 'Links expire after 7 days by default.',
	history: ['2026-11-03 09:00 Building the share dialog'],
	screenshots: [{ name: 'share.png', file: '/data/lumen-share/share.png' }]
};

describe('readRequest', () => {
	it('takes the turns and the list, bounded, and the pointer the captain gave', () => {
		const r = readRequest({
			turns: [
				{
					who: 'captain',
					text: 'This feels short',
					points: { kind: 'element', label: 'the menu', detail: 'x' }
				}
			],
			list: ['  Make links   last 30 days ', 3]
		});
		expect(r).toEqual({
			ok: true,
			value: {
				turns: [
					{
						who: 'captain',
						text: 'This feels short',
						points: { kind: 'element', label: 'the menu', detail: 'x' }
					}
				],
				list: ['Make links last 30 days']
			}
		});
	});

	it('refuses an empty conversation, a stranger speaker, or one that ends with the helper', () => {
		expect(readRequest({}).ok).toBe(false);
		expect(readRequest({ turns: [{ who: 'worker', text: 'hi' }] }).ok).toBe(false);
		expect(
			readRequest({
				turns: [
					{ who: 'captain', text: 'Hi' },
					{ who: 'helper', text: 'Hello' }
				]
			})
		).toEqual({ ok: false, error: 'The last message must be yours.' });
	});
});

describe('helperPrompt', () => {
	it('gives the helper only this task: page, instructions, history, screenshots, list and conversation', () => {
		const p = helperPrompt(ctx, {
			turns: [
				{
					who: 'captain',
					text: 'Should be longer',
					points: { kind: 'element', label: 'the “In 7 days” menu', detail: '<span>' }
				}
			],
			list: ['Turn downloads off by default']
		});
		expect(p).toContain('Shareable album links (project Lumen). Status: needs-review.');
		expect(p).toContain('Links expire after 7 days by default.');
		expect(p).toContain('- 2026-11-03 09:00 Building the share dialog');
		expect(p).toContain('Link expires In 7 days');
		expect(p).toContain('- share.png: /data/lumen-share/share.png');
		expect(p).toContain('1. Turn downloads off by default');
		expect(p).toContain('Captain: Should be longer [pointing at the “In 7 days” menu: <span>]');
	});
});

describe('readReply', () => {
	it('reads the structured answer, bounding the suggestions', () => {
		const out = JSON.stringify({
			type: 'result',
			is_error: false,
			structured_output: { reply: ' Fair. ', suggest: ['One', ' ', 'Two', 'Three', 'Four'] }
		});
		expect(readReply(out)).toEqual({ reply: 'Fair.', suggest: ['One', 'Two', 'Three'] });
	});

	it('falls back to the result text, and reads nothing from an error or garbage', () => {
		expect(readReply(JSON.stringify({ result: '{"reply":"Yes","suggest":[]}' }))).toEqual({
			reply: 'Yes',
			suggest: []
		});
		expect(readReply(JSON.stringify({ result: 'Plain words' }))).toEqual({
			reply: 'Plain words',
			suggest: []
		});
		expect(readReply(JSON.stringify({ is_error: true, result: 'x' }))).toBeNull();
		expect(readReply('not json')).toBeNull();
	});
});

describe('pageText', () => {
	it('keeps what a reader sees, without scripts, styles or tags', () => {
		const html =
			'<html><head><style>p{color:red}</style><script>var x = "<b>no</b>";</script></head><body><h1>Share</h1><p>Anyone with the link &amp; no account.</p><!-- hidden --></body></html>';
		expect(pageText(html)).toBe('Share\nAnyone with the link & no account.');
		expect(pageText('<p>' + 'word '.repeat(50) + '</p>', 20)).toHaveLength(20);
	});
});

describe('batchText and parseBatch', () => {
	it('sends the list as one message for the task, and reads it back', () => {
		const text = batchText(
			{ id: 'lumen-share', title: 'Shareable  album links' },
			'http://127.0.0.1:5240/',
			[
				{
					text: 'Make links last 30 days',
					points: { kind: 'element', label: 'the “In 7 days” menu', detail: null }
				},
				{ text: 'Turn downloads off by default' }
			]
		);
		expect(text).toBe(
			[
				'Preview feedback for lumen-share (Shareable album links), sent together from the Preview tab (http://127.0.0.1:5240/):',
				'1. Make links last 30 days',
				'   Points at: the “In 7 days” menu',
				'2. Turn downloads off by default',
				'',
				'Firstmate: pass these to this task’s worker, the same task (start no new one). You may add notes of your own, marked as yours.'
			].join('\n')
		);
		expect(parseBatch(text)).toEqual({
			taskId: 'lumen-share',
			title: 'Shareable album links',
			url: 'http://127.0.0.1:5240/',
			plugin: null,
			items: [
				{ text: 'Make links last 30 days', points: 'the “In 7 days” menu' },
				{ text: 'Turn downloads off by default', points: null }
			]
		});
		expect(parseBatch('Preview looks good')).toBeNull();
	});

	it('sends a plugin’s list in the same shape, attributed to the plugin, and reads it back', () => {
		const text = pluginBatchText(
			{ id: 'lumen-plan', title: 'Plan the  share links' },
			{ id: 'plan-review', name: 'Plan review' },
			'data/lumen-plan/plan.md@abc1234: Request changes',
			[
				{
					text: 'Use a migration,\n not a raw table',
					points: '“1. Add the widget table.” (line 5)'
				},
				{ text: 'Say who owns the rollout', points: null }
			]
		);
		expect(text).toBe(
			[
				'Feedback for lumen-plan (Plan the share links), sent together from the “Plan review” plugin (plan-review), about data/lumen-plan/plan.md@abc1234: Request changes:',
				'1. Use a migration, not a raw table',
				'   Points at: “1. Add the widget table.” (line 5)',
				'2. Say who owns the rollout',
				'',
				'Firstmate: pass these to this task’s worker, the same task (start no new one). You may add notes of your own, marked as yours.'
			].join('\n')
		);
		expect(parseBatch(text)).toEqual({
			taskId: 'lumen-plan',
			title: 'Plan the share links',
			url: null,
			plugin: {
				id: 'plan-review',
				name: 'Plan review',
				subject: 'data/lumen-plan/plan.md@abc1234: Request changes'
			},
			items: [
				{ text: 'Use a migration, not a raw table', points: '“1. Add the widget table.” (line 5)' },
				{ text: 'Say who owns the rollout', points: null }
			]
		});
	});

	it('leaves out an empty subject, and keeps quotes out of the plugin’s name', () => {
		const text = pluginBatchText(
			{ id: 't', title: 'T' },
			{ id: 'acme', name: '“Acme” review' },
			'  ',
			[{ text: 'One' }]
		);
		expect(text.split('\n')[0]).toBe(
			'Feedback for t (T), sent together from the “Acme review” plugin (acme):'
		);
		expect(parseBatch(text)?.plugin).toEqual({ id: 'acme', name: 'Acme review', subject: null });
	});
});

describe('the summary of a feedback list', () => {
	const req = {
		task: { id: 'lumen-checkout', title: 'Checkout   page' },
		subject: 'the shared review “Checkout” (3 comments)',
		items: [
			{ text: 'Ana: Bigger button — Ben replied: Agreed', points: 'the “Pay now” button on /' },
			{ text: 'Cy: Thanks!', points: null }
		]
	};

	it('gives the helper the task, what the list is about and the numbered items', () => {
		const p = summaryPrompt(req);
		expect(p).toContain('# The task\nCheckout page (lumen-checkout).');
		expect(p).toContain('# What the list is about\nthe shared review “Checkout” (3 comments)');
		expect(p).toContain(
			'1. Ana: Bigger button — Ben replied: Agreed\n   Points at: the “Pay now” button on /\n2. Cy: Thanks!'
		);
		expect(summaryPrompt({ ...req, subject: null })).toContain('Feedback on the task.');
	});

	it('reads the points, bounded, each naming only items that exist', () => {
		const out = JSON.stringify({
			structured_output: {
				points: [
					{
						text: '  Make the  button bigger ',
						points: 'the “Pay now” button',
						from: [1, 1, 9, 0]
					},
					{ text: ' ', points: '', from: [2] },
					{ text: 'Fix the total', points: '', from: ['2', 2] },
					{ text: 'x'.repeat(900), points: 'y'.repeat(400), from: [] }
				]
			}
		});
		const r = readSummary(out, 2)!;
		expect(r.slice(0, 2)).toEqual([
			{ text: 'Make the button bigger', points: 'the “Pay now” button', from: [1] },
			{ text: 'Fix the total', points: null, from: [2] }
		]);
		expect(r[2].text.length).toBe(500);
		expect(r[2].points!.length).toBe(200);
		const many = {
			points: Array.from({ length: 40 }, (_, i) => ({ text: `P${i}`, points: '', from: [1] }))
		};
		expect(readSummary(JSON.stringify({ result: JSON.stringify(many) }), 1)).toHaveLength(30);
	});

	it('reads nothing from an error, garbage, plain words or no points', () => {
		expect(
			readSummary(JSON.stringify({ is_error: true, structured_output: { points: [] } }), 1)
		).toBeNull();
		expect(readSummary('not json', 1)).toBeNull();
		expect(readSummary(JSON.stringify({ result: 'Here are the points' }), 1)).toBeNull();
		expect(readSummary(JSON.stringify({ structured_output: { points: [] } }), 1)).toBeNull();
	});
});
