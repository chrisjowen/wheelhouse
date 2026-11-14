import { describe, expect, it } from 'vitest';
import { installAll, type InstallAllProgress, type InstallOutcome } from './setup';
import type { Answer } from './plugins';

describe('Install all', () => {
	it('installs each tool in turn, saying which, and carries on past one that fails', async () => {
		const ran: string[] = [];
		const seen: InstallAllProgress[] = [];
		let running = 0;
		const install = async (tool: string): Promise<Answer<InstallOutcome>> => {
			running++;
			// One at a time: the server refuses a second install while one runs.
			expect(running).toBe(1);
			await new Promise((r) => setTimeout(r, 1));
			ran.push(tool);
			running--;
			return tool === 'gh'
				? { ok: false, error: 'brew failed: no network' }
				: { ok: true, value: { command: `brew install ${tool}`, dryRun: false, output: 'done' } };
		};
		const results = await installAll(['gh', 'jq', 'tmux'], install, (p) => seen.push(p));
		expect(ran).toEqual(['gh', 'jq', 'tmux']);
		expect(seen).toEqual([
			{ tool: 'gh', index: 1, total: 3 },
			{ tool: 'jq', index: 2, total: 3 },
			{ tool: 'tmux', index: 3, total: 3 }
		]);
		expect(results).toEqual([
			{ tool: 'gh', ok: false, text: 'brew failed: no network' },
			{ tool: 'jq', ok: true, text: 'done' },
			{ tool: 'tmux', ok: true, text: 'done' }
		]);
	});

	it('does nothing with nothing to install', async () => {
		expect(await installAll([], async () => ({ ok: false, error: 'not called' }))).toEqual([]);
	});
});
