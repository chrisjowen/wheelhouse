import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A throwaway Firstmate install for tests: bin/ scripts that honour the real
 * script contracts' headers and print whatever the test puts in control files.
 *
 * Control files (in the install root):
 *   snapshot.json / ready.json   output to print
 *   <script>.mode                 ok | malformed | fail | sleep | huge
 *   peek.txt                      fm-peek.sh output
 *   calls.log                     every script appends "<name> <args…> FM_HOME=<home>"
 *
 * fm-inbox.sh is a working stand-in for the inbox contract (note --request-id
 * replay, receipts with bounds and a reply cursor, ready), keeping its records
 * under $FM_HOME/state/inbox. `fm-inbox.sh.mode` applies to `ready`;
 *   note.mode       ok | unannounced (exit 3) | fail (exit 1, nothing saved)
 *                   | sleep (nothing saved) | save-then-sleep | malformed
 *   receipts.mode   ok | fail | malformed
 *   receipts.bound  pending/handled/replies bound (default 20)
 *   note-stdin.log  every body note read from stdin, JSON-encoded, one per line
 */

const SCRIPTS: Record<string, { header: string; out: string }> = {
	'fm-fleet-snapshot.sh': {
		header: '# fm-fleet-snapshot.sh - fake. Output contract: `--json` prints fm-fleet-snapshot.v1.',
		out: 'snapshot.json'
	},
	'fm-peek.sh': {
		header: '# Usage: fm-peek.sh <target> [lines=40]',
		out: 'peek.txt'
	}
};

function script(name: string, header: string, out: string): string {
	return `#!/usr/bin/env bash
${header}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
printf '%s' "${name}" >> "$ROOT/calls.log"
for a in "$@"; do printf ' [%s]' "$a" >> "$ROOT/calls.log"; done
printf ' FM_HOME=%s\\n' "$FM_HOME" >> "$ROOT/calls.log"
MODE=ok
[ -f "$ROOT/${name}.mode" ] && MODE=$(cat "$ROOT/${name}.mode")
case "$MODE" in
  malformed) echo 'this is { not json'; exit 0 ;;
  fail) echo "something broke in ${name}" >&2; exit 2 ;;
  sleep) sleep 30; exit 0 ;;
  huge) head -c 20000000 /dev/zero | tr '\\0' 'x'; exit 0 ;;
esac
cat "$ROOT/${out}"
`;
}

const INBOX = `#!/usr/bin/env node
// fm-inbox.sh - fake, written in node for the tests.
//   fm-inbox.sh note [--request-id <id>] [--json] -   prints fm-inbox-note.v1
//   fm-inbox.sh receipts [--after <cursor>] [--all-pending] [--all-handled] [--all-replies]
//                                                      prints fm-inbox-receipts.v1
//   fm-inbox.sh ready                                  prints fm-primary-ready.v1
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.FM_HOME;
const INBOX = path.join(HOME, 'state', 'inbox');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(ROOT, 'calls.log'),
  'fm-inbox.sh' + args.map((a) => ' [' + a + ']').join('') + ' FM_HOME=' + HOME + '\\n');
const ctl = (f, d) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').trim(); } catch { return d; } };
const out = (v) => process.stdout.write(JSON.stringify(v) + '\\n');
const die = (m) => { process.stderr.write('fm-inbox: ' + m + '\\n'); process.exit(1); };
const hang = () => setTimeout(() => process.exit(0), 30000);
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);
const notePath = (id) => exists(path.join(INBOX, id + '.json')) ? path.join(INBOX, id + '.json')
  : exists(path.join(INBOX, 'handled', id + '.json')) ? path.join(INBOX, 'handled', id + '.json') : null;

function note() {
  let rid = null, json = false, i = 0;
  for (; i < args.length - 1; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--request-id') rid = args[++i];
  }
  if (args[args.length - 1] !== '-') die('fake supports only stdin bodies');
  const body = fs.readFileSync(0, 'utf8');
  fs.appendFileSync(path.join(ROOT, 'note-stdin.log'), JSON.stringify(body) + '\\n');
  const mode = ctl('note.mode', 'ok');
  if (mode === 'fail') die('could not queue the note');
  if (mode === 'sleep') return hang();
  if (!body.trim()) die('refusing to queue an empty note');
  fs.mkdirSync(path.join(INBOX, '.requests'), { recursive: true });
  fs.mkdirSync(path.join(INBOX, '.announced'), { recursive: true });
  const reserved = path.join(INBOX, '.requests', rid);
  let outcome = 'created', id;
  if (exists(reserved)) {
    outcome = 'replay';
    id = fs.readFileSync(reserved, 'utf8').trim();
  } else {
    id = Math.floor(Date.now() / 1000) + '-' + Math.random().toString(36).slice(2, 8);
    fs.writeFileSync(reserved, id);
    fs.writeFileSync(path.join(INBOX, id + '.json'), JSON.stringify({
      id, at: new Date().toISOString().replace(/\\.\\d+Z$/, 'Z'), source: 'text', request_id: rid, body }));
  }
  const acknowledged = exists(path.join(INBOX, 'handled', id + '.json'));
  const marker = path.join(INBOX, '.announced', id);
  if (!acknowledged && mode !== 'unannounced' && !exists(marker)) fs.writeFileSync(marker, 'x');
  const announced = exists(marker);
  if (mode === 'malformed') { process.stdout.write('{ not json\\n'); return; }
  out({ schema: 'fm-inbox-note.v1', outcome, id, request_id: rid, saved: true, announced,
        acknowledged, path: notePath(id) });
  if (mode === 'save-then-sleep') return hang();
  if (!announced && !acknowledged) process.exit(3);
}

function receipts() {
  const mode = ctl('receipts.mode', 'ok');
  if (mode === 'fail') die('receipts broke');
  if (mode === 'malformed') { process.stdout.write('nope\\n'); return; }
  let after = '';
  const all = new Set();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--after') after = args[++i];
    else if (args[i].startsWith('--all-')) all.add(args[i].slice(6));
  }
  const bound = Number(ctl('receipts.bound', '20'));
  const list = (dir, acknowledged) => {
    if (!exists(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => {
      const n = read(path.join(dir, f));
      const rp = path.join(INBOX, '.replies', n.id + '.json');
      const r = exists(rp) ? read(rp) : null;
      return { id: n.id, at: n.at, source: n.source, request_id: n.request_id, body: n.body,
        acknowledged, announced: exists(path.join(INBOX, '.announced', n.id)),
        reply: r && { id: r.id, at: r.at, body: r.body, cursor: String(r.seq).padStart(12, '0') } };
    });
  };
  const handledAll = list(path.join(INBOX, 'handled'), true);
  const handledIds = new Set(handledAll.map((n) => n.id));
  const pendingAll = list(INBOX, false).filter((n) => !handledIds.has(n.id));
  const omitted = [];
  const cut = (rows, key, label) => {
    if (all.has(key) || rows.length <= bound) return rows;
    omitted.push({ surface: label + ' omitted by bound: ' + (rows.length - bound), reveal: 'pass --all-' + key });
    return rows.slice(0, bound);
  };
  const pending = cut(pendingAll, 'pending', 'pending notes');
  const handled = cut(handledAll, 'handled', 'handled notes');
  const repliesAll = [...pendingAll, ...handledAll].map((n) => n.reply).filter(Boolean)
    .sort((a, b) => a.cursor.localeCompare(b.cursor)).filter((r) => r.cursor > after);
  const replies = cut(repliesAll, 'replies', 'replies');
  out({ schema: 'fm-inbox-receipts.v1', home: 'fake', generated: new Date().toISOString(),
        pending, handled, replies,
        reply_cursor: replies.length ? replies[replies.length - 1].cursor : after, omitted });
}

function ready() {
  const mode = ctl('fm-inbox.sh.mode', 'ok');
  if (mode === 'fail') { process.stderr.write('something broke in fm-inbox.sh\\n'); process.exit(2); }
  if (mode === 'malformed') { process.stdout.write('this is { not json\\n'); return; }
  if (mode === 'sleep') return hang();
  if (mode === 'huge') { process.stdout.write('x'.repeat(20000000)); return; }
  process.stdout.write(fs.readFileSync(path.join(ROOT, 'ready.json')));
}

const cmd = { note, receipts, ready }[args[0]];
if (!cmd) die('unknown subcommand ' + args[0]);
cmd();
`;

export type NoteMode = 'ok' | 'unannounced' | 'fail' | 'sleep' | 'save-then-sleep' | 'malformed';

export interface FakeNote {
	id: string;
	request_id: string | null;
	body: string;
	acknowledged: boolean;
	announced: boolean;
}

export interface FakeFirstmate {
	root: string;
	set(file: string, content: string | object): void;
	mode(scriptName: string, mode: 'ok' | 'malformed' | 'fail' | 'sleep' | 'huge'): void;
	noteMode(mode: NoteMode): void;
	/** Every note in the fake inbox, pending and handled. */
	notes(): FakeNote[];
	/** Firstmate drains (acknowledges) a note. */
	ack(noteId: string): void;
	/** Firstmate records a reply to a note, as `fm-inbox.sh reply` would. */
	reply(noteId: string, body: string): void;
	cleanup(): void;
}

export function snapshotFixture(overrides: Record<string, unknown> = {}, root = '/fm'): object {
	return {
		schema: 'fm-fleet-snapshot.v1',
		generated: '2026-10-11T05:41:32Z',
		fm_home: root,
		roots: { fm_root: root, data: path.join(root, 'data'), state: path.join(root, 'state') },
		backlog: { present: true, records: [] },
		tasks: [],
		main_inventory: { valid: true, orphan_in_flight: [] },
		...overrides
	};
}

export const READY_ON_WATCH = {
	schema: 'fm-primary-ready.v1',
	home: 'fm',
	observed_at: '2026-10-11T05:41:35Z',
	lock: { state: 'held', pid: 1, live_harness: true },
	wake_consumer: { state: 'healthy', reason: 'supervised', beacon_age_seconds: 10 },
	posture: { state: 'present' },
	can_receive: true
};

export function createFakeFirstmate(): FakeFirstmate {
	const root = mkdtempSync(path.join(tmpdir(), 'wh-fake-fm-'));
	mkdirSync(path.join(root, 'bin'));
	mkdirSync(path.join(root, 'state'));
	mkdirSync(path.join(root, 'data'));
	for (const [name, s] of Object.entries(SCRIPTS)) {
		const file = path.join(root, 'bin', name);
		writeFileSync(file, script(name, s.header, s.out));
		chmodSync(file, 0o755);
	}
	writeFileSync(path.join(root, 'bin', 'fm-inbox.sh'), INBOX);
	chmodSync(path.join(root, 'bin', 'fm-inbox.sh'), 0o755);
	const inbox = path.join(root, 'state', 'inbox');
	let seq = 0;
	const fake: FakeFirstmate = {
		root,
		set(file, content) {
			const p = path.join(root, file);
			mkdirSync(path.dirname(p), { recursive: true });
			writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
		},
		mode(name, mode) {
			writeFileSync(path.join(root, `${name}.mode`), mode);
		},
		noteMode(mode) {
			writeFileSync(path.join(root, 'note.mode'), mode);
		},
		notes() {
			const list = (dir: string, acknowledged: boolean) =>
				existsSync(dir)
					? readdirSync(dir)
							.filter((f) => f.endsWith('.json'))
							.map((f) => {
								const n = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
								const announced = existsSync(path.join(inbox, '.announced', n.id));
								return { ...n, acknowledged, announced } as FakeNote;
							})
					: [];
			return [...list(inbox, false), ...list(path.join(inbox, 'handled'), true)];
		},
		ack(noteId) {
			mkdirSync(path.join(inbox, 'handled'), { recursive: true });
			renameSync(path.join(inbox, `${noteId}.json`), path.join(inbox, 'handled', `${noteId}.json`));
		},
		reply(noteId, body) {
			mkdirSync(path.join(inbox, '.replies'), { recursive: true });
			writeFileSync(
				path.join(inbox, '.replies', `${noteId}.json`),
				JSON.stringify({ id: noteId, at: new Date().toISOString(), seq: ++seq, body })
			);
		},
		cleanup() {
			rmSync(root, { recursive: true, force: true });
		}
	};
	fake.set('snapshot.json', snapshotFixture({}, root));
	fake.set('ready.json', READY_ON_WATCH);
	fake.set('peek.txt', 'line one\n');
	return fake;
}

export interface RowOptions {
	id: string;
	kind?: string;
	state?: string;
	source?: string;
	detail?: string;
	freshness?: string;
	mode?: string;
	yolo?: string;
	pr?: string | null;
	endpointExists?: boolean;
	decisions?: { key: string; verb: string; summary: string }[];
	reportPresent?: boolean;
	worktree?: string | null;
	project?: string;
	backlog?: Record<string, unknown>;
	lastEvent?: { state: string; note: string; age_seconds: number } | null;
}

/** One raw `tasks[]` row in the fm-fleet-snapshot.v1 shape. */
export function taskRow(o: RowOptions): Record<string, unknown> {
	return {
		id: o.id,
		kind: o.kind ?? 'ship',
		harness: 'claude',
		mode: o.mode ?? 'no-mistakes',
		yolo: o.yolo ?? 'off',
		branch: `fm/${o.id}`,
		project: o.project ?? '/fm/projects/wheelhouse',
		paths: {
			status_log: {
				present: true,
				last_event:
					o.lastEvent === undefined
						? { state: 'working', note: 'did a thing', age_seconds: 120 }
						: o.lastEvent
			},
			worktree: { path: o.worktree ?? null, present: !!o.worktree },
			report: { path: `/fm/data/${o.id}/report.md`, present: o.reportPresent ?? false }
		},
		current_state: {
			state: o.state ?? 'working',
			source: o.source ?? 'pane',
			detail: o.detail ?? 'harness busy',
			observed_at: '2026-10-11T05:41:32Z',
			freshness: o.freshness ?? 'fresh'
		},
		endpoint: {
			exists: o.endpointExists ?? true,
			freshness: 'fresh',
			target: `firstmate:fm-${o.id}`
		},
		pr: { url: o.pr ?? null, source: o.pr ? 'meta' : 'absent' },
		hints: { open_decisions: o.decisions ?? [] },
		backlog: {
			id: o.id,
			state: 'in_flight',
			title: `Task ${o.id}`,
			repo: 'wheelhouse',
			kind: o.kind ?? 'ship',
			since: '2026-10-10',
			completion: { verb: null, date: null },
			captain_actionable: false,
			unresolved_blocker_ids: [],
			...(o.backlog ?? {})
		}
	};
}

export function backlogRow(
	id: string,
	state: 'queued' | 'done' | 'in_flight',
	extra: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		id,
		state,
		title: `Task ${id}`,
		repo: 'wheelhouse',
		kind: 'ship',
		since: '2026-10-09',
		completion:
			state === 'done' ? { verb: 'merged', date: '2026-10-10' } : { verb: null, date: null },
		captain_actionable: false,
		unresolved_blocker_ids: [],
		...extra
	};
}
