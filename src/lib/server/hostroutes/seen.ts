import { loopbackAddresses } from '../../plugins/addresses';

/**
 * The http(s) addresses on 127.0.0.1 or localhost Wheelhouse has shown since
 * it started: in what its pages show (task previews and status notes, decision
 * cards, Firstmate's replies). Plugins read them as `ctx.loopbackAddresses()`,
 * such as a proxy that opens only the ports the crew has reported. The sources
 * are looked through at most every couple of seconds; an address stays known
 * until Wheelhouse restarts, the oldest going first past a bound.
 */

const RESCAN_MS = 2_000;
const MAX_ADDRESSES = 2_000;
/** How deep into a source's objects to look for text. */
const MAX_DEPTH = 12;

export interface SeenAddressesOptions {
	/** What Wheelhouse shows: the fleet, the decision inbox, the chat's records. */
	sources: () => Promise<unknown[]>;
	now?: () => number;
}

export class SeenAddresses {
	private readonly seen = new Set<string>();
	private scannedAt = -Infinity;
	private scanning: Promise<void> | null = null;
	private readonly now: () => number;

	constructor(private readonly opts: SeenAddressesOptions) {
		this.now = opts.now ?? Date.now;
	}

	async list(): Promise<string[]> {
		if (this.now() - this.scannedAt >= RESCAN_MS) await this.scan();
		return [...this.seen];
	}

	private scan(): Promise<void> {
		this.scanning ??= (async () => {
			try {
				const texts: string[] = [];
				for (const source of await this.opts.sources()) collect(source, texts, 0);
				for (const text of texts) {
					for (const address of loopbackAddresses(text)) {
						this.seen.delete(address);
						this.seen.add(address);
					}
				}
				for (const old of this.seen) {
					if (this.seen.size <= MAX_ADDRESSES) break;
					this.seen.delete(old);
				}
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
