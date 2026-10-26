#!/usr/bin/env node
// A stand-in for `claude -p --output-format stream-json` in the PR review tests.
// It logs its arguments and prompt to $FAKE_CLAUDE_LOG, then answers in stream-json:
//   the guide (system prompt mentions "review guide"): a JSON guide naming the hunks it was shown,
//     the first as key with a recorded why citing the first record label, the second inferred;
//   anything else: a Markdown answer, streamed in three text deltas.
// FAKE_CLAUDE_MODE: ok | error (an API error result) | slow (waits 5 s between deltas) | garbage (no JSON)
// FAKE_CLAUDE_DELAY: milliseconds between deltas in ok mode (default 5)
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const system = args[args.indexOf('--system-prompt') + 1] ?? '';
const model = args[args.indexOf('--model') + 1] ?? 'sonnet';
if (process.env.FAKE_CLAUDE_LOG)
	appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, input }) + '\n');
const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
const out = (v) => process.stdout.write(JSON.stringify(v) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delta = (text) =>
	out({
		type: 'stream_event',
		event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
	});

out({ type: 'system', subtype: 'init', model });
if (mode === 'error') {
	out({
		type: 'result',
		subtype: 'success',
		is_error: true,
		result: 'Invalid API key',
		total_cost_usd: 0,
		usage: {}
	});
	process.exit(1);
}

let text;
if (/review guide/.test(system)) {
	const hunks = [
		...new Set([...input.matchAll(/\[hunk (h[0-9a-f]+(?:-\d+)?)\]/g)].map((m) => m[1]))
	];
	const labels = [...new Set([...input.matchAll(/^\[([A-Z]\d+)\] /gm)].map((m) => m[1]))];
	text =
		mode === 'garbage'
			? 'I could not do that.'
			: JSON.stringify({
					summary: 'Adds a greeting.',
					items: hunks.map((h, i) => ({
						hunk: h,
						importance: i === 0 ? 'key' : i === 1 ? 'notable' : 'routine',
						kind: i === 0 ? 'behaviour' : 'other',
						title: `Change ${i + 1}`,
						what: `What change ${i + 1} does.`,
						why:
							i === 0
								? `Because the captain asked [${labels[0]}].`
								: i === 1
									? 'It looks tidier.'
									: null,
						basis: i === 0 ? 'recorded' : i === 1 ? 'recorded' : 'none',
						sources: i === 0 ? [labels[0], 'Z9'] : []
					}))
				});
} else {
	const q = /## The captain's question\n([\s\S]*)$/.exec(input)?.[1]?.trim();
	text = q ? `You asked: **${q}**. The records say [I1].` : 'Looks right. No issues found.';
}
const parts = [text.slice(0, 10), text.slice(10, 20), text.slice(20)];
for (const p of parts) {
	delta(p);
	if (mode === 'slow') await sleep(5000);
	else await sleep(Number(process.env.FAKE_CLAUDE_DELAY ?? 5));
}
out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
out({
	type: 'result',
	subtype: 'success',
	is_error: false,
	result: text,
	total_cost_usd: 0.0123,
	duration_ms: 2100,
	usage: {
		input_tokens: 1200,
		output_tokens: 80,
		cache_read_input_tokens: 300,
		cache_creation_input_tokens: 0
	},
	modelUsage: { [`claude-${model}-5`]: { costUSD: 0.0123 } }
});
