import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { fold } from '$lib/chat/fold';
import { callName, type InboxCard, type InboxView } from '$lib/inbox';
import type { FleetView } from '$lib/types';

/**
 * What the discussion crew is told when Live mode starts: the fleet as it
 * stands (work in flight with its latest status lines, what is queued, what
 * landed), the decisions waiting on the captain, and the recent conversation
 * between the captain and Firstmate, and, when the captain opened Live from a
 * decision, that decision in full first. `digest` is pure, so it is unit-tested;
 * `gatherContext` reads Wheelhouse's own views and Firstmate's state files,
 * never changing anything.
 */

export interface ChatLine {
	who: 'captain' | 'firstmate';
	at: string | null;
	text: string;
}

export interface ContextInput {
	fleet: Pick<FleetView, 'tasks' | 'secondMates'>;
	inbox: Pick<InboxView, 'cards'>;
	chat: ChatLine[];
	/** The last status lines of each task in flight, by task id. */
	status: Map<string, string[]>;
	/** A task's report on disk, by task id, for the crew to read when asked. */
	reports: Map<string, string>;
	/** Reports in the projects the discussion is about, by title, for the crew to open when asked. */
	documents?: { title: string; project: string; file: string }[];
	/** The decision the captain opened Live to talk through, with the report section it rests on. */
	focus?: { card: InboxCard; report: string | null } | null;
	now: Date;
}

/** A decision's calls, a line each: "D1) Where…: a) Per workspace (recommended) / b) Per org". */
function callLines(card: InboxCard, max = 220): string[] {
	return (card.choices?.calls ?? [])
		.filter((c) => c.options.length)
		.map((c) => {
			const opts = c.options
				.map(
					(o) =>
						`${o.id}) ${clip(o.detail ?? o.label, 120)}${o.recommended ? ' (recommended)' : ''}`
				)
				.join(' / ');
			return clip(`${callName(c) || c.id} [call ${c.id}]: ${opts}`, max * 3);
		});
}

/** The decision the discussion is about, in full: what Firstmate wrote, every call and why, the report. */
function focusSection(f: NonNullable<ContextInput['focus']>): string[] {
	const c = f.card;
	const lines = [
		'## The decision the captain opened Live to talk through',
		`Decision id: ${c.id} (task ${c.taskId}${c.origin ? `, from ${c.origin}` : ''}). Talk it through with the captain, starting with the calls that matter most; when a call is settled, write a decision block for it.`,
		`Title: ${c.title}`,
		`Asked: ${clip(c.question, 1200)}`
	];
	if (c.recommendation?.text) lines.push(`Firstmate recommends: ${c.recommendation.text}`);
	const calls = c.choices?.calls ?? [];
	if (calls.length) {
		lines.push('Its calls:');
		for (const call of calls) {
			lines.push(
				`- ${callName(call) || call.id} [call ${call.id}]${call.key ? ' (matters most)' : ''}`
			);
			for (const o of call.options)
				lines.push(`  ${o.id}) ${o.detail ?? o.label}${o.recommended ? ' (recommended)' : ''}`);
			if (call.why) lines.push(`  Why the recommendation: ${call.why}`);
		}
	} else {
		lines.push(`Answers: ${c.options.map((o) => `${o.label} (${o.meaning})`).join(' / ')}`);
	}
	if (c.evidence.text) lines.push('', "Firstmate's note on it:", clip(c.evidence.text, 6000));
	if (c.evidence.preview) lines.push(`Live preview: ${c.evidence.preview}`);
	if (f.report) lines.push('', 'The report it rests on (the relevant part):', clip(f.report, 8000));
	return lines;
}

/** Tasks still on the go: what the crew opens with. */
export const IN_FLIGHT = new Set([
	'working',
	'blocked',
	'needs-decision',
	'paused',
	'unknown',
	'failed'
]);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function digest(input: ContextInput): string {
	const { fleet, inbox, chat, status, reports, now } = input;
	const lines: string[] = [`Snapshot taken ${now.toISOString()}.`];
	if (input.focus) lines.push('', ...focusSection(input.focus));
	const tasks = fleet.tasks;
	const project = (t: (typeof tasks)[number]) => t.projectId ?? 'no project';
	const pr = (t: (typeof tasks)[number]) => (t.pr ? ` Pull request: ${t.pr.url}.` : '');
	const report = (id: string) => (reports.get(id) ? ` Report: ${reports.get(id)}.` : '');

	lines.push('', '## In flight (workers running now)');
	const live = tasks.filter((t) => IN_FLIGHT.has(t.status));
	if (!live.length) lines.push('- none');
	for (const t of live) {
		lines.push(`- [${t.id}] (${project(t)}) ${t.title}`);
		lines.push(
			`  ${t.statusLabel}. Now: ${t.summary || '-'}.${pr(t)}${t.preview ? ` Live preview: ${t.preview.url}.` : ''}${report(t.id)}`
		);
		const recent = status.get(t.id);
		if (recent?.length) lines.push(`  Latest status lines: ${recent.join(' | ')}`);
	}
	lines.push('', '## Queued (not started)');
	const queued = tasks.filter((t) => t.status === 'queued');
	if (!queued.length) lines.push('- none');
	for (const t of queued) lines.push(`- [${t.id}] (${project(t)}) ${t.title}. ${t.summary ?? ''}`);
	lines.push('', '## Landed or finished recently');
	const done = tasks.filter((t) => !IN_FLIGHT.has(t.status) && t.status !== 'queued');
	if (!done.length) lines.push('- none');
	for (const t of done)
		lines.push(`- [${t.id}] (${project(t)}) ${t.title}. ${t.summary ?? ''}${pr(t)}${report(t.id)}`);

	lines.push('', '## Decisions waiting on the captain');
	if (!inbox.cards.length) lines.push('- none');
	for (const c of inbox.cards) {
		const options = c.options.map((o) => o.label).join(' / ');
		const rec = c.recommendation?.text ? ` Recommended: ${c.recommendation.text}` : '';
		lines.push(
			`- [${c.taskId}] ${c.kind} (decision id ${c.id}): ${clip(c.question, 400)} Options: ${options}.${rec}`
		);
		for (const l of callLines(c)) lines.push(`  ${l}`);
	}

	if (input.documents?.length) {
		lines.push(
			'',
			'## Documents in these projects (by title; open the file when the discussion needs one)'
		);
		for (const d of input.documents) lines.push(`- "${d.title}" (${d.project}): ${d.file}`);
	}

	if (fleet.secondMates.length) {
		lines.push('', '## Second mates');
		for (const m of fleet.secondMates)
			lines.push(`- ${m.id}${m.host ? ` on ${m.host}` : ''}: ${m.stateLabel}`);
	}

	lines.push('', '## Recent conversation between the captain and Firstmate (oldest first)');
	if (!chat.length) lines.push('- none read');
	for (const m of chat)
		lines.push(
			`${m.who === 'captain' ? 'CAPTAIN' : 'FIRSTMATE'}${m.at ? ` (${m.at.slice(11, 16)}Z)` : ''}: ${m.text.replace(/\s+/g, ' ')}`
		);
	return lines.join('\n');
}

/** The captain's and Firstmate's own words from transcript records, newest `limit`, oldest first. */
export function chatLines(records: Parameters<typeof fold>[0], limit = 36): ChatLine[] {
	const out: ChatLine[] = [];
	for (const item of fold(records).items) {
		if (item.kind === 'user' && !item.command && item.text.trim())
			out.push({ who: 'captain', at: item.at, text: clip(item.text.trim(), 900) });
		else if (item.kind === 'turn' && item.trigger === 'captain') {
			const text = item.parts
				.filter((p) => p.kind === 'text')
				.map((p) => (p as { text: string }).text)
				.join('\n')
				.replace(/<!--[\s\S]*?-->/g, '')
				.trim();
			if (text) out.push({ who: 'firstmate', at: item.at, text: clip(text, 900) });
		}
	}
	return out.slice(-limit);
}

async function tail(file: string, bytes: number): Promise<string> {
	const fh = await open(file, 'r');
	try {
		const { size } = await fh.stat();
		const start = Math.max(0, size - bytes);
		const buf = Buffer.alloc(size - start);
		await fh.read(buf, 0, buf.length, start);
		const text = buf.toString('utf8');
		return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
	} finally {
		await fh.close();
	}
}

/** The last few status lines Firstmate's workers wrote, and the reports they left, from the home. */
export async function taskNotes(
	home: string,
	ids: string[]
): Promise<{ status: Map<string, string[]>; reports: Map<string, string> }> {
	const status = new Map<string, string[]>();
	const reports = new Map<string, string>();
	for (const id of ids) {
		const own = id.split('@')[0];
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(own) || id.includes('@')) continue;
		const file = path.join(home, 'state', `${own}.status`);
		if (existsSync(file)) {
			const text = await tail(file, 8000).catch(() => '');
			const recent = text
				.trim()
				.split('\n')
				.filter(Boolean)
				.slice(-4)
				.map((l) => clip(l.replace(/\s*\[at=\d+\]/, ''), 260));
			if (recent.length) status.set(id, recent);
		}
		const report = path.join(home, 'data', own, 'report.md');
		if (existsSync(report)) reports.set(id, report);
	}
	return { status, reports };
}
