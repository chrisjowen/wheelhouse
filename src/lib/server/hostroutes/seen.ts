import { LOOPBACK_HOSTS } from '../../cloud';
import { loopbackAddresses } from '../../plugins/addresses';
import { PREVIEW_HOSTS } from '../../preview';

/**
 * The http(s) addresses on 127.0.0.1 or localhost Wheelhouse has shown since
 * it started: in what its pages show (task previews and status notes, decision
 * cards, Firstmate's replies, the Documents pages' prototypes). Plugins read
 * them as `ctx.loopbackAddresses()`, such as a proxy that opens only the ports
 * the crew has reported, and Wheelhouse Cloud relays to their ports (with those
 * of addresses on [::1] and 0.0.0.0) so a page that came through it can open
 * every one of them (`ports`, server/runtime.ts currentPreviewPorts). The sources
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

	/** The addresses on 127.0.0.1 or localhost. */
	async list(): Promise<string[]> {
		if (this.now() - this.scannedAt >= RESCAN_MS) await this.scan();
		return [...this.seen].filter((a) => PREVIEW_HOSTS.has(new URL(a).hostname.toLowerCase()));
	}

	/** The port of every address on this computer it has seen, [::1] and 0.0.0.0 included. */
	async ports(): Promise<number[]> {
		if (this.now() - this.scannedAt >= RESCAN_MS) await this.scan();
		const ports = new Set<number>();
		for (const a of this.seen) {
			const u = new URL(a);
			ports.add(Number(u.port || (u.protocol === 'https:' ? 443 : 80)));
		}
		return [...ports];
	}

	private scan(): Promise<void> {
		this.scanning ??= (async () => {
			try {
				const texts: string[] = [];
				for (const source of await this.opts.sources()) collect(source, texts, 0);
				for (const text of texts) {
					for (const address of loopbackAddresses(text, LOOPBACK_HOSTS)) {
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
