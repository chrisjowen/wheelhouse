import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

/**
 * The ports Wheelhouse has given companion services, kept in its own state
 * directory (never the Firstmate home), so a service keeps its port whichever
 * other projects come and go. A new port is one nothing on this computer
 * listens on yet. A port is released only when its project leaves the fleet.
 */

interface Entry {
	project: string | null;
	port: number;
}

const SCHEMA = 'wheelhouse-service-ports.v1';
const MAX_PORT = 65535;

export class ServicePorts {
	private entries: Record<string, Entry> | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(readonly file: string) {}

	/**
	 * The port stored for `key`, or, the first time, the first port from
	 * `preferred` up that no other key holds, `avoid` does not name and nothing
	 * listens on, stored from then on. `fleet` is every project id now in the fleet.
	 */
	port(
		key: string,
		project: string | null,
		preferred: number,
		avoid: number[],
		fleet: string[]
	): Promise<number> {
		const next = this.queue.then(() => this.allocate(key, project, preferred, avoid, fleet));
		this.queue = next.catch(() => {});
		return next;
	}

	private async allocate(
		key: string,
		project: string | null,
		preferred: number,
		avoid: number[],
		fleet: string[]
	): Promise<number> {
		const entries = this.load();
		const inFleet = new Set(fleet);
		let changed = false;
		for (const [k, e] of Object.entries(entries)) {
			if (e.project !== null && !inFleet.has(e.project)) {
				delete entries[k];
				changed = true;
			}
		}
		const blocked = new Set(avoid);
		const held = entries[key];
		if (!held || blocked.has(held.port)) {
			for (const [k, e] of Object.entries(entries)) if (k !== key) blocked.add(e.port);
			let port = preferred;
			while (port < MAX_PORT && (blocked.has(port) || !(await free(port)))) port++;
			entries[key] = { project, port };
			changed = true;
		}
		if (changed) this.save(entries);
		return entries[key].port;
	}

	private load(): Record<string, Entry> {
		if (this.entries) return this.entries;
		const entries: Record<string, Entry> = {};
		try {
			const raw = JSON.parse(readFileSync(this.file, 'utf8'));
			for (const [k, e] of Object.entries(raw?.ports ?? {})) {
				const { project, port } = (e ?? {}) as Partial<Entry>;
				if (
					Number.isInteger(port) &&
					port! > 1023 &&
					port! <= MAX_PORT &&
					(project === null || typeof project === 'string')
				) {
					entries[k] = { project, port: port! };
				}
			}
		} catch {
			// No file yet, or one Wheelhouse cannot read: start afresh.
		}
		this.entries = entries;
		return entries;
	}

	private save(entries: Record<string, Entry>) {
		mkdirSync(path.dirname(this.file), { recursive: true });
		const tmp = `${this.file}.${process.pid}.tmp`;
		writeFileSync(tmp, JSON.stringify({ schema: SCHEMA, ports: entries }, null, 2) + '\n');
		renameSync(tmp, this.file);
	}
}

/** Whether a port on 127.0.0.1 can be bound now, that is, nothing listens on it. */
function free(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const s = createServer();
		s.once('error', () => resolve(false));
		s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
	});
}
