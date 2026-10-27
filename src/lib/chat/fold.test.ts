import { describe, expect, it } from 'vitest';
import { activitySummary, describeTool, duration, fold, type Turn } from './fold';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

// Synthetic records shaped like Claude Code 2.1.x transcript lines (never real ones).
let n = 0;
const t0 = Date.parse('2026-01-01T10:00:00Z');
const at = (s: number) => new Date(t0 + s * 1000).toISOString();
const id = () => `r${++n}`;
const typed = (text: string, s = 0): Rec => ({
	type: 'user',
	uuid: id(),
	timestamp: at(s),
	origin: { kind: 'human' },
	message: { role: 'user', content: text }
});
const thinking = (s: number): Rec => ({
	type: 'assistant',
	uuid: id(),
	timestamp: at(s),
	message: {
		id: 'm',
		role: 'assistant',
		content: [{ type: 'thinking', thinking: '', signature: 'x' }]
	}
});
const say = (text: string, s = 0): Rec => ({
	type: 'assistant',
	uuid: id(),
	timestamp: at(s),
	message: { id: 'm', role: 'assistant', content: [{ type: 'text', text }] }
});
const call = (toolId: string, name: string, input: Rec, s = 0): Rec => ({
	type: 'assistant',
	uuid: id(),
	timestamp: at(s),
	message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: toolId, name, input }] }
});
const result = (toolId: string, content: unknown, extra: Rec = {}, s = 0): Rec => ({
	type: 'user',
	uuid: id(),
	timestamp: at(s),
	message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content }] },
	...extra
});
const ended = (ms: number, s = 0): Rec => ({
	type: 'system',
	subtype: 'turn_duration',
	uuid: id(),
	timestamp: at(s),
	durationMs: ms
});
const wake = (s = 0): Rec => ({
	type: 'user',
	uuid: id(),
	timestamp: at(s),
	origin: { kind: 'task-notification' },
	message: {
		role: 'user',
		content:
			'<task-notification>\n<summary>Stop hook feedback: a crew status changed</summary>\n</task-notification>'
	}
});

describe('fold', () => {
	it('folds a turn into collapsed activity and a Markdown reply', () => {
		const chat = fold([
			typed('Where are we?', 0),
			thinking(4),
			call('t1', 'Bash', { command: 'git status', description: 'Check the tree' }, 5),
			result('t1', 'clean', {}, 6),
			say('All **clean**.', 7),
			ended(7000, 7)
		]);
		expect(chat.items.map((i) => i.kind)).toEqual(['user', 'turn']);
		const turn = chat.items[1] as Turn;
		expect(turn.done).toBe(true);
		expect(turn.durationMs).toBe(7000);
		expect(turn.parts.map((p) => p.kind)).toEqual(['activity', 'text']);
		const steps = (turn.parts[0] as { steps: any[] }).steps;
		expect(steps[0]).toMatchObject({ kind: 'thinking', ms: 4000 });
		expect(steps[1]).toMatchObject({
			kind: 'tool',
			verb: 'Ran',
			summary: 'Check the tree',
			result: 'clean',
			isError: false
		});
	});

	it('shows a message typed while Firstmate was busy, which has no user record', () => {
		const chat = fold([
			typed('First', 0),
			call('t1', 'Bash', { command: 'sleep 9' }, 1),
			{
				type: 'attachment',
				uuid: id(),
				timestamp: at(2),
				attachment: { type: 'queued_command', prompt: 'Also this', commandMode: 'prompt' }
			},
			say('Done both.', 3)
		]);
		const users = chat.items.filter((i) => i.kind === 'user');
		expect(users.map((u) => [u.text, u.queued])).toEqual([
			['First', false],
			['Also this', true]
		]);
	});

	it('shows a large paste as what the captain wrote, without its wrapper tags', () => {
		const chat = fold([
			typed('<pasted_content id="c952">\nLine one\nLine two\n</pasted_content id="c952">', 0),
			{
				type: 'attachment',
				uuid: id(),
				timestamp: at(2),
				attachment: {
					type: 'queued_command',
					prompt: 'See this:\n\n<pasted_content id="1758">\nlog\n</pasted_content id="1758">',
					commandMode: 'prompt'
				}
			}
		]);
		expect(chat.items.map((i) => i.kind === 'user' && i.text)).toEqual([
			'Line one\nLine two',
			'See this:\n\nlog'
		]);
	});

	it('shows a message handed over mid-turn as the captain\'s, where Firstmate read it', () => {
		const chat = fold([
			typed('Start the build', 0),
			{
				type: 'user',
				uuid: id(),
				timestamp: at(2),
				isMeta: true,
				message: {
					role: 'user',
					content:
						'<system-reminder>\nThe user sent a new message while you were working:\n<pasted_content id="a1">\nAlso the docs\n\nand the footer\n</pasted_content id="a1">\n\nIMPORTANT: After completing your current task, you MUST address the user\'s message above.\n</system-reminder>'
				}
			}
		]);
		expect(chat.items.map((i) => i.kind === 'user' && [i.text, i.queued])).toEqual([
			['Start the build', false],
			['Also the docs\n\nand the footer', true]
		]);
	});

	it('keeps injected skill bodies and hook context inside the activity, not as messages', () => {
		const chat = fold([
			typed('/bearings', 0),
			call('s1', 'Skill', { skill: 'bearings' }, 1),
			{
				type: 'user',
				uuid: id(),
				timestamp: at(2),
				isMeta: true,
				sourceToolUseID: 's1',
				message: {
					role: 'user',
					content: [{ type: 'text', text: 'Base directory for this skill: /x' }]
				}
			},
			say('Here are your bearings.', 3)
		]);
		expect(chat.items.filter((i) => i.kind === 'user')).toHaveLength(1);
		const steps = ((chat.items[1] as Turn).parts[0] as { steps: any[] }).steps;
		expect(steps.map((s) => s.label ?? s.verb)).toEqual([
			'Used skill',
			'Skill instructions loaded'
		]);
	});

	it('strips system reminders from the captain message and skips helper sidechains', () => {
		const chat = fold([
			typed('Hello<system-reminder>internal</system-reminder>', 0),
			{ ...say('helper chatter', 1), isSidechain: true },
			say('Hi.', 2)
		]);
		expect(chat.items[0]).toMatchObject({ kind: 'user', text: 'Hello' });
		expect((chat.items[1] as Turn).parts).toEqual([expect.objectContaining({ text: 'Hi.' })]);
	});

	describe('background supervision wakes', () => {
		it('hides a wake whose reply is only the all-clear, and counts it as a quiet check', () => {
			const chat = fold([
				typed('Hi', 0),
				say('Hello.', 1),
				ended(1000, 1),
				wake(10),
				call('t1', 'Bash', { command: 'fm-crew-state.sh' }, 11),
				result('t1', 'ok', {}, 12),
				say('Captain, shipshape.', 13),
				ended(3000, 13)
			]);
			expect(chat.items.map((i) => i.kind)).toEqual(['user', 'turn']);
			expect(chat.checks).toEqual([
				expect.objectContaining({ outcome: 'quiet', done: true, durationMs: 3000 })
			]);
		});

		it('shows a wake with something to say as an ordinary message, with no notice', () => {
			const chat = fold([
				wake(0),
				say('The skeleton PR is ready for your review.', 1),
				ended(1000, 1)
			]);
			expect(chat.items).toHaveLength(1);
			expect(chat.items[0]).toMatchObject({ kind: 'turn', trigger: 'background' });
			expect(chat.checks[0].outcome).toBe('reported');
		});

		it('treats a wake turn superseded by a later one as finished', () => {
			const chat = fold([wake(0), say('Captain, shipshape.', 1), wake(5), thinking(6)]);
			expect(chat.checks.map((c) => c.done)).toEqual([true, false]);
		});

		it('never treats a typed message as a wake', () => {
			const chat = fold([wake(0), typed('Status?', 1), say('Captain, shipshape.', 2), ended(1, 2)]);
			expect(chat.items.map((i) => i.kind)).toEqual(['user', 'turn']);
			expect(chat.checks).toEqual([]);
		});
	});

	describe('questions', () => {
		const ask = (s = 1) =>
			call(
				'q1',
				'AskUserQuestion',
				{
					questions: [
						{
							header: 'Pet',
							question: 'Cat or dog?',
							multiSelect: false,
							options: [
								{ label: 'Cat', description: 'A cat' },
								{ label: 'Dog', description: 'A dog' }
							]
						}
					]
				},
				s
			);

		it('makes a question its own part, with its options', () => {
			const chat = fold([typed('Ask me', 0), ask()]);
			const part = (chat.items[1] as Turn).parts[0];
			expect(part).toMatchObject({ kind: 'question', id: 'q1', answers: null });
			expect(
				(part as { questions: { options: { label: string }[] }[] }).questions[0].options.map(
					(o) => o.label
				)
			).toEqual(['Cat', 'Dog']);
		});

		it('records the answers once given', () => {
			const chat = fold([
				typed('Ask me', 0),
				ask(),
				result('q1', 'Your questions have been answered: "Cat or dog?"="Dog".', {
					toolUseResult: { answers: { 'Cat or dog?': 'Dog' } }
				})
			]);
			expect((chat.items[1] as Turn).parts[0]).toMatchObject({ answers: { 'Cat or dog?': 'Dog' } });
		});

		it('reads the answers from the result text when the structured form is absent', () => {
			const chat = fold([
				ask(),
				result(
					'q1',
					'Your questions have been answered: "Cat or dog?"="Cat". You can now continue.'
				)
			]);
			expect((chat.items[0] as Turn).parts[0]).toMatchObject({ answers: { 'Cat or dog?': 'Cat' } });
		});

		it('keeps a background wake that asks a question in the chat', () => {
			const chat = fold([wake(0), ask(1)]);
			expect(chat.items).toHaveLength(1);
			expect(chat.checks[0].outcome).toBe('reported');
		});
	});

	it('shows a slash command and its output, without terminal colour codes', () => {
		const chat = fold([
			{
				type: 'system',
				subtype: 'local_command',
				uuid: id(),
				timestamp: at(0),
				content:
					'<command-name>/context</command-name>\n<command-message>context</command-message>\n<command-args></command-args>'
			},
			{
				type: 'system',
				subtype: 'local_command',
				uuid: id(),
				timestamp: at(1),
				content: '<local-command-stdout>\u001b[1mContext Usage\u001b[22m 12%</local-command-stdout>'
			},
			{
				type: 'user',
				uuid: id(),
				timestamp: at(1),
				isMeta: true,
				message: { role: 'user', content: '## Context Usage (copy for the model)' }
			}
		]);
		expect(chat.items).toEqual([
			expect.objectContaining({ kind: 'user', text: '/context', command: true }),
			expect.objectContaining({ kind: 'output', text: 'Context Usage 12%' })
		]);
	});

	it('marks a turn the captain interrupted', () => {
		const chat = fold([
			typed('Count', 0),
			say('1 2 3', 1),
			{
				type: 'user',
				uuid: id(),
				timestamp: at(2),
				message: {
					role: 'user',
					content: [{ type: 'text', text: '[Request interrupted by user]' }]
				}
			}
		]);
		expect(chat.items.map((i) => i.kind)).toEqual(['user', 'turn']);
		expect((chat.items[1] as Turn).interrupted).toBe(true);
	});

	it('keeps the latest session title and the away summary', () => {
		const chat = fold([
			{ type: 'ai-title', aiTitle: 'One' },
			{ type: 'ai-title', aiTitle: 'Two' },
			{
				type: 'system',
				subtype: 'away_summary',
				uuid: id(),
				timestamp: at(0),
				content: 'Two PRs landed.'
			}
		]);
		expect(chat.title).toBe('Two');
		expect(chat.items[0]).toMatchObject({ kind: 'notice', detail: 'Two PRs landed.' });
	});

	it('pairs a failed tool result with its call', () => {
		const chat = fold([
			call('t1', 'Read', { file_path: '/a/b/notes.md' }, 0),
			result('t1', 'no such file')
		]);
		const step = ((chat.items[0] as Turn).parts[0] as { steps: any[] }).steps[0];
		expect(step).toMatchObject({ verb: 'Read', summary: 'notes.md', result: 'no such file' });
		const failed = fold([
			call('t2', 'Bash', { command: 'false' }, 0),
			{
				type: 'user',
				uuid: id(),
				timestamp: at(1),
				message: {
					role: 'user',
					content: [{ type: 'tool_result', tool_use_id: 't2', content: 'exit 1', is_error: true }]
				}
			}
		]);
		expect(((failed.items[0] as Turn).parts[0] as { steps: any[] }).steps[0].isError).toBe(true);
	});
});

describe('describeTool', () => {
	it('says what a tool did in plain words', () => {
		expect(describeTool('WebSearch', { query: 'tmux paste' })).toMatchObject({
			verb: 'Searched the web for',
			summary: 'tmux paste'
		});
		expect(describeTool('WebFetch', { url: 'https://example.com/a' }).summary).toBe('example.com');
		expect(describeTool('mcp__github__get_issue', {}).summary).toBe('get issue (github)');
		expect(describeTool('Mystery', {}).summary).toBe('Mystery');
	});
});

describe('activitySummary', () => {
	it('counts tool calls by kind', () => {
		const tool = (noun: [string, string]) =>
			({
				kind: 'tool',
				id: id(),
				name: 'x',
				verb: '',
				summary: '',
				noun,
				input: {},
				result: null,
				isError: false
			}) as const;
		expect(
			activitySummary([
				tool(['command', 'commands']),
				tool(['command', 'commands']),
				tool(['skill', 'skills'])
			])
		).toBe('2 commands, 1 skill');
	});

	it('names thinking alone by how long it took', () => {
		expect(activitySummary([{ kind: 'thinking', id: 'a', ms: 7200 }])).toBe('Thought for 7s');
		expect(activitySummary([{ kind: 'thinking', id: 'a', ms: 200 }])).toBe('Thought briefly');
		expect(activitySummary([{ kind: 'context', id: 'a', label: 'x', detail: '' }])).toBe(
			'Read some context'
		);
	});
});

describe('duration', () => {
	it('is short and readable', () => {
		expect(duration(null)).toBe('');
		expect(duration(5000)).toBe('5s');
		expect(duration(125_000)).toBe('2m 5s');
		expect(duration(3_780_000)).toBe('1h 3m');
	});
});
