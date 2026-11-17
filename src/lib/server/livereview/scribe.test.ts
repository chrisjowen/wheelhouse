import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveSession } from './scribe';

describe('saveSession', () => {
	let dir = '';
	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	it('keeps the session and its screenshots in a folder of their own, skipping anything not an image', async () => {
		dir = await mkdtemp(path.join(tmpdir(), 'wh-live-review-'));
		const saved = await saveSession(
			'wh-task@tokyo/../x',
			{ events: [{ id: 'e1' }] },
			{ s1: 'data:image/jpeg;base64,/9j/AA==', s2: 'data:text/html;base64,PGI+' },
			{ WHEELHOUSE_STATE_DIR: dir },
			new Date('2026-11-17T12:30:00Z')
		);
		expect(saved.dir).toBe(path.join(dir, 'live-review', '2026-11-17T12-30-00-wh-task-tokyo-..-x'));
		expect(Object.keys(saved.shots)).toEqual(['s1']);
		expect(await readdir(path.join(saved.dir, 'shots'))).toEqual(['s1.jpg']);
		expect(JSON.parse(await readFile(saved.session, 'utf8'))).toEqual({ events: [{ id: 'e1' }] });
	});
});
