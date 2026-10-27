#!/usr/bin/env node
/**
 * A stand-in for the claude CLI's headless mode (`claude -p --output-format
 * stream-json`), for tests and for trying the Spec tab without spending
 * tokens: point WHEELHOUSE_CLAUDE_BIN at this file. It plays a short, scripted
 * spec interview about a synthetic photo-album feature, answering in the
 * stream-json shape the real CLI writes, and resolves any open comments it is
 * given by adding them to the requirements.
 *
 * FAKE_CLAUDE_DELAY_MS slows the stream so it can be watched;
 * FAKE_CLAUDE_ARGS_FILE records the arguments it was started with;
 * a prompt containing FAKE_CLAUDE_FAIL makes it fail like an API error, as
 * does an ANTHROPIC_API_KEY of `bad` (the real CLI prefers a key to the login).
 */
import { appendFileSync } from 'node:fs';

const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (process.env.FAKE_CLAUDE_ARGS_FILE) {
	appendFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(process.argv.slice(2)) + '\n');
}

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;

const spec = (() => {
	const m = prompt.match(/# The spec so far\n\n([\s\S]*?)\n\n# /);
	try {
		return m ? JSON.parse(m[1]) : {};
	} catch {
		return {};
	}
})();
const answers = (prompt.match(/^Captain: /gm) ?? []).length;
const comments = [
	...prompt.matchAll(/^- \[(c-[0-9a-z]+)\] on "([^"]+)"(?:, about "[^"]*")?: (.*)$/gm)
];

const STEPS = [
	{
		message:
			'Got it: one album a whole family can add to after a trip.\n\n**Who should be able to add photos?** Only people with an account, or guests too?',
		spec: {
			title: 'Shared trip albums',
			project: spec.project || 'photo-library',
			summary: 'Let a family add their photos from a trip to one album and see each other’s.',
			problem: 'Photos from one trip end up scattered across several phones.',
			goal: 'Everyone adds to one album and sees the lot.'
		},
		options: ['Account holders only', 'Anyone with the link', 'Guests invited by email'],
		recommended: 2
	},
	{
		message:
			'Invited guests it is: no account, but no open links either.\n\n**What should a guest be able to do once they are in?**',
		spec: {
			audience: 'Families sharing trip photos, mostly on phones, a few times a year.',
			journeys: [
				'Owner creates a shared album and invites people by email',
				'A guest opens the invite and adds photos without making an account'
			],
			requirements: ['A guest can add photos from an email invite without making an account']
		},
		options: ['Add and view only', 'Add, view and remove their own', 'Everything the owner can do'],
		recommended: 1
	},
	{
		message:
			'Guests manage their own photos; the owner manages everything.\n\n**How large can one upload be?** Phones on hotel Wi-Fi are slow.',
		spec: {
			scope: 'Creating albums, inviting by email, adding and removing photos.',
			nonGoals: 'Comments, likes and public links.',
			requirements: [
				'A guest can add photos from an email invite without making an account',
				'A guest can remove photos they added, and only those',
				'The owner can remove any photo'
			]
		},
		options: ['Up to 50 photos at a time', 'No limit, resumable uploads', 'Up to 200 MB at a time'],
		recommended: 1
	},
	{
		message:
			'That covers the problem, the people, the journeys, scope, requirements and the main risk. **The spec looks ready to send to build.** Is anything missing?',
		spec: {
			requirements: [
				'A guest can add photos from an email invite without making an account',
				'A guest can remove photos they added, and only those',
				'The owner can remove any photo',
				'An interrupted upload resumes where it stopped'
			],
			constraints: 'Originals stay private to the album’s members.',
			risks: 'Very large uploads on slow connections.',
			questions: []
		},
		options: ['Nothing missing, it is ready', 'One more thing…'],
		recommended: 0,
		done: true
	}
];
const step = STEPS[Math.min(Math.max(answers - 1, 0), STEPS.length - 1)];
const fresh = answers - 1 >= STEPS.length;

const changes = fresh && !comments.length ? {} : { ...step.spec };
// Requirements build up: earlier ones (including any from comments) are kept.
if (changes.requirements) {
	changes.requirements = [...new Set([...(spec.requirements ?? []), ...changes.requirements])];
}
if (comments.length) {
	changes.requirements = [
		...(changes.requirements ?? spec.requirements ?? []),
		...comments.map((c) => c[3])
	];
}
const message = comments.length
	? `I have worked your ${comments.length === 1 ? 'comment' : `${comments.length} comments`} into the requirements.\n\n${step.message}`
	: fresh
		? 'Nothing more from me: the spec is ready to send to build when you are.'
		: step.message;
const tail = {
	spec: changes,
	options: fresh ? [] : step.options,
	recommended: fresh ? null : step.recommended,
	resolved: comments.map((c) => ({ id: c[1], reply: `Added to the requirements: “${c[3]}”.` })),
	done: fresh || !!step.done
};
const text = `${message}\n===SPEC===\n${JSON.stringify(tail)}`;

out({ type: 'system', subtype: 'init', session_id: 'fake', tools: [], model: 'fake' });
out({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } });
if (prompt.includes('FAKE_CLAUDE_FAIL') || process.env.ANTHROPIC_API_KEY === 'bad') {
	out({
		type: 'result',
		subtype: 'success',
		is_error: true,
		result: 'Invalid API key · Fix external API key',
		total_cost_usd: 0,
		usage: { input_tokens: 0, output_tokens: 0 }
	});
	process.exit(1);
}
for (const piece of text.match(/[\s\S]{1,12}/g) ?? []) {
	out({
		type: 'stream_event',
		event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }
	});
	if (delay) await sleep(delay);
}
out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
out({
	type: 'result',
	subtype: 'success',
	is_error: false,
	result: text,
	total_cost_usd: 0.0123,
	usage: {
		input_tokens: 1200,
		cache_read_input_tokens: 800,
		cache_creation_input_tokens: 0,
		output_tokens: 150
	}
});
