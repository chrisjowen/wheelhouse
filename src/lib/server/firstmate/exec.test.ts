import { describe, expect, it } from 'vitest';
import { runBounded } from './exec';

describe('runBounded', () => {
	it('settles on timeout when a background helper outlives the script and holds its output open', async () => {
		const started = Date.now();
		const r = await runBounded('/bin/sh', ['-c', 'sleep 30 & exit 0'], {
			timeoutMs: 300,
			maxOutputBytes: 1024
		});
		expect(r.ok).toBe(false);
		expect(!r.ok && r.kind).toBe('timeout');
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it('returns stdout of a successful run', async () => {
		const r = await runBounded('/bin/sh', ['-c', 'echo hi'], {
			timeoutMs: 5_000,
			maxOutputBytes: 1024
		});
		expect(r).toMatchObject({ ok: true, stdout: 'hi\n' });
	});
});
