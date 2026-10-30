import { reportedPorts } from '../../localproxy';

/**
 * The ports on this computer the crew has reported since Wheelhouse started:
 * those in any http address on 127.0.0.1 or localhost that Wheelhouse shows
 * (task previews and status notes, decision cards, Firstmate's replies). The
 * localhost proxy opens these by default. A port is looked for in the
 * sources only when it is not known yet, at most every couple of seconds, and
 * stays known until Wheelhouse restarts.
 */

const RESCAN_MS = 2_000;
/** How deep into a source's objects to look for text. */
const MAX_DEPTH = 12;

export interface ReportedPortsOptions {
	/** What Wheelhouse shows: the fleet, the decision inbox, the chat's records. */
	sources: () => Promise<unknown[]>;
	now?: () => number;
}

export class ReportedPorts {
	private readonly seen = new Set<number>();
	private scannedAt = -Infinity;
	private scanning: Promise<void> | null = null;
	private readonly now: () => number;

	constructor(private readonly opts: ReportedPortsOptions) {
		this.now = opts.now ?? Date.now;
	}

	async has(port: number): Promise<boolean> {
		if (this.seen.has(port)) return true;
		if (this.now() - this.scannedAt >= RESCAN_MS) await this.scan();
		return this.seen.has(port);
	}

	private scan(): Promise<void> {
		this.scanning ??= (async () => {
			try {
				const texts: string[] = [];
				for (const source of await this.opts.sources()) collect(source, texts, 0);
				for (const text of texts) for (const port of reportedPorts(text)) this.seen.add(port);
			} catch {
				// a source that cannot be read reports nothing this time
			} finally {
				this.scannedAt = this.now();
				this.scanning = null;
			}
		})();
		return this.scanning;
	}
}

/** Every string in `value` that could hold an address. */
function collect(value: unknown, out: string[], depth: number): void {
	if (typeof value === 'string') {
		if (value.includes('://')) out.push(value);
		return;
	}
	if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return;
	for (const v of Array.isArray(value) ? value : Object.values(value)) collect(v, out, depth + 1);
}
