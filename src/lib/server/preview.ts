import { frameRefusal, loopbackPreview, type PreviewCheck } from '../preview';
import type { TaskSummary } from '../types';

/**
 * Whether a task's reported preview can be shown embedded: it must be a
 * loopback URL (see lib/preview.ts), answer an HTTP request, and not refuse
 * framing. A URL that is not loopback is never fetched. Each URL is checked at
 * most every few seconds however many pages ask.
 */

const TTL_MS = 5_000;
const TIMEOUT_MS = 2_000;

type Probe = Pick<PreviewCheck, 'state' | 'reason'>;

export interface PreviewProberOptions {
	fetch?: typeof fetch;
	now?: () => number;
	timeoutMs?: number;
}

export class PreviewProber {
	private fetch: typeof fetch;
	private now: () => number;
	private timeoutMs: number;
	private cache = new Map<string, { at: number; value: Promise<Probe> }>();

	constructor(opts: PreviewProberOptions = {}) {
		this.fetch = opts.fetch ?? fetch;
		this.now = opts.now ?? Date.now;
		this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
	}

	async check(preview: TaskSummary['preview']): Promise<PreviewCheck> {
		const checkedAt = new Date(this.now()).toISOString();
		if (!preview) {
			return {
				url: null,
				reportedAt: null,
				state: 'none',
				reason: 'The worker has not reported a preview.',
				checkedAt
			};
		}
		const base = { url: preview.url, reportedAt: preview.reportedAt, checkedAt };
		const target = loopbackPreview(preview.url);
		if (!target.ok) return { ...base, state: 'refused', reason: target.reason };
		return { ...base, ...(await this.probe(target.url)) };
	}

	private probe(url: string): Promise<Probe> {
		const hit = this.cache.get(url);
		if (hit && this.now() - hit.at < TTL_MS) return hit.value;
		const value = this.load(url);
		this.cache.set(url, { at: this.now(), value });
		if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!);
		return value;
	}

	private async load(url: string): Promise<Probe> {
		try {
			// Any HTTP answer means the preview is running; a redirect is not followed.
			const res = await this.fetch(url, {
				method: 'GET',
				redirect: 'manual',
				signal: AbortSignal.timeout(this.timeoutMs)
			});
			void res.body?.cancel().catch(() => {});
			const refusal = frameRefusal(res.headers);
			return refusal ? { state: 'blocked', reason: refusal } : { state: 'live', reason: null };
		} catch {
			return { state: 'down', reason: 'Preview not running: nothing answered at this address.' };
		}
	}
}

const KEY = Symbol.for('wheelhouse.preview-prober');
const g = globalThis as unknown as Record<symbol, PreviewProber | undefined>;

/** The server's one prober (stable across module reloads). */
export function previewProber(): PreviewProber {
	g[KEY] ??= new PreviewProber();
	return g[KEY];
}
