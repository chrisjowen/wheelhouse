#!/usr/bin/env node
/**
 * A stand-in for the claude CLI's headless mode (`claude -p --output-format
 * stream-json`), for tests: it reads the prompt and answers with a short,
 * fixed reply in the stream-json shape the real CLI writes.
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

const text = 'Read the prompt. Nothing more to add.';

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
