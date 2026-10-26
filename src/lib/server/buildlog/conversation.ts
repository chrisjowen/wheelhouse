import { clean, plainStatus } from '../../plain';
import type { LedgerStatus } from '../firstmate/ledger';
import { roundId, type QuestionRound, type TalkEntry } from '../../buildlog';
import type { BridgeMessage } from '../../types';

/**
 * A task's conversation between its worker and Firstmate, in time order:
 * - the worker's questions and blockers, from its status lines
 *   (`needs-decision` / `blocked`, closed by a `resolved` line on the same
 *   key), with the automated review's questions (`nm-` keys), each waiting or
 *   with Firstmate's call on it;
 * - Firstmate's steering messages, from the task's inbox (`NNN.msg`, moved to
 *   `handled/` once the worker reads them), with a message that answers a
 *   question shown as that answer rather than on its own;
 * - what the captain sent Firstmate about the task through Wheelhouse.
 * Everything is put in plain words: keys, run ids, paths and script names are
 * never shown. Pure, so it is unit-tested.
 */

export interface InboxMessage {
	/** The file name, for ordering and as a stable id (never shown). */
	name: string;
	/** When Firstmate wrote it (epoch seconds), from the record's `at=` header. */
	at: number | null;
	body: string;
	/** The worker moved it to handled/ (read it). */
	handled: boolean;
}

/** The body of a `fm-task-inbox.v1` record (headers, then `--`, then the message); the whole text for another shape. */
export function parseInboxRecord(name: string, text: string, handled: boolean): InboxMessage {
	const t = text.replace(/\r\n?/g, '\n');
	const sep = t.indexOf('\n--\n');
	const head = sep >= 0 && /^schema=/.test(t) ? t.slice(0, sep) : '';
	const body = head ? t.slice(sep + 4) : t;
	const at = /^at=(.+)$/m.exec(head)?.[1].trim() ?? null;
	const ms = at ? (/^\d+$/.test(at) ? Number(at) * 1000 : Date.parse(at)) : NaN;
	return { name, at: Number.isNaN(ms) ? null : Math.floor(ms / 1000), body: body.trim(), handled };
}

/** Operational instructions to the worker, which say nothing to the captain. */
const OPS =
	/\s*(?:In the same response|Run:? no-mistakes|Keep driving|Do not use --yes|Then (?:run|re-?attach)|Reattach with|Acknowledge by moving)[\s\S]*$/;
const PREVIEW = /^Review feedback on the live preview \([^)\n]*\):\n/;
const MAX_BODY = 4000;

/** A message's text in plain words: internals removed line by line, operational tail dropped. */
export function plainBody(text: string): string {
	const out: string[] = [];
	for (const raw of text.replace(OPS, '').split('\n')) {
		const line = raw.trim();
		if (!line) {
			if (out.length && out.at(-1) !== '') out.push('');
			continue;
		}
		const bullet = /^([-*•]|\d+[.)])\s+/.exec(line)?.[0] ?? '';
		const c = clean(line.slice(bullet.length));
		if (c) out.push(`${bullet ? '- ' : ''}${c}`);
	}
	const s = out.join('\n').trim();
	return s.length > MAX_BODY ? `${s.slice(0, MAX_BODY - 1)}…` : s;
}

/** The first sentence, bounded, for a one-line title. */
function firstLine(text: string, max = 140): string {
	const first = text.split('\n').find((l) => l.trim()) ?? '';
	const s = first
		.replace(/^- /, '')
		.split(/(?<=[.!?])\s/)[0]
		.trim();
	return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const iso = (ts: number | null) => (ts === null ? null : new Date(ts * 1000).toISOString());
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export interface ConversationInput {
	statuses: LedgerStatus[];
	inbox: InboxMessage[];
	/** The review's question rounds (any order), matched to their status lines by key and time. */
	rounds: QuestionRound[];
	/** Messages sent to Firstmate through Wheelhouse about this task. */
	captain: BridgeMessage[];
	/** When the task was dispatched (epoch seconds), for undated inbox messages. */
	dispatchedAt: number | null;
}

interface Open {
	entry: TalkEntry;
	key: string | null;
	ts: number;
}

/** A message answers a question when it repeats the answer's start, or arrives within minutes of it. */
const ANSWER_WINDOW = 10 * 60;
const CLOSE = 3 * 60;

export function conversation(i: ConversationInput): TalkEntry[] {
	const out: TalkEntry[] = [];
	const open: Open[] = [];
	const inbox = [...i.inbox].sort(
		(a, b) => (a.at ?? 0) - (b.at ?? 0) || a.name.localeCompare(b.name)
	);
	const used = new Set<string>();
	const rounds = new Map(i.rounds.map((r) => [r.id, r]));

	/** The message carrying an answer: one that repeats its start, else (unless `exact`) the closest within minutes. */
	const answerMessage = (answer: string, ts: number, exact: boolean): InboxMessage | null => {
		const probe = norm(answer).slice(0, 48);
		const near = inbox.filter(
			(m) => !used.has(m.name) && m.at !== null && Math.abs(m.at - ts) <= ANSWER_WINDOW
		);
		const same = probe.length > 8 ? near.find((m) => norm(m.body).includes(probe)) : undefined;
		if (same || exact) return same ?? null;
		return (
			near
				.filter((m) => Math.abs(m.at! - ts) <= CLOSE)
				.sort((a, b) => Math.abs(a.at! - ts) - Math.abs(b.at! - ts))[0] ?? null
		);
	};

	for (const s of [...i.statuses].sort((a, b) => a.ts - b.ts)) {
		const state = s.state ?? '';
		if (state === 'needs-decision' || state === 'blocked') {
			const key = s.key ?? null;
			const again = key ? open.find((o) => o.key === key) : undefined;
			if (again) continue;
			const review = !!key?.startsWith('nm-');
			const r = review && key ? rounds.get(roundId(key, s.ts)) : undefined;
			const n = /\bfindings=(\S+)/.exec(s.text)?.[1].split(',').filter(Boolean).length ?? 0;
			const asked = r?.questions.length ?? n;
			const body = review ? null : plainBody(s.text);
			const title = review
				? `The automated review raised ${asked === 1 ? 'a question' : `${asked || 'some'} questions`} for Firstmate`
				: state === 'blocked'
					? `The worker was stuck: ${lower(firstLine(body || plainStatus(state, s.text)))}`
					: firstLine(body || '') || plainStatus(state, s.text);
			const entry: TalkEntry = {
				id: `status-${s.ts}-${out.length}`,
				at: iso(s.ts)!,
				kind: review ? 'review' : state === 'blocked' ? 'blocked' : 'question',
				from: review ? 'review' : 'worker',
				to: 'firstmate',
				title,
				body: body ? rest(body, title) : null,
				questions: r?.questions ?? [],
				reply: null,
				outcome: { state: 'open', label: 'Waiting on Firstmate' }
			};
			out.push(entry);
			open.push({ entry, key, ts: s.ts });
		} else if (state === 'resolved') {
			const at = s.key
				? open.findIndex((o) => o.key === s.key)
				: open.findLastIndex((o) => !o.key?.startsWith('nm-'));
			if (at < 0) continue;
			const [o] = open.splice(at, 1);
			const answered = /^answered:/i.test(s.text.trim());
			const text = s.text.replace(/^answered:\s*/i, '').replace(/\s*\[truncated\]\s*$/, '');
			const decidedFor = o.entry.questions.some((q) => q.verdict);
			const msg = answered ? answerMessage(text, s.ts, o.entry.kind === 'review') : null;
			if (msg) used.add(msg.name);
			const full = plainBody(msg?.body ?? text);
			// A review's answer is shown as Firstmate's call on each question instead.
			o.entry.reply = decidedFor
				? null
				: {
						at: iso(s.ts),
						from: answered ? 'firstmate' : 'worker',
						text: full || plainStatus('resolved', s.text)
					};
			o.entry.outcome = answered
				? {
						state: 'answered',
						label:
							msg && !msg.handled
								? 'Answered; the worker has not read it yet'
								: decidedFor
									? 'Firstmate decided'
									: 'Answered'
					}
				: { state: 'cleared', label: 'Cleared without an answer' };
		}
	}

	const captainProbes = i.captain.map((m) => norm(m.text.replace(PREVIEW, '')).slice(0, 48));
	for (const m of inbox) {
		if (used.has(m.name)) continue;
		const fromCaptain = PREVIEW.test(m.body);
		const n = norm(m.body);
		// The captain's own message, passed on: shown once, as the captain's.
		if (captainProbes.some((p) => p.length > 8 && n.includes(p))) continue;
		const text = plainBody(m.body.replace(PREVIEW, ''));
		if (!text) continue;
		const title = firstLine(text);
		out.push({
			id: `inbox-${m.name}`,
			at: iso(m.at ?? i.dispatchedAt) ?? new Date(0).toISOString(),
			kind: fromCaptain ? 'captain' : 'steer',
			from: fromCaptain ? 'captain' : 'firstmate',
			to: 'worker',
			title: fromCaptain ? 'Your feedback from the live preview, passed on to the worker' : title,
			body: fromCaptain ? text : rest(text, title),
			questions: [],
			reply: null,
			outcome: m.handled
				? { state: 'read', label: 'The worker has read it' }
				: { state: 'unread', label: 'Not read by the worker yet' }
		});
	}

	for (const m of i.captain) {
		const preview = PREVIEW.test(m.text);
		const text = m.text.replace(PREVIEW, '').trim();
		out.push({
			id: `captain-${m.requestId}`,
			at: m.submittedAt,
			kind: 'captain',
			from: 'captain',
			to: 'firstmate',
			title: preview ? 'You sent feedback from the live preview' : 'You wrote to Firstmate',
			body: text,
			questions: [],
			reply: m.reply ? { at: m.reply.at, from: 'firstmate', text: m.reply.body } : null,
			outcome: {
				state: 'sent',
				label:
					m.delivery === 'failed'
						? 'Not delivered'
						: m.acknowledged
							? 'Firstmate has it'
							: m.delivery === 'delivered'
								? 'Sent to Firstmate'
								: 'Sending'
			}
		});
	}
	return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** What a message says beyond its title line, or null when the title is all of it. */
function rest(text: string, title: string): string | null {
	const t = title.replace(/…$/, '');
	const r = text.startsWith(t) && !title.endsWith('…') ? text.slice(t.length).trim() : text;
	return r && r !== title ? r : null;
}

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * How many questions the task's worker and review raised, and how many are
 * still open. Each of the review's findings put to Firstmate is a question.
 */
export function questionCounts(statuses: LedgerStatus[]): { questions: number; open: number } {
	const open = new Map<string, number>();
	let questions = 0;
	let anon = 0;
	for (const s of [...statuses].sort((a, b) => a.ts - b.ts)) {
		if (s.state === 'needs-decision' || s.state === 'blocked') {
			const key = s.key ?? `#${++anon}`;
			if (open.has(key)) continue;
			const n = Math.max(
				1,
				/\bfindings=(\S+)/.exec(s.text)?.[1].split(',').filter(Boolean).length ?? 1
			);
			open.set(key, n);
			questions += n;
		} else if (s.state === 'resolved') {
			if (s.key) open.delete(s.key);
			else {
				const last = [...open.keys()].filter((k) => !k.startsWith('nm-')).at(-1);
				if (last) open.delete(last);
			}
		}
	}
	return { questions, open: [...open.values()].reduce((a, b) => a + b, 0) };
}
