import { clean } from './plain';
import type { Activity, TaskStatus, TaskSummary } from './types';

/**
 * What a Harbour card says: a short title, who is doing the work, and what
 * they are doing now. Pure, so it is unit-tested; the server uses shortTitle,
 * the cards use the rest.
 */

const HARNESS: Record<string, string> = {
	claude: 'Claude',
	codex: 'Codex',
	pi: 'Pi',
	copilot: 'Copilot',
	cursor: 'Cursor',
	gemini: 'Gemini',
	opencode: 'OpenCode',
	grok: 'Grok',
	antigravity: 'Antigravity',
	devin: 'Devin'
};

export const harnessName = (harness: string) => HARNESS[harness.toLowerCase()] ?? harness;

/** A backlog title without its leading "<project>:" prefix (the card already names the project). */
export function shortTitle(title: string, projectId: string | null): string {
	const m = /^\s*([\w.-]+)\s*:\s+(\S.*)$/.exec(title);
	if (!m || !projectId || m[1].toLowerCase() !== projectId.toLowerCase()) return title;
	return m[2][0].toUpperCase() + m[2].slice(1);
}

/** "Claude · default model · fm-wh-plugins": harness, requested model and worker name. */
export function agentLine(worker: TaskSummary['worker']): string | null {
	if (!worker?.harness) return null;
	return [harnessName(worker.harness), worker.model ?? 'default model', worker.name]
		.filter(Boolean)
		.join(' · ');
}

/** Statuses whose card shows the worker's live console instead of a picture of finished work. */
const LIVE: ReadonlySet<TaskStatus> = new Set([
	'working',
	'waiting',
	'with-firstmate',
	'blocked',
	'failed',
	'unknown',
	'needs-decision'
]);

/** The image window shows the live console while work is not completed and a terminal exists. */
export const consoleInImage = (t: TaskSummary) => t.outputAvailable && LIVE.has(t.status);

/** Terminal chrome that says nothing about the work: prompts, rules, hints and status bars. */
const CHROME =
	/bypass permissions|shift\+tab|esc to interrupt|\? for shortcuts|ctrl\+[a-z]|update available|^tip:|auto-accept|context left|tokens\)?$/i;
/** A harness spinner line with a whimsical verb and a timer, e.g. "✢ Schlepping… (3m 13s · ↓ 14.9k tokens)". */
const SPINNER = /^\S\s+\w+…\s*\(/;
const RULE = /^[\s─━═│┃╭╮╰╯┌┐└┘├┤┬┴┼▔▁·.\-_=*]+$/;
const BULLET = /^[⏺●•◆▶]\s+(.+)$/;

/**
 * The latest line of a console sample that says what the worker is doing: the
 * newest narration or tool bullet ("⏺ Running the test suite"), else the
 * newest plain line that is not terminal chrome. Internals are cleaned out;
 * null when nothing readable is left.
 */
export function meaningfulConsoleLine(lines: readonly string[]): string | null {
	let plain: string | null = null;
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (!line || RULE.test(line) || CHROME.test(line) || SPINNER.test(line)) continue;
		if (/^[❯>$]\s?/.test(line) || /^⎿/.test(line)) continue;
		const bullet = BULLET.exec(line);
		const text = bullet ? bullet[1] : line;
		// Drop a trailing timer such as " · 29s".
		const cleaned = clean(text.replace(/\s+·\s+[\dhms ]+$/, ''));
		if (!cleaned) continue;
		if (bullet) return bound(cleaned);
		// Indented lines are tool output; prefer an unindented line.
		if (plain === null && !/^\s/.test(lines[i])) plain = cleaned;
	}
	return plain ? bound(plain) : null;
}

const bound = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A status line older than this gives way to the live console on a busy worker's card. */
export const STALE_STATUS_MS = 2 * 60_000;

/** The latest meaningful line of a worker's console sample, and when it was captured. */
export interface ConsoleSample {
	line: string | null;
	capturedAt: string | null;
}

export interface NowLine {
	text: string;
	at: string | null;
	source: Activity['source'] | 'console';
}

/**
 * The card's "Now:" line: the server's activity (pipeline step, latest status
 * line or crew state), unless the worker is busy and its status line is old
 * or missing, when the latest meaningful console line says more.
 */
export function nowLine(t: TaskSummary, sample: ConsoleSample | null, now: number): NowLine | null {
	const a = t.activity;
	if (sample?.line && t.busy) {
		const statusAge = a?.at ? now - Date.parse(a.at) : Infinity;
		const stale =
			!a || a.source === 'state' || (a.source === 'status' && !(statusAge <= STALE_STATUS_MS));
		if (stale) return { text: sample.line, at: sample.capturedAt, source: 'console' };
	}
	return a ? { text: a.text, at: a.at, source: a.source } : null;
}
