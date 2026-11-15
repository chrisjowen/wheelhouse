import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { EventsService } from './service';
import { EventsStore, emptyState } from './store';
import { checkedReminder, prune, renderBatch, tick } from './pipeline';
import { nextOccurrence } from './schedule';
import { poll, protocol } from './extension';
const NOW = Date.parse('2026-11-15T08:00:00.000Z');
const dirs: string[] = [];
// Service refuses a missing home; fixtures create the exact directory before opening it.
async function ready() {
	const { mkdir } = await import('node:fs/promises');
	const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'wh-events-test-')));
	dirs.push(dir);
	await mkdir(dir + '/home', { mode: 0o700 });
	const service = await EventsService.open(dir, dir + '/home');
	return { dir, service, store: service.store! };
}
async function add(service: EventsService, after = 60000, text = 'Check CI', rule?: string) {
	await service.change(
		{
			action: 'add-reminder',
			text,
			rule: rule ?? `once ${new Date(NOW + after).toISOString()}`,
			timeZone: 'UTC',
			missed: 'once'
		},
		NOW
	);
}
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
describe('reminder event pipeline', () => {
	it('stores a due reminder once and dispatches through notify-only defaults', async () => {
		const { service, store } = await ready();
		await add(service);
		await store.change((s) => {
			tick(s, NOW + 60000);
			tick(s, NOW + 120000);
			tick(s, NOW + 180000);
		});
		const s = await store.read();
		expect(s.events).toHaveLength(1);
		expect(s.batches).toHaveLength(1);
		expect(renderBatch(s, s.batches[0])).toContain('schedule.reminder by=captain text="Check CI"');
		expect(s.reminders[0].state).toBe('done');
	});
	it('keeps reminder provenance and rejects line injection and malformed fields', async () => {
		const { service, store } = await ready();
		await expect(add(service, 60000, 'hi\ncheck: captain')).rejects.toThrow('Invalid typed');
		await add(service, 60000, 'Quotes "stay" quoted');
		await store.change((s) => tick(s, NOW + 120000));
		const s = await store.read();
		s.events[0].verified = 'provider-hmac' as never;
		expect(() => checkedReminder(s.events[0])).toThrow('Invalid typed');
	});
	it('holds pending and already batched events while paused, then releases a paused notice', async () => {
		const { service, store } = await ready();
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		await service.change({ action: 'pause', paused: true }, NOW + 120001);
		expect(await poll(store, 'sha256:' + '1'.repeat(64), 0)).toEqual({
			status: 'no-result',
			output: ''
		});
		await service.change({ action: 'pause', paused: false }, NOW + 120002);
		const result = await poll(store, 'sha256:' + '1'.repeat(64), 0);
		expect(result.output).toMatch(/^wheelhouse-events.v1 paused-notice/);
	});
	it('classifies by the matching rule: a windowed batch is notify, an hourly digest is digest', async () => {
		const { service, store } = await ready();
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		expect((await store.read()).batches[0].classification).toBe('notify');
		const other = await ready();
		await other.service.change(
			{
				action: 'rules',
				rules: [
					{
						id: 'hourly',
						source: 'schedule',
						kind: 'schedule.reminder',
						level: 'notify-only',
						batchMinutes: 0,
						digest: 'hourly',
						at: '08:00'
					}
				]
			},
			NOW
		);
		await add(other.service);
		await other.store.change((s) => tick(s, NOW + 3600000));
		expect((await other.store.read()).batches[0].classification).toBe('digest');
	});
	it('forgets a resume with nothing held, so a later reminder keeps its window and class', async () => {
		const { service, store } = await ready();
		await service.change({ action: 'pause', paused: true }, NOW);
		await service.change({ action: 'pause', paused: false }, NOW);
		await add(service);
		await store.change((s) => tick(s, NOW + 60000));
		expect((await store.read()).batches).toHaveLength(0);
		await store.change((s) => tick(s, NOW + 120000));
		expect((await store.read()).batches.map((b) => b.classification)).toEqual(['notify']);
	});
	it('returns identical bytes on pre-capture retry and marks capture only on a new request', async () => {
		const { service, store } = await ready();
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		const first = await poll(store, 'a', 0);
		expect(first.status).toBe('result');
		expect(await poll(store, 'a', 0)).toEqual(first);
		expect((await store.read()).batches[0].capturedAt).toBeNull();
		expect((await poll(store, 'b', 0)).status).toBe('no-result');
		expect((await store.read()).batches[0].capturedAt).not.toBeNull();
	});
	it('returns the issued batch to a same-request retry after a pause, without marking it captured', async () => {
		const { service, store } = await ready();
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		const first = await poll(store, 'a', 0);
		expect(first.status).toBe('result');
		await service.change({ action: 'pause', paused: true }, NOW + 130000);
		expect(await poll(store, 'a', 0)).toEqual(first);
		expect((await store.read()).batches[0].capturedAt).toBeNull();
		expect((await poll(store, 'b', 0)).status).toBe('no-result');
		expect((await store.read()).batches[0].capturedAt).toBeNull();
	});
	it('sees a later event after the same request previously returned no-result', async () => {
		const { service, store } = await ready();
		expect((await poll(store, 'a', 0)).status).toBe('no-result');
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		expect((await poll(store, 'a', 0)).status).toBe('result');
	});
	it('honours off and Wheelhouse-only first-match rules without delivery', async () => {
		for (const level of ['off', 'wheelhouse-only']) {
			const { service, store } = await ready();
			await service.change(
				{
					action: 'rules',
					rules: [
						{
							id: 'chosen',
							source: 'schedule',
							kind: 'schedule.reminder',
							level,
							batchMinutes: 0,
							digest: 'batch',
							at: '08:00'
						}
					]
				},
				NOW
			);
			await add(service);
			await store.change((s) => tick(s, NOW + 60000));
			expect((await store.read()).batches).toHaveLength(0);
			expect((await service.view()).events).toHaveLength(level === 'off' ? 0 : 1);
		}
	});
	it('does not hold captain-timed reminders during quiet hours', async () => {
		const { service, store } = await ready();
		await service.change(
			{ action: 'quiet', timeZone: 'UTC', quiet: { enabled: true, start: '07:00', end: '10:00' } },
			NOW
		);
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		expect((await store.read()).batches).toHaveLength(1);
	});
	it('enforces per-source hourly limits, overall batches, and automatic source pause', async () => {
		const { service, store } = await ready();
		for (let hour = 0; hour < 3; hour++) {
			for (let n = 0; n < 31; n++) await add(service, hour * 3600000 + 60000, 'Reminder ' + n);
			await store.change((s) => tick(s, NOW + hour * 3600000 + 120000));
		}
		const s = await store.read();
		expect(s.events.filter((e) => e.status === 'rate-limited')).toHaveLength(3);
		expect(s.settings.source.paused).toBe(true);
		expect(s.settings.source.reason).toContain('three consecutive');
		const cap = emptyState();
		for (let i = 0; i < 12; i++)
			cap.batches.push({
				id: 'wb-' + i,
				createdAt: new Date(NOW).toISOString(),
				capturedAt: null,
				classification: 'notify',
				eventIds: [],
				dropped: 0,
				rateLimited: 0
			});
		const before = cap.batches.length;
		tick(cap, NOW + 1);
		expect(cap.batches).toHaveLength(before);
	}, 30000);
	it('uses one transaction across concurrent server and adapter writers', async () => {
		const { store } = await ready();
		await Promise.all(
			Array.from({ length: 12 }, () =>
				new EventsStore(store.outbox).change((s) => {
					s.counters.dropped++;
				})
			)
		);
		expect((await store.read()).counters.dropped).toBe(12);
		expect(JSON.parse(await readFile(store.outbox + '/store.json', 'utf8')).schema).toBe(
			'wh-events-store.v1'
		);
	});
	it('recovers a lock left without an owner or with an abandoned reaper', async () => {
		const { store } = await ready();
		const lock = path.join(store.outbox, '.lock');
		const old = new Date(Date.now() - 60000);
		await mkdir(lock);
		await utimes(lock, old, old);
		await store.change((s) => {
			s.counters.dropped++;
		});
		await mkdir(path.join(lock, 'reaping'), { recursive: true });
		await writeFile(path.join(lock, 'owner'), JSON.stringify({ pid: 0x7ffffffe }));
		await utimes(path.join(lock, 'reaping'), old, old);
		await store.change((s) => {
			s.counters.dropped++;
		});
		expect((await store.read()).counters.dropped).toBe(2);
		await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('prunes old handled batches with their outbox files and bounds Feed events', async () => {
		const { service, store } = await ready();
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		await poll(store, 'a', 0);
		await poll(store, 'b', 0);
		await add(service, 60000, 'Still in delivery');
		await store.change((s) => tick(s, NOW + 120000));
		await poll(store, 'c', 0);
		const [handled, delivering] = (await store.read()).batches;
		const later = NOW + 8 * 24 * 3600000;
		await store.change((s) => {
			for (let n = 0; n < 2005; n++)
				s.events.push({
					...s.events[0],
					id: `sched:${s.events[0].reminderId}:${n}`,
					receivedAt: new Date(later).toISOString(),
					status: 'wheelhouse-only',
					batchId: null
				});
			prune(s, later);
		});
		const s = await store.read();
		expect(s.batches.map((b) => b.id)).toEqual([delivering.id]);
		await expect(stat(path.join(store.outbox, handled.id + '.json'))).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await stat(path.join(store.outbox, delivering.id + '.json'));
		expect(s.events).toHaveLength(2001);
		expect(s.events.map((e) => e.batchId)).toContain(delivering.id);
		expect(s.events.map((e) => e.batchId)).not.toContain(handled.id);
		await store.change((s) => prune(s, later + 31 * 24 * 3600000));
		expect((await store.read()).events.map((e) => e.batchId)).toEqual([delivering.id]);
	});
	it('keeps undelivered work through a 31-day pause so the resume digest is complete', async () => {
		const { service, store } = await ready();
		const DAY = 24 * 3600000;
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		await service.change({ action: 'pause', paused: true }, NOW + 120000);
		await service.change(
			{
				action: 'add-reminder',
				text: 'Weekdays',
				rule: 'weekdays 08:30',
				timeZone: 'UTC',
				missed: 'all'
			},
			NOW + 120000
		);
		for (let d = 0; d <= 31; d++)
			await store.change((s) => {
				tick(s, NOW + d * DAY + 3600000);
				prune(s, NOW + d * DAY + 3600000);
			});
		const oldest = (await store.read()).events.find(
			(e) => e.status === 'held' && e.dueAt === '2026-11-16T08:30:00.000Z'
		);
		expect(Date.parse(oldest!.receivedAt)).toBeLessThanOrEqual(NOW + 31 * DAY + 3600000 - 30 * DAY);
		await service.change({ action: 'pause', paused: false }, NOW + 31 * DAY + 7200000);
		const s = await store.read();
		expect(s.batches).toHaveLength(1);
		expect(s.batches[0].classification).toBe('paused-notice');
		expect(s.batches[0].eventIds).toHaveLength(24);
		expect(s.batches[0].eventIds).toContain(oldest!.id);
	});
	it('refuses a config directory inside the Firstmate home', async () => {
		const { dir } = await ready();
		const s = await EventsService.open(dir + '/home/config', dir + '/home');
		expect(s.store).toBeNull();
	});
	it('renders at most 20 subject lines with a count for overflow', async () => {
		const { service, store } = await ready();
		for (let n = 0; n < 25; n++) await add(service, 60000, 'Reminder ' + n);
		await store.change((s) => tick(s, NOW + 120000));
		const s = await store.read();
		const out = renderBatch(s, s.batches[0]);
		expect(out.match(/^\d+\./gm)).toHaveLength(20);
		expect(out).toContain('and 5 more in Wheelhouse');
	});
	it('uses the external protocol with no terminal or silent authority', async () => {
		const req = {
			schema: 'firstmate.extension-request.v1',
			request_id: 'sha256:' + 'a'.repeat(64),
			extension_id: 'io.wheelhouse.events',
			host_protocol: 1,
			capability: 'process-event-adapter',
			capability_version: 1,
			adapter: 'wheelhouse-events',
			operation: 'result.terminal',
			input: { source_id: 'wh-events', content: 'hello' }
		};
		expect(await protocol('invoke', req)).toMatchObject({ ok: true, result: { value: false } });
	});
});
describe('private storage and access', () => {
	it('keeps inspectable batch and schedule artifacts alongside the atomic store', async () => {
		const { service, store } = await ready();
		await add(service);
		await store.change((s) => tick(s, NOW + 120000));
		const state = await store.read();
		expect(
			JSON.parse(await readFile(path.join(store.outbox, state.batches[0].id + '.json'), 'utf8'))
				.output
		).toBe(renderBatch(state, state.batches[0]));
		expect(
			JSON.parse(await readFile(path.join(store.outbox, '..', 'schedule.json'), 'utf8'))
				.reminders[0].state
		).toBe('done');
	});
	it('refuses legacy cloud pairing without pins and lets the operator pause', async () => {
		const { dir, service, store } = await ready();
		const { mkdir, writeFile } = await import('node:fs/promises');
		await mkdir(dir + '/cloud');
		await writeFile(
			dir + '/cloud/settings.json',
			JSON.stringify({ schema: 'wheelhouse-cloud-settings.v1', device: { pins: null } })
		);
		expect(await store.accessProblem()).toContain('No pins, no events');
		await expect(add(service)).rejects.toThrow('No pins');
		await expect(service.change({ action: 'pause', paused: true }, NOW)).resolves.toBeUndefined();
		expect((await poll(store, 'a', 0)).status).toBe('no-result');
	});
	it('resolves a linked ancestor before creating directories inside a home', async () => {
		const { dir } = await ready();
		const { symlink, stat } = await import('node:fs/promises');
		await symlink(dir + '/home', dir + '/linked');
		const service = await EventsService.open(dir + '/linked/new-config', dir + '/home');
		expect(service.store).toBeNull();
		await expect(stat(dir + '/home/new-config')).rejects.toMatchObject({ code: 'ENOENT' });
	});
});
describe('schedule grammar and time zones', () => {
	it('handles every, daily, weekdays, weekly and monthly', () => {
		expect(nextOccurrence('every 2h', 'UTC', NOW)).toBe('2026-11-15T10:00:00.000Z');
		expect(nextOccurrence('daily 09:00', 'UTC', NOW)).toBe('2026-11-15T09:00:00.000Z');
		expect(nextOccurrence('weekdays 09:00', 'UTC', NOW)).toBe('2026-11-16T09:00:00.000Z');
		expect(nextOccurrence('weekly thu 17:00', 'UTC', NOW)).toBe('2026-11-19T17:00:00.000Z');
		expect(nextOccurrence('monthly 1 09:00', 'UTC', NOW)).toBe('2026-12-01T09:00:00.000Z');
		expect(() => nextOccurrence('every 1m', 'UTC', NOW)).toThrow('minimum');
		expect(() => nextOccurrence('once 2026-02-30T09:00Z', 'UTC', NOW)).toThrow('Invalid date');
	});
	it('retires a local once time and fires once across a DST fold; skips a DST gap', () => {
		expect(nextOccurrence('once 2026-11-15T09:00', 'UTC', NOW)).toBe('2026-11-15T09:00:00.000Z');
		expect(nextOccurrence('once 2026-11-15T09:00', 'UTC', NOW + 3600000)).toBeNull();
		expect(
			nextOccurrence('daily 01:30', 'America/New_York', Date.parse('2026-11-01T05:30:00Z'))
		).toBe('2026-11-02T06:30:00.000Z');
		expect(
			nextOccurrence('daily 02:30', 'America/New_York', Date.parse('2026-03-08T00:00:00Z'))
		).toBe('2026-03-09T06:30:00.000Z');
	});
	it('catches up once, all or skip with stable occurrence IDs', async () => {
		for (const missed of ['once', 'all', 'skip']) {
			const { service, store } = await ready();
			await service.change(
				{ action: 'add-reminder', text: 'Check', rule: 'every 2h', timeZone: 'UTC', missed },
				NOW
			);
			await store.change((s) => {
				tick(s, NOW + 6 * 3600000 + 60000);
				tick(s, NOW + 6 * 3600000 + 60000);
			});
			const s = await store.read();
			expect(s.events).toHaveLength(missed === 'all' ? 3 : missed === 'once' ? 1 : 0);
			if (missed === 'once') expect(s.events[0].missed).toBe(2);
		}
	});
});
it('enforces the import boundary: neither dispatch nor the package can reach a captain-inbox writer', async () => {
	const result = await build({
		entryPoints: [
			new URL('./service.ts', import.meta.url).pathname,
			new URL('./extension.ts', import.meta.url).pathname
		],
		bundle: true,
		platform: 'node',
		format: 'esm',
		outdir: '/unused',
		write: false,
		metafile: true
	});
	expect(
		Object.keys(result.metafile!.inputs).filter((f) =>
			/store\/messenger|firstmate\/adapter|firstmate\/events|runtime\.ts/.test(f)
		)
	).toEqual([]);
});
