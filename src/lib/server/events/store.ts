import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, open, realpath, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkedReminder, renderBatch } from './pipeline';
import { parsePasskeys } from '../cloud/passkeys';
import type { EventsState } from '../../events';

export function emptyState(): EventsState {
	return {
		schema: 'wh-events-store.v1',
		settings: {
			paused: false,
			timeZone: 'UTC',
			quiet: { enabled: false, start: '22:00', end: '08:00' },
			rules: [],
			source: { level: 'notify-only', paused: false, reason: null }
		},
		reminders: [],
		events: [],
		batches: [],
		delivery: null,
		counters: { dropped: 0, limited: 0 },
		sourceWindows: [],
		resumeNotice: false
	};
}
const STALE_MS = 5000;
async function ownerPid(lock: string): Promise<number | null> {
	try {
		const pid = JSON.parse(await readFile(path.join(lock, 'owner'), 'utf8')).pid;
		return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}
/** A lock is abandoned when its owner is dead, or when no owner was written long after mkdir. */
async function abandoned(lock: string, seen: Stats) {
	const pid = await ownerPid(lock);
	if (pid === null) return Date.now() - seen.mtimeMs > STALE_MS;
	try {
		process.kill(pid, 0);
		return false;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'ESRCH';
	}
}
/** One recovery at a time takes `reaping` inside the lock and rechecks before removing it. */
async function reap(lock: string) {
	const reaper = path.join(lock, 'reaping');
	try {
		const seen = await stat(lock);
		if (!(await abandoned(lock, seen))) return;
		try {
			await mkdir(reaper, { mode: 0o700 });
		} catch (e) {
			if (
				(e as NodeJS.ErrnoException).code === 'EEXIST' &&
				Date.now() - (await stat(reaper)).mtimeMs > STALE_MS
			)
				await rm(reaper, { recursive: true, force: true });
			return;
		}
		let reaped = false;
		try {
			if ((await stat(lock)).ino === seen.ino && (await abandoned(lock, seen))) {
				await rm(lock, { recursive: true, force: true });
				reaped = true;
			}
		} finally {
			if (!reaped) await rm(reaper, { recursive: true, force: true });
		}
	} catch {
		/* A live writer or another recovery owns the lock. */
	}
}
/** One private store per FM home, outside FM_HOME. Both the server and the bound adapter use this lock. */
export class EventsStore {
	constructor(readonly outbox: string) {
		if (!path.isAbsolute(outbox)) throw new Error('Events outbox must be absolute.');
	}
	async initialize() {
		await mkdir(this.outbox, { recursive: true, mode: 0o700 });
		const s = await stat(this.outbox);
		if (
			(await realpath(this.outbox)) !== this.outbox ||
			s.mode & 0o022 ||
			s.uid !== process.getuid?.()
		)
			throw new Error('Events needs a canonical, same-user private directory.');
	}
	/** A paired machine with no trusted pins must not expose an event channel. Unpaired local machines remain local-only. */
	async accessProblem(): Promise<string | null> {
		const configDir = path.resolve(this.outbox, '../../..');
		try {
			const settings = JSON.parse(
				await readFile(path.join(configDir, 'cloud', 'settings.json'), 'utf8')
			);
			if (settings.schema !== 'wheelhouse-cloud-settings.v1')
				return 'Cloud settings are invalid; Events is held.';
			if (settings.device && !parsePasskeys(settings.device.pins)?.length)
				return 'No pins, no events. Pair this machine with trusted passkeys before using Events.';
			return null;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
			return 'Cloud settings cannot be checked; Events is held.';
		}
	}
	async read(): Promise<EventsState> {
		try {
			const state = JSON.parse(
				await readFile(path.join(this.outbox, 'store.json'), 'utf8')
			) as EventsState;
			if (state.schema !== 'wh-events-store.v1') throw new Error('Unknown events store schema.');
			return state;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
			throw e;
		}
	}
	private async artifact(file: string, contents: string) {
		const tmp = file + '.' + randomUUID() + '.tmp';
		try {
			await writeFile(tmp, contents, { mode: 0o600, flag: 'wx' });
			await rename(tmp, file);
		} finally {
			await rm(tmp, { force: true });
		}
	}
	async change<T>(fn: (state: EventsState) => T): Promise<T> {
		const lock = path.join(this.outbox, '.lock'),
			token = randomUUID();
		let held = false;
		for (let i = 0; i < 200; i++) {
			try {
				await mkdir(lock, { mode: 0o700 });
				held = true;
				await writeFile(path.join(lock, 'owner'), JSON.stringify({ pid: process.pid, token }), {
					mode: 0o600
				});
				break;
			} catch (e) {
				if (held) {
					await rm(lock, { recursive: true, force: true });
					throw e;
				}
				if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
				await reap(lock);
				await delay(25);
			}
		}
		if (!held) throw new Error('Events store is busy; retry.');
		const tmp = path.join(this.outbox, `.store-${token}.tmp`);
		try {
			const state = await this.read();
			const before = JSON.stringify(state);
			const oldBatches = new Map(state.batches.map((b) => [b.id, JSON.stringify(b)]));
			const oldSchedule = JSON.stringify(state.reminders);
			const result = fn(state);
			const contents = JSON.stringify(state);
			if (contents === before) return result;
			const file = await open(tmp, 'wx', 0o600);
			try {
				await file.writeFile(contents);
				await file.sync();
			} finally {
				await file.close();
			}
			// Publish inspectable artifacts before the authoritative index. A crash may leave an
			// unindexed artifact, which polling never selects. Reminder advancement and
			// event insertion remain atomic in store.json.
			for (const batch of state.batches)
				if (oldBatches.get(batch.id) !== JSON.stringify(batch)) {
					const events = batch.eventIds.map((id) => state.events.find((e) => e.id === id)!);
					events.forEach(checkedReminder);
					const output = renderBatch(state, batch);
					await this.artifact(
						path.join(this.outbox, `${batch.id}.json`),
						JSON.stringify({ schema: 'wh-event-batch.v1', batch, events, output })
					);
				}
			if (oldSchedule !== JSON.stringify(state.reminders))
				await this.artifact(
					path.join(this.outbox, '..', 'schedule.json'),
					JSON.stringify({ schema: 'wh-schedule.v1', reminders: state.reminders })
				);
			await rename(tmp, path.join(this.outbox, 'store.json'));
			for (const id of oldBatches.keys())
				if (!state.batches.some((b) => b.id === id))
					await rm(path.join(this.outbox, `${id}.json`), { force: true });
			return result;
		} finally {
			await rm(tmp, { force: true });
			await rm(lock, { recursive: true, force: true });
		}
	}
}
