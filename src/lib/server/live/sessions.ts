import { randomUUID } from 'node:crypto';
import type { FleetView } from '$lib/types';
import type { InboxView } from '$lib/inbox';
import { which } from '../sessions/tmux';
import { chatLines, digest, IN_FLIGHT, taskNotes } from './context';
import { Crew } from './crew';
import { crewLaunch } from './tools';
import type { CatchUpItem } from '$lib/live/catchup';

/**
 * Live mode discussions held by this server: each a Crew with the fleet as it
 * stood when it began, so the end can say what moved meanwhile. A discussion
 * nobody has spoken in for half an hour ends by itself.
 */

export interface LiveSession {
	id: string;
	crew: Crew;
	model: string;
	context: string;
	before: { fleet: FleetView; inbox: InboxView };
	startedAt: number;
	lastUsed: number;
}

const IDLE_MS = 30 * 60_000;
/** How often running discussions are checked for having gone idle. */
export const SWEEP_MS = 60_000;
const sessions = new Map<string, LiveSession>();
let sweeper: ReturnType<typeof setInterval> | null = null;

/** What changed on the fleet between two snapshots, as the captain's catch-up. Pure. */
export function catchUp(
	before: { fleet: Pick<FleetView, 'tasks'>; inbox: Pick<InboxView, 'cards'> },
	after: { fleet: Pick<FleetView, 'tasks'>; inbox: Pick<InboxView, 'cards'> }
): CatchUpItem[] {
	const prev = new Map(before.fleet.tasks.map((t) => [t.id, t]));
	const items: CatchUpItem[] = [];
	for (const t of after.fleet.tasks) {
		const p = prev.get(t.id);
		if (!p)
			items.push({
				kind: 'new',
				task: t.id,
				title: t.shortTitle,
				project: t.projectId,
				to: t.statusLabel,
				summary: 'New task',
				text: `New task, ${t.statusLabel.toLowerCase()}`
			});
		else if (p.status !== t.status)
			items.push({
				kind: 'moved',
				task: t.id,
				title: t.shortTitle,
				project: t.projectId,
				from: p.statusLabel,
				to: t.statusLabel,
				summary: `${p.statusLabel} → ${t.statusLabel}`,
				text: `${p.statusLabel} → ${t.statusLabel}`
			});
	}
	const was = new Set(before.inbox.cards.map((c) => c.id));
	const now = new Set(after.inbox.cards.map((c) => c.id));
	for (const c of after.inbox.cards)
		if (!was.has(c.id))
			items.push({
				kind: 'decision',
				task: c.taskId,
				title: c.taskTitle,
				project: c.projectId,
				summary: c.title || c.question,
				text: c.question
			});
	for (const c of before.inbox.cards)
		if (!now.has(c.id))
			items.push({
				kind: 'cleared',
				task: c.taskId,
				title: c.taskTitle,
				project: c.projectId,
				summary: 'Decision settled',
				text: c.title || 'Decision settled'
			});
	return items;
}

export interface StartDeps {
	fleet: () => Promise<FleetView>;
	inbox: () => Promise<InboxView>;
	/** Firstmate's transcript records, for the recent conversation. */
	records: () => Parameters<typeof chatLines>[0];
	/** Firstmate's operational home (state/ and data/). */
	home: string;
	/** Wheelhouse's config directory, holding Settings → Discussion. */
	configDir: string;
	/** Reports in these projects, by title, for the crew to open when asked. */
	documents?: (
		projects: Set<string>
	) => Promise<{ title: string; project: string; file: string }[]>;
	env?: NodeJS.ProcessEnv;
}

export class LiveUnavailable extends Error {}

export async function startSession(deps: StartDeps): Promise<LiveSession> {
	sweep();
	const env = deps.env ?? process.env;
	const claude = env.WHEELHOUSE_LIVE_CLAUDE || which('claude', env.PATH);
	if (!claude) throw new LiveUnavailable('Live mode needs Claude Code (claude) on PATH.');
	const model = env.WHEELHOUSE_LIVE_MODEL || 'sonnet';
	const [fleet, inbox] = await Promise.all([deps.fleet(), deps.inbox()]);
	const ids = fleet.tasks.map((t) => t.id);
	const notes = await taskNotes(deps.home, ids);
	// What the discussion is about: the projects with work in flight or a decision waiting.
	const projects = new Set(
		[
			...fleet.tasks.filter((t) => IN_FLIGHT.has(t.status)).map((t) => t.projectId),
			...inbox.cards.map((c) => c.projectId)
		].filter((p): p is string => !!p)
	);
	const documents = await (deps.documents?.(projects) ?? Promise.resolve([])).catch(() => []);
	const context = digest({
		fleet,
		inbox,
		chat: chatLines(deps.records()),
		status: notes.status,
		reports: notes.reports,
		documents,
		now: new Date()
	});
	const launch = await crewLaunch({ configDir: deps.configDir, home: deps.home, env }, claude);
	const crew = new Crew({ context, claude, model, launch });
	await crew.start();
	const session: LiveSession = {
		id: randomUUID(),
		crew,
		model,
		context,
		before: { fleet, inbox },
		startedAt: Date.now(),
		lastUsed: Date.now()
	};
	sessions.set(session.id, session);
	crew.on((e) => {
		if (e.type === 'gone') forget(session.id);
	});
	// An abandoned discussion ends on time even when no other one starts.
	if (!sweeper) {
		sweeper = setInterval(sweep, SWEEP_MS);
		sweeper.unref?.();
	}
	return session;
}

/** A running discussion, marked as used. */
export function liveSession(id: string): LiveSession | null {
	const s = sessions.get(id) ?? null;
	if (s) s.lastUsed = Date.now();
	return s;
}

export function endSession(id: string): void {
	const s = sessions.get(id);
	if (!s) return;
	forget(id);
	s.crew.stop();
}

function forget(id: string) {
	sessions.delete(id);
	if (!sessions.size && sweeper) {
		clearInterval(sweeper);
		sweeper = null;
	}
}

/** How many tasks were in flight in a fleet, for the crew's opening line. */
export const inFlight = (fleet: Pick<FleetView, 'tasks'>) =>
	fleet.tasks.filter((t) => IN_FLIGHT.has(t.status)).length;

function sweep() {
	for (const [id, s] of sessions)
		if (Date.now() - s.lastUsed > IDLE_MS || !s.crew.alive) endSession(id);
}

process.once('exit', () => {
	for (const s of sessions.values()) s.crew.stop();
});
