import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptySpec, type SpecDraft } from '../../spec';
import {
	applyReply,
	findInterviewSkill,
	MessageStream,
	parseReply,
	SPEC_MARKER,
	systemPrompt,
	turnPrompt
} from './interview';

const NOW = new Date('2026-10-27T09:00:00Z');
const ID = 'spec-abc123def';

function draft(): SpecDraft {
	return {
		...emptySpec(ID, NOW),
		title: 'Shared albums',
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
				}
			],
			done: false,
			usage: { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
		},
		comments: [
			{
				id: 'c-aaaaaa',
				section: 'requirements',
				quote: 'Guests',
				text: 'Only invited guests',
				at: NOW.toISOString(),
				resolvedAt: null,
				reply: ''
			},
			{
				id: 'c-bbbbbb',
				section: 'scope',
				quote: '',
				text: 'Old one',
				at: NOW.toISOString(),
				resolvedAt: NOW.toISOString(),
				reply: 'Done'
			}
		]
	};
}

describe('parseReply', () => {
	it('splits the message from the changes after the marker', () => {
		const r = parseReply(
			`Who adds photos?\n${SPEC_MARKER}\n${JSON.stringify({
				spec: { title: 'Albums', requirements: ['A', 3, 'B'], problem: 7, mode: 'form' },
				options: ['Owners', ' ', 'Guests'],
				recommended: 1,
				resolved: [{ id: 'c-aaaaaa', reply: 'Noted' }, { nope: true }],
				done: true
			})}`
		);
		expect(r).toEqual({
			message: 'Who adds photos?',
			spec: { title: 'Albums', requirements: ['A', 'B'] },
			options: ['Owners', 'Guests'],
			recommended: 1,
			resolved: [{ id: 'c-aaaaaa', reply: 'Noted' }],
			done: true
		});
	});

	it('tolerates a code fence around the JSON', () => {
		const r = parseReply(`Q?\n${SPEC_MARKER}\n\`\`\`json\n{"spec":{"goal":"G"}}\n\`\`\``);
		expect(r.spec).toEqual({ goal: 'G' });
	});

	it('treats a reply without the marker, or with broken JSON, as all message', () => {
		expect(parseReply('Just a question?')).toMatchObject({ message: 'Just a question?', spec: {} });
		expect(parseReply(`Q?\n${SPEC_MARKER}\n{not json`)).toMatchObject({
			message: 'Q?',
			spec: {},
			options: [],
			recommended: null,
			done: false
		});
	});

	it('drops a recommendation that names no option', () => {
		expect(parseReply(`Q?${SPEC_MARKER}{"options":["a"],"recommended":3}`).recommended).toBeNull();
	});
});

describe('applyReply', () => {
	it('applies the changes, resolves comments and records the turn with what changed', () => {
		const { draft: d, changed } = applyReply(
			draft(),
			{
				message: 'Next?',
				spec: { requirements: ['Invited guests can add photos'], summary: 'One album per trip.' },
				options: ['Yes', 'No'],
				recommended: 0,
				resolved: [
					{ id: 'c-aaaaaa', reply: 'Limited to invited guests' },
					{ id: 'c-bbbbbb', reply: 'again' }
				],
				done: false
			},
			NOW
		);
		expect(changed).toEqual(['project', 'requirements']);
		expect(d.requirements).toEqual(['Invited guests can add photos']);
		expect(d.comments[0]).toMatchObject({
			resolvedAt: NOW.toISOString(),
			reply: 'Limited to invited guests'
		});
		expect(d.comments[1].reply).toBe('Done');
		expect(d.interview.turns.at(-1)).toEqual({
			role: 'agent',
			text: 'Next?',
			at: NOW.toISOString(),
			options: ['Yes', 'No'],
			recommended: 0,
			changed: ['project', 'requirements']
		});
	});

	it('bounds what the agent writes like any saved draft', () => {
		const { draft: d } = applyReply(
			draft(),
			{
				message: '',
				spec: { problem: 'x'.repeat(30_000) },
				options: [],
				recommended: null,
				resolved: [],
				done: true
			},
			NOW
		);
		expect(d.problem).toHaveLength(20_000);
		expect(d.interview.done).toBe(true);
		expect(d.interview.turns.at(-1)?.text).toBe('I have updated the spec.');
	});
});

describe('turnPrompt', () => {
	it('gives the spec, the interview and only the open comments', () => {
		const p = turnPrompt(draft(), 'Shared trip albums');
		expect(p).toContain('"title": "Shared albums"');
		expect(p).toContain('Captain: Shared trip albums');
		expect(p).toContain('- [c-aaaaaa] on "Requirements", about "Guests": Only invited guests');
		expect(p).not.toContain('c-bbbbbb');
		expect(p).toMatch(/Start the interview/);
	});

	it('asks for the comments to be addressed when there is no answer', () => {
		expect(turnPrompt(draft(), null)).toMatch(/added comments on the spec/);
	});
});

describe('systemPrompt', () => {
	it('uses the skill’s words, else the bundled ones, and explains the answer format', () => {
		expect(systemPrompt('Grill me hard.')).toContain('Grill me hard.');
		expect(systemPrompt(null)).toContain('Ask the questions one at a time');
		expect(systemPrompt(null)).toContain(SPEC_MARKER);
	});
});

describe('MessageStream', () => {
	it('shows the message as it streams and nothing from the marker on', () => {
		const s = new MessageStream();
		const shown = ['Who adds ', 'photos?\n==', '=SP', 'EC===\n{"spec":', '{}}'].map((c) =>
			s.push(c)
		);
		expect(shown.join('')).toBe('Who adds photos?\n');
		expect(shown[1]).toBe('photos?\n');
	});

	it('lets text that only looked like the marker through', () => {
		const s = new MessageStream();
		expect(s.push('a ==')).toBe('a ');
		expect(s.push('= b')).toBe('=== b');
	});

	it('starts over on reset', () => {
		const s = new MessageStream();
		s.push(`x${SPEC_MARKER}`);
		s.reset();
		expect(s.push('again')).toBe('again');
	});
});

describe('findInterviewSkill', () => {
	let root: string;
	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'wh-skills-'));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});
	const skill = async (dir: string, name: string, body: string) => {
		await mkdir(path.join(root, dir, name), { recursive: true });
		await writeFile(path.join(root, dir, name, 'SKILL.md'), `---\nname: ${name}\n---\n\n${body}\n`);
	};

	it('is null when no grilling skill is installed', async () => {
		expect(await findInterviewSkill([path.join(root, 'a')])).toBeNull();
	});

	it('follows grill-me to the skill it runs, without the frontmatter', async () => {
		await skill('a', 'grill-me', 'Run a `/grilling` session.');
		await skill('b', 'grilling', 'Interview me relentlessly.');
		expect(await findInterviewSkill([path.join(root, 'a'), path.join(root, 'b')])).toBe(
			'Interview me relentlessly.'
		);
	});

	it('uses grill-me’s own words when it has them', async () => {
		await skill('a', 'grill-me', 'Ask me hard questions.');
		expect(await findInterviewSkill([path.join(root, 'a')])).toBe('Ask me hard questions.');
	});
});
