import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptAdapter, NOTE_MAX_BYTES, REMOTE_UNREACHABLE } from './adapter';
import {
	createFakeFirstmate,
	snapshotFixture,
	taskRow,
	type FakeFirstmate
} from '../../../../tests/helpers/fake-firstmate';

let fm: FakeFirstmate;
const adapter = (opts = {}) =>
	createScriptAdapter({ firstmateDir: fm.root, homeDir: fm.root }, opts);
const calls = () => readFileSync(path.join(fm.root, 'calls.log'), 'utf8').trim().split('\n');

beforeEach(() => {
	fm = createFakeFirstmate();
});
afterEach(() => fm.cleanup());

describe('snapshot', () => {
	it('runs fm-fleet-snapshot.sh --json with FM_HOME and parses the contract', async () => {
		fm.set('snapshot.json', snapshotFixture({ tasks: [taskRow({ id: 'a-1' })] }, fm.root));
		const r = await adapter().snapshot();
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.tasks.map((t) => t.id)).toEqual(['a-1']);
		expect(r.value.tasks[0].current?.state).toBe('working');
		expect(calls()).toEqual([`fm-fleet-snapshot.sh [--json] FM_HOME=${fm.root}`]);
	});

	it('reports malformed output without throwing', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'malformed');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatchObject({ kind: 'malformed', script: 'fm-fleet-snapshot.sh' });
	});

	it('rejects an unknown schema', async () => {
		fm.set('snapshot.json', { ...snapshotFixture(), schema: 'fm-fleet-snapshot.v2' });
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toContain('fm-fleet-snapshot.v2');
	});

	it('reports a failing script with its stderr', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'fail');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.kind).toBe('exit');
			expect(r.error.message).toContain('something broke');
		}
	});

	it('times out a hung script and kills it', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'sleep');
		const started = Date.now();
		const r = await adapter({ snapshotTimeoutMs: 300 }).snapshot();
		expect(Date.now() - started).toBeLessThan(5000);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('timeout');
	});

	it('bounds output size', async () => {
		fm.mode('fm-fleet-snapshot.sh', 'huge');
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('output-limit');
	});

	it('reports a missing script', async () => {
		fm.set('bin/fm-fleet-snapshot.sh', '');
		const { rmSync } = await import('node:fs');
		rmSync(path.join(fm.root, 'bin', 'fm-fleet-snapshot.sh'));
		const r = await adapter().snapshot();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('missing-script');
	});
});

describe('ready', () => {
	it('parses fm-primary-ready.v1', async () => {
		const r = await adapter().ready();
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.canReceive).toBe(true);
			expect(r.value.wakeConsumer.state).toBe('healthy');
		}
		expect(calls()[0]).toMatch(/^fm-inbox\.sh \[ready\]/);
	});

	it('keeps an unknown can_receive as unknown', async () => {
		fm.set('ready.json', {
			schema: 'fm-primary-ready.v1',
			lock: { state: 'free' },
			wake_consumer: { state: 'unknown' },
			can_receive: 'unknown'
		});
		const r = await adapter().ready();
		expect(r.ok && r.value.canReceive).toBe('unknown');
	});
});

describe('peek', () => {
	it('passes the task id and a clamped line count as separate arguments', async () => {
		await adapter().peek('wh-crew-1', 9999);
		expect(calls()[0]).toMatch(/^fm-peek\.sh \[wh-crew-1\] \[200\]/);
	});

	it('never passes an id that is not a plain task id', async () => {
		for (const bad of ['a;rm -rf /', '-n', '../x', 'a b', '$(id)']) {
			const r = await adapter().peek(bad, 10);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.kind).toBe('invalid-argument');
		}
		expect(() => calls()).toThrow();
	});

	it('strips terminal escapes and keeps only the requested tail', async () => {
		fm.set('peek.txt', 'one\n\u001b[31mtwo\u001b[0m\nthree\u0007\n\n\n');
		const r = await adapter().peek('t-1', 2);
		expect(r.ok && r.value.lines).toEqual(['two', 'three']);
	});
});

describe('the scripts’ environment', () => {
	it('gives a script started from a bare environment what a remote read needs', async () => {
		writeFileSync(
			path.join(fm.root, 'bin', 'fm-peek.sh'),
			'#!/bin/sh\n# Usage: fm-peek.sh <target> [lines=40]\necho "HOME=$HOME USER=$USER BUDGET=$FM_SNAPSHOT_BUDGET FM_HOME=$FM_HOME"\n'
		);
		chmodSync(path.join(fm.root, 'bin', 'fm-peek.sh'), 0o755);
		const r = await adapter({ env: { PATH: '/usr/bin:/bin' } }).peek('t-1', 5);
		expect(r.ok).toBe(true);
		const line = r.ok ? r.value.lines[0] : '';
		expect(line).toMatch(/^HOME=\/\S+ USER=\S+ BUDGET=20 FM_HOME=/);
		expect(line).toContain(`FM_HOME=${fm.root}`);
	});
});

describe('remotePeek', () => {
	it('captures a remote second mate on its host through fm-on.sh, read-only and clamped', async () => {
		fm.set('remote-peek.txt', 'a\nb\nc\n');
		const r = await adapter().remotePeek('tokyo', 9999);
		expect(r.ok && r.value).toEqual({ lines: ['a', 'b', 'c'], requested: 100 });
		expect(calls()).toEqual([
			`fm-on.sh [tokyo] [fm-remote-secondmate-control.sh] [capture] [tokyo] [100] FM_HOME=${fm.root}`
		]);
	});

	it('reports an unreachable host as fm-on.sh exit 255, once', async () => {
		fm.mode('fm-on.sh', 'unreachable');
		const r = await adapter().remotePeek('tokyo', 40);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatchObject({ kind: 'exit', exitCode: REMOTE_UNREACHABLE });
		expect(calls()).toHaveLength(1);
	});

	it('never passes an id that is not a plain id', async () => {
		const r = await adapter().remotePeek('-oProxyCommand=x', 10);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('invalid-argument');
		expect(() => calls()).toThrow();
	});
});

describe('second mates’ tasks', () => {
	it('reads a file in a remote home through fm-on.sh, path-confined and bounded', async () => {
		fm.set('fm-on/fm-remote-file.sh', 'working: on it\n');
		const r = await adapter().remoteFile('tokyo', 'state/tk-1.status', 4096);
		expect(r.ok && r.value).toBe('working: on it\n');
		expect(calls()).toEqual([
			`fm-on.sh [tokyo] [fm-remote-file.sh] [get] [state/tk-1.status] [4096] FM_HOME=${fm.root}`
		]);
		for (const bad of ['../x', '/etc/passwd', 'state/../../x', '.hidden']) {
			const b = await adapter().remoteFile('tokyo', bad, 10);
			expect(b.ok).toBe(false);
		}
	});

	it('peeks at a remote task on its host, and a local one in its own home', async () => {
		fm.set('remote-peek.txt', 'remote\n');
		const r = await adapter().matePeekTask({ id: 'tokyo', remote: true }, 'tk-1', 30);
		expect(r.ok && r.value.lines).toEqual(['remote']);
		const home = path.join(fm.root, 'homes', 'osaka');
		mkdirSync(home, { recursive: true });
		const l = await adapter().matePeekTask({ id: 'osaka', remote: false, home }, 'os-1', 30);
		expect(l.ok && l.value.lines).toEqual(['line one']);
		expect(calls()).toEqual([
			`fm-on.sh [tokyo] [fm-peek.sh] [tk-1] [30] FM_HOME=${fm.root}`,
			`fm-peek.sh [os-1] [30] FM_HOME=${home}`
		]);
	});

	it('hands a remote second mate a note through fm-on.sh --stdin, into its own inbox', async () => {
		fm.set('fm-on/fm-inbox.sh', {
			schema: 'fm-inbox-note.v1',
			outcome: 'created',
			id: 'n1',
			request_id: 'wh-1',
			saved: true,
			announced: true,
			acknowledged: false
		});
		const r = await adapter().mateNote({ id: 'tokyo', remote: true }, 'wh-1', 'Re: tk-1\nhello');
		expect(r.ok && r.value.outcome).toBe('created');
		expect(calls()).toEqual([
			`fm-on.sh [--stdin] [tokyo] [fm-inbox.sh] [note] [--request-id] [wh-1] [--json] [-] FM_HOME=${fm.root}`
		]);
		expect(readFileSync(path.join(fm.root, 'fm-on.stdin.log'), 'utf8')).toBe('Re: tk-1\nhello');
	});

	it('hands a local second mate a note in its own home', async () => {
		const home = path.join(fm.root, 'homes', 'osaka');
		mkdirSync(home, { recursive: true });
		const r = await adapter().mateNote(
			{ id: 'osaka', remote: false, home },
			'wh-2',
			'Re: os-1\nhi'
		);
		expect(r.ok).toBe(true);
		// In its home's inbox, not the captain's Firstmate's.
		expect(fm.notes()).toEqual([]);
		expect(existsSync(path.join(home, 'state', 'inbox'))).toBe(true);
		expect(calls()).toEqual([
			`fm-inbox.sh [note] [--request-id] [wh-2] [--json] [-] FM_HOME=${home}`
		]);
	});

	it('reports an unreachable host as exit 255', async () => {
		fm.mode('fm-on.sh', 'unreachable');
		const r = await adapter().mateNote({ id: 'tokyo', remote: true }, 'wh-3', 'x');
		expect(!r.ok && r.error.exitCode).toBe(REMOTE_UNREACHABLE);
	});
});

describe('tmux server', () => {
	const WH = '/private/tmp/tmux-501/wheelhouse,9229,3';
	// A peek script that prints the TMUX and TMUX_PANE it was given.
	const tmuxPeek = () => {
		fm.set(
			'bin/fm-peek.sh',
			'#!/usr/bin/env bash\necho "TMUX=${TMUX-unset} PANE=${TMUX_PANE-unset}"\n'
		);
		chmodSync(path.join(fm.root, 'bin', 'fm-peek.sh'), 0o755);
	};
	const seen = async (env: NodeJS.ProcessEnv, tmux: string | null) => {
		const r = await adapter({ env, tmux: async () => tmux }).peek('t-1', 5);
		return r.ok ? r.value.lines.join('') : r.error.message;
	};

	it('points scripts at the session server when Wheelhouse has no TMUX of its own', async () => {
		tmuxPeek();
		expect(await seen({ PATH: process.env.PATH }, WH)).toBe(`TMUX=${WH} PANE=unset`);
	});

	it("replaces a TMUX from another server, and that server's pane", async () => {
		tmuxPeek();
		const env = { PATH: process.env.PATH, TMUX: '/tmp/tmux-501/default,1,0', TMUX_PANE: '%4' };
		expect(await seen(env, WH)).toBe(`TMUX=${WH} PANE=unset`);
	});

	it('keeps a TMUX that already points at the session server', async () => {
		tmuxPeek();
		const env = {
			PATH: process.env.PATH,
			TMUX: '/private/tmp/tmux-501/wheelhouse,9229,0',
			TMUX_PANE: '%1'
		};
		expect(await seen(env, WH)).toBe('TMUX=/private/tmp/tmux-501/wheelhouse,9229,0 PANE=%1');
	});

	it('leaves the environment alone when the session is not on a tmux server', async () => {
		tmuxPeek();
		expect(await seen({ PATH: process.env.PATH }, null)).toBe('TMUX=unset PANE=unset');
		const env = { PATH: process.env.PATH, TMUX: '/tmp/tmux-501/default,1,0' };
		expect(await seen(env, null)).toBe('TMUX=/tmp/tmux-501/default,1,0 PANE=unset');
	});

	it('runs the script with the ambient environment when tmux cannot answer', async () => {
		tmuxPeek();
		const r = await adapter({
			env: { PATH: process.env.PATH },
			tmux: () => Promise.reject(new Error('tmux broke'))
		}).peek('t-1', 5);
		expect(r.ok && r.value.lines).toEqual(['TMUX=unset PANE=unset']);
	});
});

describe('note', () => {
	const stdinLog = () =>
		readFileSync(path.join(fm.root, 'note-stdin.log'), 'utf8')
			.trim()
			.split('\n')
			.map((l) => JSON.parse(l) as string);

	it('passes the request id as its own argument and the body only on stdin', async () => {
		const body = '--json $(id); rm -rf / `whoami`\nsecond line';
		const r = await adapter().note('wh-req-1', body);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value).toMatchObject({ outcome: 'created', requestId: 'wh-req-1', announced: true });
		expect(calls()).toEqual([
			`fm-inbox.sh [note] [--request-id] [wh-req-1] [--json] [-] FM_HOME=${fm.root}`
		]);
		expect(stdinLog()).toEqual([body]);
		expect(fm.notes().map((n) => n.body)).toEqual([body]);
	});

	it('replays the original note for a repeated request id', async () => {
		const a = await adapter().note('wh-req-2', 'first');
		const b = await adapter().note('wh-req-2', 'first');
		expect(a.ok && b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(b.value).toMatchObject({ outcome: 'replay', noteId: a.value.noteId });
		expect(fm.notes()).toHaveLength(1);
	});

	it('treats exit 3 as saved but not announced', async () => {
		fm.noteMode('unannounced');
		const r = await adapter().note('wh-req-3', 'hello');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toMatchObject({ saved: true, announced: false });
		expect(fm.notes()).toHaveLength(1);
	});

	it('reports exit 1 as a refusal with nothing saved', async () => {
		fm.noteMode('fail');
		const r = await adapter().note('wh-req-4', 'hello');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toMatchObject({ kind: 'exit', exitCode: 1 });
			expect(r.error.message).toContain('could not queue the note');
		}
		expect(fm.notes()).toHaveLength(0);
	});

	it('times out a hung note as a timeout, not a refusal', async () => {
		fm.noteMode('sleep');
		const r = await adapter({ noteTimeoutMs: 300 }).note('wh-req-5', 'hello');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('timeout');
	});

	it('reports unreadable output as malformed', async () => {
		fm.noteMode('malformed');
		const r = await adapter().note('wh-req-6', 'hello');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe('malformed');
	});

	it('never runs the script for a bad request id, an empty body or an oversized one', async () => {
		for (const [id, body] of [
			['', 'x'],
			['.hidden', 'x'],
			['a b', 'x'],
			['a/b', 'x'],
			['x'.repeat(129), 'x'],
			['ok-id', '   \n'],
			['ok-id', 'x'.repeat(NOTE_MAX_BYTES + 1)]
		]) {
			const r = await adapter().note(id, body);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.kind).toBe('invalid-argument');
		}
		expect(() => calls()).toThrow();
	});
});

describe('receipts', () => {
	it('parses fm-inbox-receipts.v1 and passes the cursor and bounds as arguments', async () => {
		const sent = await adapter().note('wh-r-1', 'hi');
		expect(sent.ok).toBe(true);
		if (!sent.ok) return;
		fm.ack(sent.value.noteId);
		fm.reply(sent.value.noteId, 'Aye.');
		const r = await adapter().receipts({ after: '000000000000', allNotes: true });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.pending).toEqual([]);
		expect(r.value.handled[0]).toMatchObject({
			requestId: 'wh-r-1',
			acknowledged: true,
			reply: { body: 'Aye.', cursor: '000000000001' }
		});
		expect(r.value.replies.map((x) => x.body)).toEqual(['Aye.']);
		expect(r.value.replyCursor).toBe('000000000001');
		expect(calls().at(-1)).toBe(
			`fm-inbox.sh [receipts] [--after] [000000000000] [--all-pending] [--all-handled] FM_HOME=${fm.root}`
		);
	});

	it('drops a cursor that is not a plain sequence', async () => {
		await adapter().receipts({ after: '--all-replies' });
		expect(calls()).toEqual([`fm-inbox.sh [receipts] FM_HOME=${fm.root}`]);
	});

	it('rejects an unknown receipts schema', async () => {
		fm.set('bin/fm-inbox.sh', '#!/bin/sh\necho \'{"schema":"fm-inbox-receipts.v2"}\'\n');
		const r = await adapter().receipts();
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatchObject({ kind: 'malformed' });
	});
});
