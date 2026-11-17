import { structured } from '../../previewhelper';
import {
	bytes,
	span,
	type Finding,
	type MachineSample,
	type PageSignal,
	type ProcessVitals,
	type Report,
	type ReportItem
} from '../../soundings';
import { maskSecrets } from './mask';

/**
 * Soundings' report: about hourly, or when a new finding opens, one cheap
 * `claude -p` run (the preview helper's runner: no session, no settings, no
 * tools) reads a short summary of the latest scan, Wheelhouse's vitals, the
 * open findings and what is normal for this computer, and writes a few plain
 * sentences: what is wrong, the likely cause, and what the captain could do.
 *
 * What it is given is trimmed (the busiest few processes, not all of them) and
 * passed through maskSecrets as a whole on top of the masking every command
 * line already had, so a secret in a command line never reaches the model.
 * The report only advises: its fixes are words for the captain, never run.
 */

export const REPORT_SYSTEM = `You are Soundings, the health check inside Wheelhouse, a local app that runs AI coding agents on the user's computer. You read a short summary of the computer and of Wheelhouse itself and write a brief, calm report for a busy person, in plain words with no jargon.

Rules:
- Compare against "Normal for this computer" when it is given: say what is unusual, not what is merely large.
- Lead with what matters most. If nothing needs attention, say so in one line and leave items empty.
- Each item: what is wrong (title, a few words), the likely cause (one sentence), and a suggested fix (one sentence, something the person can do or ask their assistant to do). Never suggest deleting data without checking first.
- Findings already raised by the rules are facts; explain them, do not repeat them word for word.
- At most 5 items. No markdown, no lists inside fields, no greetings.
- status is "attention" when anything wants a look, else "ok".`;

export const REPORT_SCHEMA = {
	type: 'object',
	properties: {
		status: { type: 'string', enum: ['ok', 'attention'] },
		headline: { type: 'string', description: 'One short sentence, the gist.' },
		summary: { type: 'string', description: 'Two or three sentences.' },
		items: {
			type: 'array',
			maxItems: 5,
			items: {
				type: 'object',
				properties: {
					title: { type: 'string' },
					cause: { type: 'string' },
					fix: { type: 'string' }
				},
				required: ['title', 'cause', 'fix']
			}
		}
	},
	required: ['status', 'headline', 'summary', 'items']
} as const;

/** What is usual for this computer, from the scans of the last day. */
export interface Normal {
	scans: number;
	/** Median one-minute load. */
	load: number | null;
	/** Median share of memory available, in percent. */
	availablePercent: number | null;
}

export interface ReportContext {
	now: number;
	machine: MachineSample | null;
	/** CPU use over the last scan interval, by pid (percent of one core). */
	cpu: Map<number, number>;
	/** Restarts since about an hour ago, by service label. */
	restarts: Map<string, number>;
	vitals: ProcessVitals | null;
	findings: Finding[];
	signals: PageSignal[];
	normal: Normal;
	previous: Report | null;
}

const MAX_TEXT = 12_000;

/** The summary the report is written from: trimmed, in plain lines, secrets masked. */
export function reportPrompt(c: ReportContext): string {
	const lines: string[] = [];
	const m = c.machine;
	lines.push(`Now: ${new Date(c.now).toISOString()}`);
	if (m) {
		lines.push('', `# This computer (${m.platform}, ${m.cpus} CPUs), scanned ${m.at}`);
		lines.push(`Load (1, 5, 15 min): ${m.load.map((n) => n.toFixed(2)).join(', ')}`);
		const avail =
			m.memory.availableBytes !== null
				? `${bytes(m.memory.availableBytes)} available of ${bytes(m.memory.totalBytes)}`
				: `${bytes(m.memory.totalBytes)} total`;
		lines.push(
			`Memory: ${avail}; pressure ${m.memory.pressure ?? 'unknown'}; swap used ${bytes(m.memory.swapUsedBytes)}`
		);
		for (const d of m.disks)
			lines.push(
				`Disk ${d.mount}: ${bytes(d.availBytes)} free of ${bytes(d.sizeBytes)} (${Math.round((d.availBytes / d.sizeBytes) * 100)}%)`
			);
		const busy = [...m.processes]
			.map((p) => ({ p, cpu: c.cpu.get(p.pid) ?? p.pcpu }))
			.sort((a, b) => b.cpu - a.cpu)
			.slice(0, 8);
		lines.push('', '## Busiest processes (CPU % of one core over the last scan interval)');
		for (const { p, cpu } of busy)
			lines.push(
				`- ${p.name} pid ${p.pid}: ${Math.round(cpu)}% CPU, ${bytes(p.rssBytes)}, up ${span(p.ageSeconds)}: ${p.command}`
			);
		const big = [...m.processes].sort((a, b) => b.rssBytes - a.rssBytes).slice(0, 5);
		lines.push('', '## Largest processes');
		for (const p of big) lines.push(`- ${p.name} pid ${p.pid}: ${bytes(p.rssBytes)}`);
		const services = m.services.filter(
			(s) => (c.restarts.get(s.label) ?? 0) > 0 || (s.lastExit !== null && s.lastExit !== 0)
		);
		if (services.length) {
			lines.push('', '## Background services that restarted or last failed');
			for (const s of services.slice(0, 10))
				lines.push(
					`- ${s.label}: ${c.restarts.get(s.label) ?? 0} restarts in the last hour, ${s.runs ?? '?'} runs since login, last exit ${s.lastExit ?? '?'}, ${s.state ?? 'state unknown'}${s.periodic ? ', runs on a timer' : ''}${s.program ? `; runs ${s.program}` : ''}`
				);
		}
		const dev = m.listeners.filter((l) => l.dev);
		if (dev.length) {
			lines.push('', '## Development servers listening');
			for (const l of dev.slice(0, 10))
				lines.push(
					`- ${l.name} on port ${l.port}${l.ageSeconds !== null ? `, up ${span(l.ageSeconds)}` : ''}`
				);
		}
		if (m.logs.length) {
			lines.push('', '## Largest log files');
			for (const l of m.logs.slice(0, 5)) lines.push(`- ${l.path}: ${bytes(l.bytes)}`);
		}
		if (m.gaps.length) lines.push('', `Could not read: ${m.gaps.join(', ')}`);
	} else lines.push('', 'No scan of the computer yet.');
	const v = c.vitals;
	if (v) {
		lines.push('', '# Wheelhouse itself');
		lines.push(
			`Up ${span(v.uptimeSeconds)}; footprint ${bytes(v.footprintBytes)}, heap after GC ${bytes(v.postGcHeapBytes)}, RSS ${bytes(v.rssBytes)}`
		);
		lines.push(
			`Event loop p99 ${v.eventLoopP99Ms} ms; last fleet snapshot ${v.lastSnapshotMs === null ? 'not yet' : `${(v.lastSnapshotMs / 1000).toFixed(1)} s`}; ${v.streams} open streams; ${v.chatFeeds.count} chat followers (${v.chatFeeds.orphans} orphaned); ${v.childrenPerMinute} child processes in the last minute`
		);
	}
	if (c.normal.scans >= 3) {
		lines.push(
			'',
			`# Normal for this computer (median of ${c.normal.scans} scans over the last day)`
		);
		if (c.normal.load !== null) lines.push(`Load: ${c.normal.load.toFixed(2)}`);
		if (c.normal.availablePercent !== null)
			lines.push(`Memory available: ${Math.round(c.normal.availablePercent)}%`);
	}
	lines.push('', '# Findings the rules raised');
	if (c.findings.length)
		for (const f of c.findings) lines.push(`- [${f.severity}] ${f.title}. ${f.detail}`);
	else lines.push('None.');
	const recent = c.signals.filter((g) => c.now - Date.parse(g.at) <= 3600_000);
	if (recent.length) {
		lines.push('', "# Trouble in Wheelhouse's own pages over the last hour");
		const kinds = new Map<string, number>();
		for (const g of recent) kinds.set(g.kind, (kinds.get(g.kind) ?? 0) + g.count);
		lines.push([...kinds].map(([k, n]) => `${k}: ${n}`).join(', '));
		for (const g of recent.slice(0, 5)) lines.push(`- ${g.page}: ${g.message}`);
	}
	if (c.previous) lines.push('', `# The previous report (${c.previous.at})`, c.previous.headline);
	const text = maskSecrets(lines.join('\n'));
	return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(cut)` : text;
}

const tidy = (s: string, max: number) => {
	const t = s.replace(/\s+/g, ' ').trim();
	return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** The report's fields, from claude's JSON result; null when it cannot be read. */
export function readReport(
	stdout: string
): Pick<Report, 'status' | 'headline' | 'summary' | 'items'> | null {
	const out = structured(stdout, () => null);
	if (!out || typeof out.headline !== 'string' || !out.headline.trim()) return null;
	const items: ReportItem[] = Array.isArray(out.items)
		? (out.items as unknown[])
				.map((i) => (typeof i === 'object' && i !== null ? i : {}) as Record<string, unknown>)
				.filter((i) => typeof i.title === 'string' && i.title.trim())
				.map((i) => ({
					title: tidy(String(i.title), 120),
					cause: tidy(typeof i.cause === 'string' ? i.cause : '', 400),
					fix: tidy(typeof i.fix === 'string' ? i.fix : '', 400)
				}))
				.slice(0, 5)
		: [];
	return {
		status: out.status === 'attention' || items.length ? 'attention' : 'ok',
		headline: tidy(out.headline, 200),
		summary: tidy(typeof out.summary === 'string' ? out.summary : '', 800),
		items
	};
}

/** The median of some numbers; null when there are none. */
export function median(xs: number[]): number | null {
	if (!xs.length) return null;
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
