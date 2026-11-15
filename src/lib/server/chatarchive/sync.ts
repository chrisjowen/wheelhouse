import type { ArchiveHook } from '../sessions/transcript';
import { sessionKey, type ChatArchive } from './archive';

/** How often the home's transcripts are looked for again. */
export const DISCOVER_MS = 5 * 60_000;

export interface ArchiveSyncOptions {
	archive: ChatArchive;
	/** This home's Claude Code transcripts (sessions/transcript.ts homeTranscripts). */
	discover: () => Promise<string[]>;
	discoverMs?: number;
	log?: (message: string) => void;
}

/**
 * Keeps the chat archive up with Firstmate's sessions: the session the chat
 * follows, as the chat feed hands it over (`hook`, for every harness), and
 * every Claude Code transcript of the home, read when Wheelhouse starts (the
 * backfill, and whatever was written while Wheelhouse was not running) and
 * every few minutes after. Each file is read from where it was left, so a
 * pass over files that have not grown reads nothing. A failure is logged once
 * until the archive works again; the next pass tries again.
 */
export class ArchiveSync {
	private timer: ReturnType<typeof setInterval> | null = null;
	private running: Promise<void> | null = null;
	private failing = false;

	constructor(private opts: ArchiveSyncOptions) {}

	/** What the chat feed hands the archive (ChatFeedOptions.archive). */
	readonly hook: ArchiveHook = {
		key: sessionKey,
		file: (file, harness, decode) =>
			void this.guard(this.opts.archive.ingestFile(file, harness, decode)),
		records: (file, harness, records) =>
			void this.guard(this.opts.archive.ingestRecords(file, harness, records))
	};

	start(): void {
		if (this.timer) return;
		void this.discover();
		this.timer = setInterval(() => void this.discover(), this.opts.discoverMs ?? DISCOVER_MS);
		this.timer.unref?.();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/** Reads every transcript of the home that grew; one pass at a time. */
	discover(): Promise<void> {
		this.running ??= (async () => {
			try {
				const files = await this.opts.discover();
				for (const file of files) await this.guard(this.opts.archive.ingestFile(file, 'claude'));
				// Pruning often writes nothing, so it never says the archive works again.
				await this.guard(this.opts.archive.prune(), false);
			} finally {
				this.running = null;
			}
		})();
		return this.running;
	}

	private async guard(p: Promise<unknown>, clears = true): Promise<void> {
		try {
			await p;
			if (clears) this.failing = false;
		} catch (e) {
			if (!this.failing)
				(this.opts.log ?? console.warn)(
					`Chat archive: could not save the conversation (${e instanceof Error ? e.message : String(e)}); trying again.`
				);
			this.failing = true;
		}
	}
}
