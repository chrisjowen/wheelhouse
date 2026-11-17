import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '$lib/types';
import { findScouts } from './scouts';

const task = (id: string, statusLabel = 'Working') =>
	({ id, title: `wh: ${id}`, shortTitle: id, status: 'working', statusLabel }) as TaskSummary;

async function home(files: Record<string, string>) {
	const dir = await mkdtemp(path.join(tmpdir(), 'wh-scouts-'));
	for (const [name, text] of Object.entries(files)) {
		await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
		await writeFile(path.join(dir, name), text);
	}
	return dir;
}

describe('findScouts', () => {
	it('finds a scout by the id asked for, then its report', async () => {
		const dir = await home({});
		const tasks = [task('live-scout-a1b2c3')];
		expect(await findScouts(dir, tasks, [{ ref: 'a1b2c3', since: 0 }])).toEqual({
			a1b2c3: {
				task: 'live-scout-a1b2c3',
				title: 'live-scout-a1b2c3',
				statusLabel: 'Working',
				status: 'working',
				report: null
			}
		});
		await mkdir(path.join(dir, 'data', 'live-scout-a1b2c3'), { recursive: true });
		await writeFile(
			path.join(dir, 'data', 'live-scout-a1b2c3', 'report.md'),
			'# R\n\n## Summary\n\nIt is the cache.\n'
		);
		const found = await findScouts(dir, tasks, [{ ref: 'a1b2c3', since: 0 }]);
		expect(found.a1b2c3?.report).toEqual({
			summary: 'It is the cache.',
			text: '# R\n\n## Summary\n\nIt is the cache.'
		});
	});

	it('finds one by the ref in a brief written since the request, and nothing else', async () => {
		const dir = await home({
			'data/ci-speed/brief.md': 'Scout\nLive scout ref: a1b2c3\n',
			'data/old-one/brief.md': 'Live scout ref: d4e5f6\n'
		});
		const old = new Date(Date.now() - 60 * 60_000);
		await utimes(path.join(dir, 'data/old-one/brief.md'), old, old);
		const tasks = [task('ci-speed'), task('old-one'), task('x@mate')];
		const found = await findScouts(dir, tasks, [
			{ ref: 'a1b2c3', since: Date.now() - 1000 },
			{ ref: 'd4e5f6', since: Date.now() - 1000 },
			{ ref: '../etc', since: 0 }
		]);
		expect(found.a1b2c3?.task).toBe('ci-speed');
		expect(found.d4e5f6).toBeNull();
		expect('../etc' in found).toBe(false);
	});
});
