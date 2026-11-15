import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrewService, type CrewTask } from './service';
import { DiscussionStore } from './store';

let home: string;
let steered: { taskId: string; body: string }[];
let told: { requestId: string; text: string }[];
let steerFails: string | null;
let tasks: CrewTask[];

const inbox = (task: string) => path.join(home, 'state', `${task}.inbox`);

/** fm-send.sh's inbox plane: one record per send, in the next numbered slot. */
async function steer(taskId: string, body: string) {
	steered.push({ taskId, body });
	if (steerFails) return { ok: false as const, error: steerFails };
	mkdirSync(path.join(inbox(taskId), 'handled'), { recursive: true });
	const n = steered.filter((s) => s.taskId === taskId).length;
	writeFileSync(
		path.join(inbox(taskId), `${String(n).padStart(3, '0')}.msg`),
		`schema=fm-task-inbox.v1\nat=2026-11-15T10:00:00Z\nbody-terminator=1\n--\n${body}\n`
	);
	return { ok: true as const };
}

/** The worker reads every record waiting in its inbox. */
function workerReads(task: string) {
	for (const n of readdirSync(inbox(task)).filter((x) => x.endsWith('.msg')))
		renameSync(path.join(inbox(task), n), path.join(inbox(task), 'handled', n));
}

const service = (store = DiscussionStore.memory(home), tell = true) =>
	new CrewService({
		store,
		homeDir: home,
		steer,
		tell: tell
			? async (requestId, text) => {
					told.push({ requestId, text });
					return true;
				}
			: null,
		task: (id) => tasks.find((t) => t.id === id) ?? null,
		now: () => Date.parse('2026-11-15T10:00:00Z'),
		pollMs: 60_000
	});

beforeEach(() => {
	home = mkdtempSync(path.join(tmpdir(), 'wh-crew-'));
	mkdirSync(path.join(home, 'state'));
	steered = [];
	told = [];
	steerFails = null;
	tasks = [
		{ id: 'tide', title: 'atlas: Retry with backoff', projectId: 'atlas', status: 'working' },
		{ id: 'done', title: 'Shipped', projectId: 'atlas', status: 'landed' },
		{
			id: 'far@east',
			title: 'Remote',
			projectId: 'atlas',
			status: 'working',
			secondMate: { id: 'east' }
		}
	];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('crew discussions', () => {
	it('opens only on the captain’s own workers at work, once', async () => {
		const s = service();
		expect(s.view().discussions).toEqual([]);
		const a = await s.open('tide');
		expect(a.ok && a.value.title).toBe('atlas: Retry with backoff');
		await s.open('tide');
		expect(s.view().discussions.map((d) => d.taskId)).toEqual(['tide']);
		expect(await s.open('done')).toMatchObject({ ok: false, status: 409 });
		expect(await s.open('far@east')).toMatchObject({ ok: false, status: 400 });
		expect(await s.open('nope')).toMatchObject({ ok: false, status: 404 });
	});

	it('puts the captain’s words in the worker’s inbox, marked as the captain’s, and tells Firstmate', async () => {
		const s = service();
		await s.open('tide');
		const r = await s.send('tide', 'm1', 'say', '  Use Pagefind.  ');
		expect(r.ok && r.value).toMatchObject({ delivery: 'sent', seen: false, told: 'sent' });
		expect(steered).toHaveLength(1);
		expect(steered[0].taskId).toBe('tide');
		expect(steered[0].body).toMatch(
			/^\[captain-sidebar ref=wh-crew-m1\] From the captain directly/
		);
		expect(steered[0].body.endsWith('\n\nUse Pagefind.')).toBe(true);
		expect(told).toEqual([
			{
				requestId: 'm1.fm',
				text: expect.stringContaining('Crew discussion with tide') as unknown as string
			}
		]);
		expect(told[0].text).toContain('I said: “Use Pagefind.”');
	});

	it('marks a message seen once the worker moves its record to handled/', async () => {
		const s = service();
		await s.open('tide');
		await s.send('tide', 'm1', 'say', 'hello');
		await s.poll();
		expect(s.view().discussions[0].messages[0].seen).toBe(false);
		workerReads('tide');
		await s.poll();
		expect(s.view().discussions[0].messages[0].seen).toBe(true);
		s.stop();
	});

	it('returns a repeat of the same request, and refuses its key for different words', async () => {
		const s = service();
		await s.open('tide');
		await s.send('tide', 'm1', 'say', 'hello');
		expect(await s.send('tide', 'm1', 'say', 'hello')).toMatchObject({ ok: true });
		expect(steered).toHaveLength(1);
		expect(await s.send('tide', 'm1', 'say', 'other')).toMatchObject({ ok: false, status: 409 });
		s.stop();
	});

	it('says why a send failed, and sends it again without a second copy once it landed', async () => {
		const s = service();
		await s.open('tide');
		steerFails = 'fm-send.sh exited 1: no metadata for tide';
		const r = await s.send('tide', 'm1', 'say', 'hello');
		expect(r.ok && r.value).toMatchObject({
			delivery: 'failed',
			error: steerFails,
			told: 'sending'
		});
		expect(told).toEqual([]);
		steerFails = null;
		expect(await s.send('tide', 'm1', 'say', 'hello')).toMatchObject({
			ok: true,
			value: { delivery: 'sent' }
		});
		expect(steered).toHaveLength(2);
		// A send that landed although Wheelhouse never heard back is found, not sent twice.
		const d = s.view().discussions[0];
		expect(d.messages).toHaveLength(1);
		const reloaded = DiscussionStore.memory(home);
		reloaded.add({ ...d, messages: [{ ...d.messages[0], delivery: 'failed' }] });
		const again = service(reloaded);
		expect(await again.send('tide', 'm1', 'say', 'hello')).toMatchObject({
			ok: true,
			value: { delivery: 'sent' }
		});
		expect(steered).toHaveLength(2);
		s.stop();
		again.stop();
	});

	it('pauses and resumes with canned words, and says so', async () => {
		const s = service();
		await s.open('tide');
		await s.send('tide', 'p1', 'pause', '');
		expect(s.view().discussions[0].paused).toBe(true);
		expect(steered[0].body).toContain('Please pause: finish the step you are on');
		await s.send('tide', 'p2', 'resume', '');
		expect(s.view().discussions[0].paused).toBe(false);
		s.stop();
	});

	it('refuses an empty message, an unknown kind and a discussion that has ended', async () => {
		const s = service();
		await s.open('tide');
		expect(await s.send('tide', 'm1', 'say', '  ')).toMatchObject({ ok: false, status: 400 });
		expect(await s.send('tide', 'm1', 'shout', 'hi')).toMatchObject({ ok: false, status: 400 });
		expect(await s.send('tide', null, 'say', 'hi')).toMatchObject({ ok: false, status: 400 });
		expect(await s.send('tide', 'm1', 'say', 'x'.repeat(9000))).toMatchObject({ status: 413 });
		expect(await s.send('other', 'm1', 'say', 'hi')).toMatchObject({ ok: false, status: 404 });
		expect(steered).toEqual([]);
	});

	it('refuses, before recording it, a message whose inbox record would be too many bytes', async () => {
		const s = service();
		await s.open('tide');
		const wide = '界'.repeat(6000);
		expect(wide.length).toBeLessThanOrEqual(8000);
		expect(await s.send('tide', 'm1', 'say', wide)).toMatchObject({ ok: false, status: 413 });
		expect(steered).toEqual([]);
		expect(s.view().discussions[0].messages).toEqual([]);
		expect(await s.send('tide', 'm2', 'say', '界'.repeat(5000))).toMatchObject({ ok: true });
		s.stop();
	});

	it('ends a discussion, telling Firstmate only when something was said', async () => {
		const s = service();
		await s.open('tide');
		await s.close('tide');
		expect(told).toEqual([]);
		await s.open('tide');
		await s.send('tide', 'm1', 'say', 'hello');
		await s.close('tide');
		expect(s.view().discussions).toEqual([]);
		expect(told.at(-1)!.text).toContain('ended my direct discussion');
		expect(await s.close('tide')).toEqual({ ok: true, value: null });
		expect(told.at(-1)!.text).not.toMatch(/resume/);
		s.stop();
	});

	it('asks Firstmate to resume a worker left paused when the discussion ends', async () => {
		const s = service();
		await s.open('tide');
		await s.send('tide', 'p1', 'pause', '');
		await s.close('tide');
		expect(told.at(-1)!.text).toContain('ended my direct discussion');
		expect(told.at(-1)!.text).toMatch(/still waiting .*please tell it to resume/);
		await s.open('tide');
		await s.send('tide', 'p2', 'pause', '');
		await s.send('tide', 'p3', 'resume', '');
		await s.close('tide');
		expect(told.at(-1)!.text).not.toMatch(/still waiting/);
		s.stop();
	});

	it('tells Firstmate of a paused worker even when no message of the discussion was sent', async () => {
		const store = DiscussionStore.memory(home);
		const s = service(store);
		await s.open('tide');
		store.get('tide')!.paused = true;
		await s.close('tide');
		expect(told).toHaveLength(1);
		expect(told[0].text).toMatch(/please tell it to resume/);
		s.stop();
	});

	it('marks Firstmate’s note off when messaging is not set up', async () => {
		const s = service(DiscussionStore.memory(home), false);
		await s.open('tide');
		const r = await s.send('tide', 'm1', 'say', 'hello');
		expect(r.ok && r.value.told).toBe('off');
		s.stop();
	});

	it('keeps open discussions across a restart, in Wheelhouse’s own state directory', async () => {
		const file = path.join(home, 'wh-state', 'crew-discussions.json');
		const s = service(await DiscussionStore.open(file, home));
		await s.open('tide');
		await s.send('tide', 'm1', 'say', 'hello');
		s.stop();
		const back = service(await DiscussionStore.open(file, home));
		expect(back.view().discussions[0]).toMatchObject({
			taskId: 'tide',
			messages: [{ id: 'm1', delivery: 'sent', text: 'hello' }]
		});
		expect(back.view().reason).toBeNull();
		expect(service().view().reason).toMatch(/only until Wheelhouse restarts/);
		back.stop();
	});

	it('emits the view when it changes', async () => {
		const s = service();
		const seen: number[] = [];
		s.subscribe((v) => seen.push(v.discussions.length));
		await s.open('tide');
		await s.close('tide');
		expect(seen).toEqual([1, 0]);
	});
});
