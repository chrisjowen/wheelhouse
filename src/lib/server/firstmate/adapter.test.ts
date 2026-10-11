import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptAdapter } from './adapter';
import {
	createFakeFirstmate,
	snapshotFixture,
	taskRow,
	type FakeFirstmate
} from '../../../../tests/helpers/fake-firstmate';

let fm: FakeFirstmate;
const adapter = (opts = {}) =>
	createScriptAdapter({ firstmateDir: fm.root, homeDir: fm.root }, opts);
const calls = () => readFileSync(path.join(fm.root, 'calls.log'), 'utf8').trim().split('\n');

beforeEach(() => {
	fm = createFakeFirstmate();
});
afterEach(() => fm.cleanup());

describe('snapshot', () => {
	it('runs fm-fleet-snapshot.sh --json with FM_HOME and parses the contract', async () => {
		fm.set('snapshot.json', snapshotFixture({ tasks: [taskRow({ id: 'a-1' })] }, fm.root));
		const r = await adapter().snapshot();
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.tasks.map((t) => t.id)).toEqual(['a-1']);
		expect(r.value.tasks[0].current?.state).toBe('working');
		expect(calls()).toEqual([`fm-fleet-snapshot.sh [--json] FM_HOME=${fm.root}`]);
	});

	it('reports malformed output without throwing', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'malformed');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatchObject({ kind: 'malformed', script: 'fm-fleet-snapshot.sh' });
	});

	it('rejects an unknown schema', async () => {
		fm.set('snapshot.json', { ...snapshotFixture(), schema: 'fm-fleet-snapshot.v2' });
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toContain('fm-fleet-snapshot.v2');
	});

	it('reports a failing script with its stderr', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'fail');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.kind).toBe('exit');
			expect(r.error.message).toContain('something broke');
		}
	});

	it('times out a hung script and kills it', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'sleep');
		const started = Date.now();
		const r = await adapter({ snapshotTimeoutMs: 300 }).snapshot();
		expect(Date.now() - started).toBeLessThan(5000);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('timeout');
	});

	it('bounds output size', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'huge');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('output-limit');
	});

	it('reports a missing script', async () => {
		fm.set('bin/fm-fleet-snapshot.sh', '');
		const { rmSync } = await import('node:fs');
		rmSync(path.join(fm.root, 'bin', 'fm-fleet-snapshot.sh'));
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('missing-script');
	});
});

describe('ready', () => {
	it('parses fm-primary-ready.v1', async () => {
		const r = await adapter().ready();
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.canReceive).toBe(true);
			expect(r.value.wakeConsumer.state).toBe('healthy');
		}
		expect(calls()[0]).toMatch(/^fm-inbox\.sh \[ready\]/);
	});

	it('keeps an unknown can_receive as unknown', async () => {
		fm.set('ready.json', {
			schema: 'fm-primary-ready.v1',
			lock: { state: 'free' },
			wake_consumer: { state: 'unknown' },
			can_receive: 'unknown'
		});
		const r = await adapter().ready();
		expect(r.ok && r.value.canReceive).toBe('unknown');
	});
});

describe('peek', () => {
	it('passes the task id and a clamped line count as separate arguments', async () => {
		await adapter().peek('wh-crew-1', 9999);
		expect(calls()[0]).toMatch(/^fm-peek\.sh \[wh-crew-1\] \[200\]/);
	});

	it('never passes an id that is not a plain task id', async () => {
		for (const bad of ['a;rm -rf /', '-n', '../x', 'a b', '$(id)']) {
			const r = await adapter().peek(bad, 10);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.kind).toBe('invalid-argument');
		}
		expect(() => calls()).toThrow();
	});

	it('strips terminal escapes and keeps only the requested tail', async () => {
		fm.set('peek.txt', 'one\n\u001b[31mtwo\u001b[0m\nthree\u0007\n\n\n');
		const r = await adapter().peek('t-1', 2);
		expect(r.ok && r.value.lines).toEqual(['two', 'three']);
	});
});
