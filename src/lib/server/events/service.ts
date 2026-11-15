import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { EventsView, Reminder } from '../../events';
import { EventsStore, emptyState } from './store';
import { checkedReminder, isLevel, tick, validateRules } from './pipeline';
import { checkZone, isClock, validateSchedule } from './schedule';

/** Resolve existing ancestors before creating anything, including when the final directories do not exist. */
async function canonicalDestination(dir: string): Promise<string> {
	try {
		return await realpath(dir);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		const parent = path.dirname(dir);
		if (parent === dir) throw e;
		return path.join(await canonicalDestination(parent), path.basename(dir));
	}
}
/** The service has no Firstmate writer. Its only output is durable typed events and batches. */
export class EventsService {
	private timer: ReturnType<typeof setInterval> | null = null;
	private ticking = false;
	private lastError: string | null = null;
	private constructor(
		readonly store: EventsStore | null,
		readonly problem: string | null
	) {}
	static async open(configDir: string, homeDir: string) {
		try {
			const config = await canonicalDestination(path.resolve(configDir));
			const home = await realpath(homeDir);
			if (config === home || config.startsWith(home + path.sep))
				throw new Error(
					'Choose a Wheelhouse config directory outside the Firstmate home for Events.'
				);
			const id = createHash('sha256').update(home).digest('hex').slice(0, 16);
			const outbox = path.join(config, 'events', id, 'outbox');
			if ((await canonicalDestination(outbox)) !== outbox)
				throw new Error('Events refuses a linked outbox directory.');
			const store = new EventsStore(outbox);
			await store.initialize();
			await store.change(() => {});
			return new EventsService(store, null);
		} catch (e) {
			return new EventsService(null, (e as Error).message);
		}
	}
	start(onAutoPause: (reason: string) => void = () => {}) {
		const run = () => {
			if (this.ticking || !this.store) return;
			this.ticking = true;
			void this.store
				.change((s) => {
					const before = s.settings.source.paused;
					tick(s);
					return !before && s.settings.source.paused ? s.settings.source.reason : null;
				})
				.then(
					(reason) => {
						this.lastError = null;
						if (reason) onAutoPause(reason);
					},
					(e) => {
						this.lastError = (e as Error).message;
					}
				)
				.finally(() => {
					this.ticking = false;
				});
		};
		run();
		this.timer = setInterval(run, 15000);
		this.timer.unref?.();
	}
	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}
	async view(): Promise<EventsView> {
		const state = this.store ? await this.store.read() : emptyState();
		return {
			...state,
			events: state.events.filter((e) => e.level !== 'off'),
			problem:
				this.problem ?? this.lastError ?? (this.store ? await this.store.accessProblem() : null),
			connected: false,
			connectionProblem: null
		};
	}
	async change(input: Record<string, unknown>, now = Date.now()) {
		if (!this.store) throw new Error(this.problem!);
		const access = await this.store.accessProblem();
		if (access && !(input.action === 'pause' && input.paused === true)) throw new Error(access);
		return this.store.change((s) => {
			switch (input.action) {
				case 'pause':
					if (typeof input.paused !== 'boolean') throw new Error('paused must be true or false.');
					if (s.settings.paused && !input.paused) s.resumeNotice = true;
					s.settings.paused = input.paused;
					break;
				case 'rules':
					s.settings.rules = validateRules(input.rules);
					break;
				case 'quiet': {
					const q = input.quiet as Record<string, unknown>;
					if (
						!q ||
						typeof q.enabled !== 'boolean' ||
						!isClock(q.start) ||
						!isClock(q.end) ||
						q.start === q.end ||
						typeof input.timeZone !== 'string'
					)
						throw new Error('Choose different start and end times and a time zone.');
					checkZone(input.timeZone);
					s.settings.timeZone = input.timeZone;
					s.settings.quiet = { enabled: q.enabled, start: q.start, end: q.end };
					break;
				}
				case 'source':
					if (!isLevel(input.level) || typeof input.paused !== 'boolean')
						throw new Error('Invalid source settings.');
					s.settings.source = {
						level: input.level,
						paused: input.paused,
						reason: input.paused ? 'Paused by the captain.' : null
					};
					break;
				case 'add-reminder': {
					if (
						typeof input.text !== 'string' ||
						!input.text.trim() ||
						input.text.length > 500 ||
						typeof input.rule !== 'string' ||
						typeof input.timeZone !== 'string' ||
						!['once', 'all', 'skip'].includes(String(input.missed))
					)
						throw new Error(
							'A reminder needs text (up to 500 characters), a rule, time zone and missed policy.'
						);
					if (s.reminders.filter((r) => r.state !== 'done').length >= 200)
						throw new Error('At most 200 active or paused reminders.');
					const r: Reminder = {
						id: randomUUID(),
						text: input.text,
						rule: input.rule,
						timeZone: input.timeZone,
						missed: input.missed as Reminder['missed'],
						createdAt: new Date(now).toISOString(),
						nextAt: validateSchedule(input.rule, input.timeZone, now),
						state: 'active'
					};
					checkedReminder({
						schema: 'wh-event.v1',
						id: `sched:${r.id}:${now}`,
						source: 'schedule',
						origin: 'schedule',
						verified: 'captain',
						kind: 'schedule.reminder',
						reminderId: r.id,
						text: r.text,
						setAt: r.createdAt,
						dueAt: r.nextAt!,
						receivedAt: r.createdAt,
						missed: 0,
						ruleId: 'source-default',
						level: 'notify-only',
						readyAt: r.nextAt!,
						status: 'held',
						batchId: null
					});
					s.reminders.push(r);
					break;
				}
				case 'reminder': {
					const r = s.reminders.find((r) => r.id === input.id);
					if (!r) throw new Error('Reminder not found.');
					if (input.state !== 'active' && input.state !== 'paused' && input.state !== 'done')
						throw new Error('Invalid reminder state.');
					r.state = input.state;
					if (input.state === 'active') r.nextAt = validateSchedule(r.rule, r.timeZone, now);
					break;
				}
				default:
					throw new Error('Unknown Events action.');
			}
			tick(s, now);
		});
	}
}
