import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Crew, readCrewLine, type CrewEvent } from './crew';
import { catchUp } from './sessions';
import { cleanSvg } from './illustrate';
import { digest } from './context';

const line = (o: object) => `${JSON.stringify(o)}\n`;
const delta = (text: string) =>
	line({
		type: 'stream_event',
		event: { type: 'content_block_delta', delta: { type: 'text_delta', text } }
	});

/** A stand-in for Claude Code: what was written to it, and a way to answer. */
function fakeClaude() {
	const proc = new EventEmitter() as ChildProcessWithoutNullStreams;
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const written: Record<string, unknown>[] = [];
	stdin.on('data', (d: Buffer) => {
		for (const l of d.toString().split('\n').filter(Boolean)) written.push(JSON.parse(l));
	});
	Object.assign(proc, { stdin, stdout, stderr: new PassThrough(), kill: () => true });
	return { proc, written, say: (s: string) => stdout.write(s) };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('the discussion crew', () => {
	it('reads Claude Code’s stream-json lines', () => {
		expect(readCrewLine(delta('Hi'))).toEqual({ kind: 'text', text: 'Hi' });
		expect(readCrewLine(line({ type: 'result', subtype: 'error_during_execution' }))).toEqual({
			kind: 'result',
			ok: false,
			error: null
		});
		expect(
			readCrewLine(
				line({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' })
			)
		).toEqual({ kind: 'result', ok: false, error: 'Not logged in' });
		expect(readCrewLine('not json')).toBeNull();
	});

	it('streams a reply, interrupts it for newer words, and writes the briefing', async () => {
		const fake = fakeClaude();
		const crew = new Crew({
			context: 'ctx',
			claude: 'claude',
			model: 'sonnet',
			launch: { tools: ['Read'], allowed: ['Read'], mcpConfig: null, skills: [], readable: [] },
			start: () => fake.proc
		});
		await crew.start();
		const events: CrewEvent[] = [];
		crew.on((e) => events.push(e));

		const first = crew.say('what about the gateway');
		fake.say(delta('It is mostly '));
		await tick();
		const second = crew.say('stop, anything blocked?');
		expect(fake.written.map((w) => w.type)).toEqual(['user', 'control_request', 'user']);
		fake.say(line({ type: 'result', subtype: 'error_during_execution' }));
		fake.say(delta('One thing.'));
		fake.say(line({ type: 'result', subtype: 'success' }));
		await tick();
		expect(events).toEqual([
			{ type: 'delta', turn: first, text: 'It is mostly ' },
			{ type: 'done', turn: first, ok: false },
			{ type: 'delta', turn: second, text: 'One thing.' },
			{ type: 'done', turn: second, ok: true }
		]);

		const brief = crew.brief();
		await tick();
		fake.say(delta('**Summary:** asked about blocks.'));
		fake.say(line({ type: 'result', subtype: 'success' }));
		expect(await brief).toBe('**Summary:** asked about blocks.');
		expect(crew.transcript.map((t) => t.who)).toEqual(['captain', 'captain', 'crew', 'crew']);
	});
});

describe('catch-up and context', () => {
	const task = (id: string, status: string, statusLabel: string) =>
		({
			id,
			status,
			statusLabel,
			shortTitle: id,
			title: id,
			summary: '',
			projectId: 'p',
			pr: null,
			preview: null
		}) as never;
	const card = (id: string) =>
		({
			id,
			taskId: id,
			taskTitle: id,
			question: `${id}?`,
			kind: 'blocked',
			options: [],
			recommendation: null
		}) as never;

	it('says what moved while the captain talked', () => {
		expect(
			catchUp(
				{ fleet: { tasks: [task('a', 'working', 'Working')] }, inbox: { cards: [card('x')] } },
				{
					fleet: { tasks: [task('a', 'landed', 'Landed'), task('b', 'queued', 'Queued')] },
					inbox: { cards: [card('y')] }
				}
			).map((i) => `${i.kind}:${i.task}`)
		).toEqual(['moved:a', 'new:b', 'decision:y', 'cleared:x']);
	});

	it('briefs the crew on work in flight, decisions and the chat', () => {
		const text = digest({
			fleet: { tasks: [task('gw-deploy', 'working', 'Working')], secondMates: [] },
			inbox: { cards: [card('gw-deploy')] },
			chat: [{ who: 'captain', at: '2026-11-16T10:00:00Z', text: 'how is the gateway' }],
			status: new Map([['gw-deploy', ['working: deploying']]]),
			reports: new Map(),
			now: new Date('2026-11-16T12:00:00Z')
		});
		expect(text).toContain('- [gw-deploy] (p) gw-deploy');
		expect(text).toContain('Latest status lines: working: deploying');
		expect(text).toContain('CAPTAIN (10:00Z): how is the gateway');
	});

	it('opens on the decision the captain chose, in full: its calls, why, its note and its report', () => {
		const trust = {
			...(card('trust') as object),
			id: 'trust:captain-hold',
			kind: 'hold',
			title: 'Trust design: accept the 2 recommendations?',
			question: 'Trust design has 2 calls.',
			origin: 'docket-trust-design',
			evidence: { text: 'The design is ready.', preview: 'http://127.0.0.1:4871/' },
			choices: {
				intro: 'Trust design has 2 calls.',
				after: null,
				calls: [
					{
						id: 'D1',
						number: null,
						tag: 'D1',
						key: true,
						why: 'Simplest.',
						prompt: 'Where do the rules live?',
						required: true,
						options: [
							{ id: 'a', label: 'a', detail: 'Per workspace', recommended: true },
							{ id: 'b', label: 'b', detail: 'Per org', recommended: false }
						]
					}
				]
			}
		} as never;
		const text = digest({
			fleet: { tasks: [], secondMates: [] },
			inbox: { cards: [trust] },
			chat: [],
			status: new Map(),
			reports: new Map(),
			focus: { card: trust, report: '## 9. Captain decisions\n| D1 | … |' },
			now: new Date('2026-11-16T12:00:00Z')
		});
		const focus = text.slice(0, text.indexOf('## In flight'));
		expect(focus).toContain('## The decision the captain opened Live to talk through');
		expect(focus).toContain(
			'Decision id: trust:captain-hold (task trust, from docket-trust-design)'
		);
		expect(focus).toContain('- D1) Where do the rules live? [call D1] (matters most)');
		expect(focus).toContain('  a) Per workspace (recommended)');
		expect(focus).toContain('  Why the recommendation: Simplest.');
		expect(focus).toContain("Firstmate's note on it:\nThe design is ready.");
		expect(focus).toContain('Live preview: http://127.0.0.1:4871/');
		expect(focus).toContain('## 9. Captain decisions');
		// Every decision in the list names its id and its calls, for the crew's decision blocks.
		expect(text).toContain('hold (decision id trust:captain-hold): Trust design has 2 calls.');
		expect(text).toContain(
			'  D1) Where do the rules live? [call D1]: a) Per workspace (recommended) / b) Per org'
		);
	});
});

describe('cleanSvg', () => {
	it('keeps only the picture, with nothing that could run', () => {
		expect(
			cleanSvg(
				'Here: <svg viewBox="0 0 1 1" onload="x()"><script>x()</script><a href="javascript:x()"><rect/></a></svg> done'
			)
		).toBe('<svg viewBox="0 0 1 1"><a href="#"><rect/></a></svg>');
		expect(cleanSvg('no picture')).toBeNull();
	});
});
