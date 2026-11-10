import { describe, expect, it, vi } from 'vitest';
import { parseBatch } from '../../previewhelper';
import type { BridgeMessage } from '../../types';
import {
	readFeedback,
	sendPluginFeedback,
	summarisePluginFeedback,
	type FeedbackDeps
} from './feedback';
import type { SendInput } from '../store/messenger';

const sent = (input: SendInput): BridgeMessage => ({
	requestId: input.requestId,
	text: input.text,
	taskId: input.taskId,
	submittedAt: '2026-11-05T09:00:00.000Z',
	delivery: 'delivered',
	deliveryDetail: null,
	acknowledged: null,
	noteId: null,
	reply: null
});

const deps = (o: Partial<FeedbackDeps> = {}): FeedbackDeps & { inputs: SendInput[] } => {
	const inputs: SendInput[] = [];
	return {
		inputs,
		sender: async (plugin, task) => ({
			ok: true,
			plugin: { id: plugin, name: 'Plan review' },
			task: { id: task, title: 'Plan the share links' }
		}),
		send: async (input) => (inputs.push(input), { ok: true, created: true, message: sent(input) }),
		...o
	};
};

describe('reading a plugin’s feedback list', () => {
	it('keeps the task, a tidied subject and the lines with words', () => {
		expect(
			readFeedback({
				taskId: 'lumen-plan',
				subject: '  plan.md:\n Request changes ',
				items: [
					{ text: ' Add a  rollback step ', points: 'line 12' },
					{ text: '   ' },
					{ text: 'Two' }
				]
			})
		).toEqual({
			ok: true,
			value: {
				taskId: 'lumen-plan',
				subject: 'plan.md: Request changes',
				items: [
					{ text: 'Add a rollback step', points: 'line 12' },
					{ text: 'Two', points: null }
				]
			}
		});
	});

	it('refuses a list it cannot send, saying why', () => {
		const why = (body: Record<string, unknown>) => {
			const r = readFeedback(body);
			return r.ok ? null : r.error;
		};
		const items = [{ text: 'One' }];
		expect(why({ items })).toBe('Name the task the feedback is about.');
		expect(why({ taskId: 't', items: 'One' })).toBe('Send the feedback as a list.');
		expect(why({ taskId: 't', items: [] })).toBe('The list is empty.');
		expect(why({ taskId: 't', items: [{ text: ' ' }] })).toBe('The list is empty.');
		expect(why({ taskId: 't', items: [{ points: 'x' }] })).toBe('Each line needs its words.');
		expect(why({ taskId: 't', items: [{ text: 'x'.repeat(501) }] })).toMatch(/longer than 500/);
		expect(why({ taskId: 't', items: [{ text: 'x', points: 3 }] })).toMatch(/must be text/);
		expect(why({ taskId: 't', items: [{ text: 'x', points: 'p'.repeat(201) }] })).toMatch(
			/longer than 200/
		);
		expect(why({ taskId: 't', subject: 4, items })).toBe('The subject must be text.');
		expect(why({ taskId: 't', subject: 's'.repeat(201), items })).toMatch(/longer than 200/);
		expect(why({ taskId: 't', items: Array.from({ length: 31 }, () => ({ text: 'x' })) })).toBe(
			'A list holds at most 30 lines.'
		);
	});
});

describe('sending a plugin’s feedback list', () => {
	it('writes it in the preview list’s shape, attributed to the plugin, as a note about the task', async () => {
		const d = deps();
		const r = await sendPluginFeedback(d, 'plan-review', 'wh-1', {
			taskId: 'lumen-plan',
			subject: 'plan.md',
			items: [{ text: 'Add a rollback step', points: 'line 12' }]
		});
		expect(r).toMatchObject({ ok: true, created: true });
		expect(d.inputs).toHaveLength(1);
		const [input] = d.inputs;
		expect(input).toMatchObject({ requestId: 'wh-1', taskId: 'lumen-plan' });
		expect(input.text.split('\n')[0]).toBe(
			'Feedback for lumen-plan (Plan the share links), sent together from the “Plan review” plugin (plan-review), about plan.md:'
		);
		expect(input.text).toContain(
			'Firstmate: pass these to this task’s worker, the same task (start no new one).'
		);
		expect(parseBatch(input.text)?.items).toEqual([
			{ text: 'Add a rollback step', points: 'line 12' }
		]);
	});

	it('sends nothing when the plugin may not, the list is bad, or there is no request id', async () => {
		const send = vi.fn();
		const refused = deps({
			send,
			sender: async () => ({
				ok: false,
				status: 403,
				error: 'The Acme plugin cannot send feedback to Firstmate.'
			})
		});
		const body = { taskId: 't', items: [{ text: 'One' }] };
		expect(await sendPluginFeedback(refused, 'acme', 'wh-1', body)).toEqual({
			ok: false,
			status: 403,
			error: 'The Acme plugin cannot send feedback to Firstmate.'
		});
		expect(await sendPluginFeedback(deps({ send }), 'acme', 'wh-1', { taskId: 't' })).toEqual({
			ok: false,
			status: 400,
			error: 'Send the feedback as a list.'
		});
		expect(await sendPluginFeedback(deps({ send }), 'acme', null, body)).toMatchObject({
			ok: false,
			status: 400
		});
		expect(send).not.toHaveBeenCalled();
	});
});

describe('summarising a plugin’s feedback list', () => {
	const sender = deps().sender;
	it('checks the list as a send would, and hands the helper the task, subject and lines', async () => {
		const summarise = vi.fn(async () => ({
			ok: true as const,
			points: [{ text: 'Add a rollback step', points: 'line 12', from: [1] }]
		}));
		const r = await summarisePluginFeedback({ sender, summarise }, 'plan-review', {
			taskId: 'lumen-plan',
			subject: ' plan.md ',
			items: [{ text: ' Add  a rollback step ', points: 'line 12' }, { text: ' ' }]
		});
		expect(r).toEqual({
			ok: true,
			points: [{ text: 'Add a rollback step', points: 'line 12', from: [1] }]
		});
		expect(summarise.mock.calls).toEqual([
			[
				{
					task: { id: 'lumen-plan', title: 'Plan the share links' },
					subject: 'plan.md',
					items: [{ text: 'Add a rollback step', points: 'line 12' }]
				}
			]
		]);
	});

	it('asks the helper nothing when the plugin may not or the list is bad, and passes on its failure', async () => {
		const summarise = vi.fn();
		const refused = {
			summarise,
			sender: async () => ({
				ok: false as const,
				status: 403 as const,
				error: 'No feedback capability.'
			})
		};
		expect(
			await summarisePluginFeedback(refused, 'acme', { taskId: 't', items: [{ text: 'One' }] })
		).toEqual({ ok: false, status: 403, error: 'No feedback capability.' });
		expect(await summarisePluginFeedback({ sender, summarise }, 'acme', { taskId: 't' })).toEqual({
			ok: false,
			status: 400,
			error: 'Send the feedback as a list.'
		});
		expect(summarise).not.toHaveBeenCalled();
		const down = async () => ({
			ok: false as const,
			status: 503,
			error: 'Claude Code is not installed.'
		});
		expect(
			await summarisePluginFeedback({ sender, summarise: down }, 'acme', {
				taskId: 't',
				items: [{ text: 'One' }]
			})
		).toEqual({ ok: false, status: 503, error: 'Claude Code is not installed.' });
	});
});
