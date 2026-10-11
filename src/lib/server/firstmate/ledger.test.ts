import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LedgerReader } from './ledger';

let dir: string;
let file: string;
const rec = (o: Record<string, unknown>) => JSON.stringify({ v: 1, ts: 1, task: 't', ...o }) + '\n';

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'wh-ledger-'));
	file = path.join(dir, 'fleet-ledger.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('LedgerReader', () => {
	it('reports the ledger as off when the file is absent', async () => {
		const l = new LedgerReader(file);
		expect(await l.poll()).toBe(0);
		expect(l.state().available).toBe(false);
		expect(l.state().reason).toMatch(/off/);
	});

	it('reads appended records incrementally, ignoring unknown events and members', async () => {
		writeFileSync(
			file,
			rec({ event: 'task.dispatched', harness: 'claude', model: null, extra: 1 })
		);
		const l = new LedgerReader(file);
		expect(await l.poll()).toBe(1);
		appendFileSync(
			file,
			rec({ event: 'task.status', state: 'working', key: null, text: ' going' }) +
				rec({ event: 'task.future' })
		);
		expect(await l.poll()).toBe(1);
		const t = l.task('t')!;
		expect(t.dispatched?.harness).toBe('claude');
		expect(t.statuses.map((s) => s.text)).toEqual(['going']);
	});

	it('drops duplicate deliveries', async () => {
		const line = rec({ event: 'task.status', state: 'working', key: null, text: 'x' });
		writeFileSync(file, line + line);
		const l = new LedgerReader(file);
		await l.poll();
		expect(l.task('t')!.statuses).toHaveLength(1);
	});

	it('remembers only recent lines for duplicate detection', () => {
		const l = new LedgerReader(file);
		const line = (i: number) =>
			rec({ event: 'task.status', state: 'working', key: null, text: `s${i}` });
		expect(l.ingest(line(0))).toBe(true);
		expect(l.ingest(line(0))).toBe(false);
		for (let i = 1; i <= 10_000; i++) l.ingest(line(i));
		expect(l.ingest(line(10_000))).toBe(false);
		expect(l.ingest(line(0))).toBe(true);
	});

	it('waits for a partial last line to complete', async () => {
		const line = rec({ event: 'task.pr_ready', pr: 'https://g/pull/1' });
		writeFileSync(file, line.slice(0, 20));
		const l = new LedgerReader(file);
		expect(await l.poll()).toBe(0);
		appendFileSync(file, line.slice(20));
		expect(await l.poll()).toBe(1);
		expect(l.task('t')!.prReady?.pr).toBe('https://g/pull/1');
	});

	it('starts over when the file is truncated', async () => {
		writeFileSync(file, rec({ event: 'task.cleaned_up', ts: 5 }));
		const l = new LedgerReader(file);
		await l.poll();
		writeFileSync(file, '');
		await l.poll();
		expect(l.task('t')).toBeNull();
	});

	it('picks up reported previews and no-mistakes run ids', async () => {
		writeFileSync(
			file,
			rec({
				event: 'task.status',
				state: 'note',
				key: null,
				text: ' preview: https://pr-1.example.dev/.'
			}) +
				rec({
					event: 'task.status',
					state: 'needs-decision',
					key: 'nm-01M4EVPEV7WZJSXGPV34AVXHB8-review',
					text: 'x'
				}) +
				rec({
					event: 'task.status',
					state: 'working',
					key: null,
					text: 'live at http://127.0.0.1:4310/'
				})
		);
		const l = new LedgerReader(file);
		await l.poll();
		const t = l.task('t')!;
		expect(t.preview?.url).toBe('https://pr-1.example.dev/');
		expect(t.runIds).toEqual(['01M4EVPEV7WZJSXGPV34AVXHB8']);
	});
});
