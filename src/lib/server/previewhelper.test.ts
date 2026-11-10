import { describe, expect, it, vi } from 'vitest';
import { ask, helperArgs, readPage, summariseFeedback, type HelperDeps } from './previewhelper';
import { SUMMARY_SCHEMA, SUMMARY_SYSTEM } from '../previewhelper';
import type { RunOptions, RunResult } from './firstmate/exec';
import type { HelperContext } from '../previewhelper';

const ctx: HelperContext = {
	task: { id: 'lumen-share', title: 'Share links', project: 'Lumen', status: 'needs-review' },
	preview: { url: 'http://127.0.0.1:5240/', text: 'Share' },
	brief: null,
	history: [],
	screenshots: [{ name: 'a.png', file: '/data/lumen-share/shots/a.png' }]
};
const req = {
	turns: [{ who: 'captain' as const, text: '7 days feels short' }],
	list: ['Turn downloads off']
};

const ok = (stdout: string): RunResult => ({ ok: true, stdout, stderr: '', durationMs: 5 });

function deps(
	result: RunResult,
	env: NodeJS.ProcessEnv = {}
): HelperDeps & { calls: [string, string[], RunOptions][] } {
	const calls: [string, string[], RunOptions][] = [];
	return {
		calls,
		env,
		run: async (file, args, opts) => {
			calls.push([file, args, opts]);
			return result;
		},
		fetch: vi.fn() as unknown as typeof fetch,
		find: (name) => (name === 'claude' ? '/bin/claude' : null)
	};
}

describe('the preview helper run', () => {
	it('runs claude with no session, settings or MCP, reading only the screenshots, and answers', async () => {
		const d = deps(
			ok(
				JSON.stringify({
					structured_output: {
						reply: 'The brief says 7 days. I would put it as:',
						suggest: ['Make links last 30 days by default', 'turn downloads off']
					}
				})
			)
		);
		const r = await ask(ctx, req, d);
		// A line already on the list is not suggested again.
		expect(r).toEqual({
			ok: true,
			value: {
				reply: 'The brief says 7 days. I would put it as:',
				suggest: ['Make links last 30 days by default']
			}
		});
		const [file, args, opts] = d.calls[0];
		expect(file).toBe('/bin/claude');
		expect(args).toEqual(helperArgs('sonnet', ['/data/lumen-share/shots']));
		expect(args).toContain('--no-session-persistence');
		expect(args).toContain('--strict-mcp-config');
		expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual([
			'--tools',
			'Read'
		]);
		expect(opts.input).toContain('Captain: 7 days feels short');
	});

	it('takes the binary and model from the environment, and says plainly when there is none', async () => {
		const d = deps(ok(JSON.stringify({ structured_output: { reply: 'Hi', suggest: [] } })), {
			WHEELHOUSE_PREVIEW_CLAUDE: '/opt/fake-claude',
			WHEELHOUSE_PREVIEW_MODEL: 'haiku'
		});
		await ask(ctx, req, d);
		expect(d.calls[0][0]).toBe('/opt/fake-claude');
		expect(d.calls[0][1][2]).toBe('haiku');
		const none = { ...deps(ok('')), find: () => null };
		expect(await ask(ctx, req, none)).toMatchObject({ ok: false, status: 503 });
	});

	it('reports a run that failed or answered nothing readable', async () => {
		const failed: RunResult = {
			ok: false,
			kind: 'timeout',
			code: null,
			signal: null,
			stdout: '',
			stderr: '',
			message: 'timed out',
			durationMs: 120000
		};
		expect(await ask(ctx, req, deps(failed))).toEqual({
			ok: false,
			status: 502,
			error: 'The preview helper took too long to answer. Try again.'
		});
		expect(await ask(ctx, req, deps(ok('garbage')))).toMatchObject({ ok: false, status: 502 });
	});
});

describe('readPage', () => {
	it('reads only a loopback page that answers with HTML', async () => {
		const html = vi.fn(
			async () => new Response('<h1>Share</h1>', { headers: { 'content-type': 'text/html' } })
		) as unknown as typeof fetch;
		expect(await readPage('http://127.0.0.1:5240/', { fetch: html })).toBe('Share');
		expect(await readPage('https://example.com/', { fetch: html })).toBeNull();
		expect(html).toHaveBeenCalledTimes(1);
		const json = (async () =>
			new Response('{}', {
				headers: { 'content-type': 'application/json' }
			})) as unknown as typeof fetch;
		expect(await readPage('http://127.0.0.1:5240/', { fetch: json })).toBeNull();
	});
});

describe('the preview helper’s summary of a feedback list', () => {
	const list = {
		task: { id: 'lumen-checkout', title: 'Checkout' },
		subject: 'the shared review “Checkout”',
		items: [
			{ text: 'Ana: Bigger button', points: 'the “Pay now” button' },
			{ text: 'Ben: Agreed, bigger', points: null }
		]
	};

	it('runs the same claude with its own instructions and shape, and no tools', async () => {
		const d = deps(
			ok(
				JSON.stringify({
					structured_output: {
						points: [
							{
								text: 'Make the Pay now button bigger',
								points: 'the “Pay now” button',
								from: [1, 2]
							}
						]
					}
				})
			)
		);
		expect(await summariseFeedback(list, d)).toEqual({
			ok: true,
			points: [
				{ text: 'Make the Pay now button bigger', points: 'the “Pay now” button', from: [1, 2] }
			]
		});
		const [file, args, opts] = d.calls[0];
		expect(file).toBe('/bin/claude');
		expect(args).toEqual(
			helperArgs('sonnet', [], { system: SUMMARY_SYSTEM, schema: SUMMARY_SCHEMA, read: false })
		);
		expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual([
			'--tools',
			''
		]);
		expect(args).not.toContain('--add-dir');
		expect(args).toContain('--no-session-persistence');
		expect(opts.input).toContain('1. Ana: Bigger button');
	});

	it('says why when claude is missing, fails, or answers with no points', async () => {
		const none = { ...deps(ok('')), find: () => null };
		expect(await summariseFeedback(list, none)).toMatchObject({ ok: false, status: 503 });
		const failed = deps({
			ok: false,
			kind: 'timeout',
			stdout: '',
			stderr: ''
		} as unknown as RunResult);
		expect(await summariseFeedback(list, failed)).toMatchObject({
			ok: false,
			status: 502,
			error: 'The preview helper took too long to answer. Try again.'
		});
		const empty = deps(ok(JSON.stringify({ structured_output: { points: [] } })));
		expect(await summariseFeedback(list, empty)).toMatchObject({
			ok: false,
			status: 502,
			error: 'The preview helper’s summary could not be read. Try again.'
		});
	});
});
