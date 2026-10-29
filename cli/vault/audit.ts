import { appendFile, chmod, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from './store';

/**
 * The usage log: one JSON line per use of the vault (each `run`, and each
 * change to what it holds or grants), beside the vault file. A line names the
 * secrets, never a value, so the log can be read, copied and shown freely.
 */

export const AUDIT_FILE = 'audit.jsonl';

export type AuditEvent = 'run' | 'set' | 'remove' | 'grant' | 'revoke';
/**
 * For a run: ok (the command ran, whatever its exit), denied (the names were
 * not granted, or the project unknown), unavailable (the backend would not
 * hand the values over), failed (the command could not start).
 */
export type AuditOutcome = 'ok' | 'denied' | 'unavailable' | 'failed';

export interface AuditEntry {
	at: string;
	event: AuditEvent;
	names: string[];
	/** The task that asked (FM_TASK_ID), when there was one. */
	task: string | null;
	/** The project the names were for: the caller's for a run, the one granted or revoked. */
	project: string | null;
	/** A run's program, without its arguments. */
	program?: string;
	outcome?: AuditOutcome;
	/** A run's exit status, or the signal that ended it. */
	exit?: number | null;
	signal?: string | null;
	/** Why it was refused, in plain words. */
	reason?: string;
}

export async function appendAudit(dir: string, entry: AuditEntry): Promise<void> {
	await ensureDir(dir);
	const file = path.join(dir, AUDIT_FILE);
	await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
	await chmod(file, 0o600);
}

/** Throws when the log cannot be written, so a run that could not be logged never starts. */
export async function checkAuditWritable(dir: string): Promise<void> {
	await ensureDir(dir);
	const fh = await open(path.join(dir, AUDIT_FILE), 'a', 0o600);
	await fh.close();
}

export interface AuditQuery {
	project?: string;
	task?: string;
	name?: string;
	event?: AuditEvent;
	/** At most this many, newest first. */
	limit?: number;
}

const isEntry = (v: unknown): v is AuditEntry => {
	if (typeof v !== 'object' || v === null) return false;
	const e = v as Record<string, unknown>;
	return (
		typeof e.at === 'string' &&
		typeof e.event === 'string' &&
		Array.isArray(e.names) &&
		e.names.every((n) => typeof n === 'string')
	);
};

/** Matching entries, newest first; a line that cannot be read is skipped. */
export async function readAudit(dir: string, q: AuditQuery = {}): Promise<AuditEntry[]> {
	let text: string;
	try {
		text = await readFile(path.join(dir, AUDIT_FILE), 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw e;
	}
	const out: AuditEntry[] = [];
	const lines = text.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		if (q.limit !== undefined && out.length >= q.limit) break;
		const line = lines[i].trim();
		if (!line) continue;
		let e: unknown;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isEntry(e)) continue;
		if (q.project !== undefined && e.project !== q.project) continue;
		if (q.task !== undefined && e.task !== q.task) continue;
		if (q.name !== undefined && !e.names.includes(q.name)) continue;
		if (q.event !== undefined && e.event !== q.event) continue;
		out.push({ ...e, task: e.task ?? null, project: e.project ?? null });
	}
	return out;
}

/** When each secret was last handed to a command, from the log. */
export async function lastUsed(dir: string): Promise<Map<string, string>> {
	const used = new Map<string, string>();
	for (const e of await readAudit(dir, { event: 'run' })) {
		if (e.outcome !== 'ok') continue;
		for (const n of e.names) if (!used.has(n)) used.set(n, e.at);
	}
	return used;
}
