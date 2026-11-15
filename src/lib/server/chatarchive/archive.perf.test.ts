import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fold } from '../../chat/fold';
import { homeTranscripts } from '../sessions/transcript';
import { ChatArchive } from './archive';
import { ArchiveSync } from './sync';

/**
 * A performance check over real transcripts, run by hand (it reads, never
 * writes, the transcripts; the archive goes to a temporary directory):
 *
 *   WH_ARCHIVE_PERF_FIRSTMATE=<Firstmate checkout> \
 *   WH_ARCHIVE_PERF_PROJECTS=~/.claude/projects \
 *   npx vitest run --project unit src/lib/server/chatarchive/archive.perf.test.ts
 */
const firstmateDir = process.env.WH_ARCHIVE_PERF_FIRSTMATE;
const projectsDir = process.env.WH_ARCHIVE_PERF_PROJECTS;

describe.skipIf(!firstmateDir || !projectsDir)('chat archive on real transcripts', () => {
	it('backfills, reopens, pages, searches and folds in reasonable time', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'wh-archive-perf-'));
		const ms = (t: number) => Math.round(performance.now() - t);
		const report: Record<string, unknown> = {};
		try {
			let t = performance.now();
			const files = await homeTranscripts({
				firstmateDir: firstmateDir!,
				projectsDir: projectsDir!
			});
			report.discoverMs = ms(t);
			report.transcripts = files.length;
			const a = await ChatArchive.open(dir, firstmateDir!);
			t = performance.now();
			await new ArchiveSync({ archive: a, discover: async () => files }).discover();
			report.backfillMs = ms(t);
			report.stats = a.stats();
			t = performance.now();
			await new ArchiveSync({ archive: a, discover: async () => files }).discover();
			report.secondPassMs = ms(t);
			t = performance.now();
			const b = await ChatArchive.open(dir, firstmateDir!);
			report.reopenMs = ms(t);
			report.heapMB = Math.round(process.memoryUsage().heapUsed / 1e6);
			t = performance.now();
			const newest = await b.page({ limit: 1500 });
			report.pageMs = ms(t);
			report.pageRecords = newest.records.length;
			t = performance.now();
			let before = newest.records[0]?.uuid;
			let pages = 1;
			for (let more = newest.more; more; pages++) {
				const p = await b.page({ before, limit: 1500 });
				before = p.records[0]?.uuid;
				more = p.more;
			}
			report.allPagesMs = ms(t);
			report.pages = pages;
			t = performance.now();
			report.searchHits = b.search('wheelhouse release', 50).length;
			report.searchMs = ms(t);
			t = performance.now();
			report.rareHits = b.search('zzqx-not-there').length;
			report.fullScanSearchMs = ms(t);
			const big = await b.page({ limit: 20_000 });
			t = performance.now();
			const chat = fold(big.records);
			report.fold20kMs = ms(t);
			report.fold20kItems = chat.items.length;
			process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
			expect(b.stats().records).toBe(a.stats().records);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 600_000);
});
