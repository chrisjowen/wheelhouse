import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
 */

const SCRIPTS: Record<string, { header: string; out: string }> = {
	'fm-fleet-snapshot.sh': {
		header: '# fm-fleet-snapshot.sh - fake. Output contract: `--json` prints fm-fleet-snapshot.v1.',
		out: 'snapshot.json'
	},
	'fm-inbox.sh': {
		header: '# fm-inbox.sh - fake.\n#   fm-inbox.sh ready\n# schema fm-primary-ready.v1',
		out: 'ready.json'
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

export interface FakeFirstmate {
	root: string;
	set(file: string, content: string | object): void;
	mode(scriptName: string, mode: 'ok' | 'malformed' | 'fail' | 'sleep' | 'huge'): void;
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
		endpoint: { exists: o.endpointExists ?? true, freshness: 'fresh' },
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
