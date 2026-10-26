import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptAdapter } from '../firstmate/adapter';
import { parseFleetSnapshot, type FleetSnapshot } from '../firstmate/contracts';
import { LedgerReader } from '../firstmate/ledger';
import { deriveTasks } from '../firstmate/model';
import { Messenger } from '../store/messenger';
import { MessageStore } from '../store/store';
import { buildInbox, choiceOf, FindingsFiles, recommendationIn, type InboxSources } from './cards';
import { InboxService } from './service';
import {
	backlogRow,
	createFakeFirstmate,
	snapshotFixture,
	taskRow,
	type FakeFirstmate
} from '../../../../tests/helpers/fake-firstmate';
import type { BridgeMessage } from '../../types';
import { answerText } from '../../inbox';

/*
 * Synthetic fixtures only: a made-up crew in a throwaway Firstmate home, with
 * status lines (as the fleet ledger carries them), findings files under
 * data/<task>/, and backlog rows held for the captain.
 */

const RUN = '01J9ZZZZZZZZZZZZZZZZZZZZZZ';
const KEY = `nm-${RUN}-review`;
const T0 = 1_793_000_000;

let fm: FakeFirstmate;
let stateDir: string;

beforeEach(() => {
	fm = createFakeFirstmate();
	stateDir = mkdtempSync(path.join(tmpdir(), 'wh-inbox-state-'));
});
afterEach(() => {
	fm.cleanup();
	rmSync(stateDir, { recursive: true, force: true });
});

const findingsPath = (task: string) => path.join(fm.root, 'data', task, `nm-${RUN}-findings.txt`);

function writeFindings(task: string, text: string) {
	mkdirSync(path.join(fm.root, 'data', task), { recursive: true });
	writeFileSync(findingsPath(task), text);
}

const FINDINGS = `id: archived-rows
severity: warning
file: src/export/csv.ts
line: 42
authority: ask-user
recommendation: FIX - leave archived rows out, as the spec says.
description: The export includes archived rows. The spec says only active rows are exported.

id: header-case
severity: error
file: src/export/header.ts
line: 7
authority: ask-user
description: Column headers are lower case, but the import tool expects title case.
`;

/** A made-up fleet: a review gate, a worker decision, a captain hold and a green PR. */
function fleet(opts: { open?: boolean; holdSet?: string } = {}) {
	const open = opts.open ?? true;
	const rows = [
		taskRow({
			id: 'demo-export',
			decisions: open
				? [
						{
							key: KEY,
							verb: 'needs-decision',
							summary: `ask-user findings=archived-rows,header-case file=${findingsPath('demo-export')}`
						}
					]
				: [],
			backlog: { title: 'demo: CSV export', repo: 'demo' }
		}),
		taskRow({
			id: 'demo-theme',
			decisions: [
				{
					key: 'theme-choice',
					verb: 'needs-decision',
					summary: 'Pick navy or slate for the dark theme. Recommendation: go ahead with navy.'
				}
			],
			backlog: { title: 'demo: Dark theme', repo: 'demo' }
		}),
		taskRow({
			id: 'demo-board',
			decisions: [
				{ key: 'board-review', verb: 'needs-decision', summary: 'Board live - please review' }
			],
			backlog: { title: 'demo: Board', repo: 'demo' }
		}),
		taskRow({
			id: 'demo-search',
			pr: 'https://example.test/demo/pull/12',
			state: 'done',
			backlog: { title: 'demo: Search', repo: 'demo' }
		})
	];
	const records = [
		backlogRow('demo-billing', 'queued', {
			title: 'demo: Billing provider',
			repo: 'demo',
			captain_actionable: true,
			hold_reason: 'Choose the billing provider before work starts.',
			hold_set: opts.holdSet ?? new Date((T0 - 600) * 1000).toISOString(),
			body_excerpt: 'Two providers fit. Recommendation: approve the cheaper one.'
		})
	];
	const snapshot: FleetSnapshot = parseFleetSnapshot(
		JSON.stringify(snapshotFixture({ tasks: rows, backlog: { present: true, records } }, fm.root))
	);
	const ledger = new LedgerReader(path.join(fm.root, 'state', 'no-ledger.jsonl'));
	const line = (ts: number, task: string, state: string, key: string | null, text: string) =>
		ledger.ingest(JSON.stringify({ v: 1, ts, event: 'task.status', task, state, key, text }));
	line(
		T0,
		'demo-export',
		'needs-decision',
		KEY,
		`ask-user findings=archived-rows,header-case file=${findingsPath('demo-export')}`
	);
	line(
		T0 + 60,
		'demo-theme',
		'needs-decision',
		'theme-choice',
		'Pick navy or slate for the dark theme. Recommendation: go ahead with navy.'
	);
	line(T0 + 30, 'demo-board', 'note', null, 'preview http://127.0.0.1:5173/board');
	line(T0 + 40, 'demo-board', 'needs-decision', 'board-review', 'Board live - please review');
	if (!open) line(T0 + 120, 'demo-export', 'resolved', KEY, 'answered: FIX both.');
	const tasks = deriveTasks(snapshot, {
		registry: [],
		thumbs: new Map(),
		ledger: ledger.state().tasks,
		nowSeconds: T0 + 600
	}).tasks;
	return { snapshot, ledger, tasks };
}

function sources(
	f: ReturnType<typeof fleet>,
	messages: BridgeMessage[] = []
): Omit<InboxSources, 'findings'> {
	return {
		tasks: f.tasks,
		row: (id) => f.snapshot.tasks.find((t) => t.id === id) ?? null,
		backlog: (id) =>
			f.snapshot.tasks.find((t) => t.id === id)?.backlog ??
			f.snapshot.backlog.records.find((r) => r.id === id) ??
			null,
		ledger: (id) => f.ledger.task(id),
		messages,
		homeDir: fm.root
	};
}

describe('recommendations', () => {
	it('finds a recorded recommendation and the button it points at', () => {
		expect(recommendationIn('Pick one. Recommendation: go ahead with navy.')).toBe(
			'go ahead with navy'
		);
		expect(recommendationIn('Firstmate recommends: FIX it')).toBe('FIX it');
		expect(recommendationIn('We could recommend nothing here')).toBeNull();
		expect(choiceOf('FIX - leave them out')).toBe('fix');
		expect(choiceOf('KEEP as is')).toBe('approve');
		expect(choiceOf('DEFER to a follow-up')).toBe('skip');
		expect(choiceOf('go ahead with navy')).toBe('approve');
		expect(choiceOf('it depends')).toBeNull();
	});
});

describe('buildInbox', () => {
	it('builds one card per open question, the captain’s first', () => {
		writeFindings('demo-export', FINDINGS);
		const f = fleet();
		const files = new Map([[findingsPath('demo-export'), FINDINGS]]);
		const cards = buildInbox({ ...sources(f), findings: (_t, file) => files.get(file) ?? null });
		expect(cards.map((c) => [c.id, c.kind, c.owner])).toEqual([
			['demo-billing:captain-hold', 'hold', 'captain'],
			['demo-board:board-review', 'preview', 'captain'],
			['demo-search:merge-pr', 'merge', 'captain'],
			[`demo-export:${KEY}`, 'review', 'firstmate'],
			['demo-theme:theme-choice', 'decision', 'firstmate']
		]);
	});

	it('shows a review gate’s findings, where they are and the recommendation', () => {
		const f = fleet();
		const cards = buildInbox({ ...sources(f), findings: () => FINDINGS });
		const review = cards.find((c) => c.kind === 'review')!;
		expect(review.question).toBe('2 questions from the automated review');
		expect(review.taskTitle).toBe('CSV export');
		expect(review.projectId).toBe('demo');
		expect(review.askedAt).toBe(new Date(T0 * 1000).toISOString());
		expect(review.evidence.file).toBe(`nm-${RUN}-findings.txt`);
		expect(review.evidence.findings).toEqual([
			{
				id: 'archived-rows',
				summary: 'The export includes archived rows. The spec says only active rows are exported.',
				detail: null,
				where: 'src/export/csv.ts, line 42',
				serious: false
			},
			{
				id: 'header-case',
				summary: 'Column headers are lower case, but the import tool expects title case.',
				detail: null,
				where: 'src/export/header.ts, line 7',
				serious: true
			}
		]);
		expect(review.recommendation).toEqual({
			choice: 'fix',
			text: 'Leave archived rows out, as the spec says'
		});
		expect(review.options.map((o) => o.label)).toEqual(['Approve', 'Fix', 'Skip']);
	});

	it('keeps internals out: no home paths in the evidence', () => {
		const f = fleet();
		const cards = buildInbox({ ...sources(f), findings: () => null });
		const json = JSON.stringify(cards);
		expect(json).not.toContain(path.join(fm.root, 'data'));
		const review = cards.find((c) => c.kind === 'review')!;
		// An unreadable findings file still names each question by its id.
		expect(review.evidence.findings.map((x) => x.summary)).toEqual([
			'archived rows',
			'header case'
		]);
	});

	it('shows a captain hold with its reason, body and recommendation', () => {
		const cards = buildInbox({ ...sources(fleet()), findings: () => null });
		const hold = cards.find((c) => c.kind === 'hold')!;
		expect(hold.question).toBe('Choose the billing provider before work starts.');
		expect(hold.evidence.text).toBe('Two providers fit. Recommendation: approve the cheaper one.');
		expect(hold.recommendation).toEqual({ choice: 'approve', text: 'The cheaper one' });
	});

	it('shows a merge call with its pull request and green checks', () => {
		const cards = buildInbox({ ...sources(fleet()), findings: () => null });
		const merge = cards.find((c) => c.kind === 'merge')!;
		expect(merge.question).toBe('Merge pull request #12? Its checks are green.');
		expect(merge.evidence.pr).toEqual({ url: 'https://example.test/demo/pull/12', number: 12 });
		expect(merge.evidence.checks).toBe('green');
		expect(merge.recommendation).toBeNull();
	});

	it('shows a preview sign-off with its preview and Request changes in place of Fix', () => {
		const cards = buildInbox({ ...sources(fleet()), findings: () => null });
		const preview = cards.find((c) => c.kind === 'preview')!;
		expect(preview).toMatchObject({
			id: 'demo-board:board-review',
			owner: 'captain',
			askedAt: new Date((T0 + 40) * 1000).toISOString()
		});
		expect(preview.evidence.preview).toBe('http://127.0.0.1:5173/board');
		expect(preview.options.map((o) => o.label)).toEqual(['Approve', 'Request changes', 'Skip']);
	});

	it('dates a hold from its hold-set stamp, and shows a re-hold with the same reason as unanswered', () => {
		const message = (text: string): BridgeMessage => ({
			requestId: 'inbox-h1',
			text,
			taskId: 'demo-billing',
			submittedAt: new Date((T0 + 300) * 1000).toISOString(),
			delivery: 'delivered',
			deliveryDetail: null,
			acknowledged: true,
			noteId: 'n1',
			reply: null
		});
		const first = buildInbox({ ...sources(fleet()), findings: () => null }).find(
			(c) => c.kind === 'hold'
		)!;
		expect(first.askedAt).toBe(new Date((T0 - 600) * 1000).toISOString());
		const skipped = message(answerText(first, 'skip', null));
		const same = buildInbox({ ...sources(fleet(), [skipped]), findings: () => null });
		expect(same.find((c) => c.kind === 'hold')!.sent).toMatchObject({ choice: 'skip' });
		const rehold = fleet({ holdSet: new Date((T0 + 900) * 1000).toISOString() });
		const later = buildInbox({ ...sources(rehold, [skipped]), findings: () => null });
		expect(later.find((c) => c.kind === 'hold')!.sent).toBeNull();
	});

	it('keeps the recommendation out of the question text', () => {
		const cards = buildInbox({ ...sources(fleet()), findings: () => null });
		const theme = cards.find((c) => c.key === 'theme-choice')!;
		expect(theme.question).toBe('Pick navy or slate for the dark theme.');
		expect(theme.recommendation).toEqual({ choice: 'approve', text: 'Go ahead with navy' });
	});

	it('drops a question once its key resolves in the status log', () => {
		const cards = buildInbox({ ...sources(fleet({ open: false })), findings: () => null });
		expect(cards.some((c) => c.taskId === 'demo-export')).toBe(false);
	});

	it('marks a card sent from the captain’s answer, but not an answer from before it was asked', () => {
		const message = (submittedAt: string, text: string): BridgeMessage => ({
			requestId: 'inbox-1',
			text,
			taskId: 'demo-theme',
			submittedAt,
			delivery: 'delivered',
			deliveryDetail: null,
			acknowledged: true,
			noteId: 'n1',
			reply: null
		});
		const answer = 'Decision inbox answer (decision).\nDecision key: theme-choice\nAnswer: Fix - x';
		const before = new Date((T0 - 60) * 1000).toISOString();
		const after = new Date((T0 + 120) * 1000).toISOString();
		const stale = buildInbox({
			...sources(fleet(), [message(before, answer)]),
			findings: () => null
		});
		expect(stale.find((c) => c.key === 'theme-choice')!.sent).toBeNull();
		const sent = buildInbox({
			...sources(fleet(), [message(after, answer)]),
			findings: () => null
		});
		expect(sent.find((c) => c.key === 'theme-choice')!.sent).toMatchObject({
			choice: 'fix',
			delivery: 'delivered'
		});
	});
});

describe('FindingsFiles', () => {
	it('reads only files inside the task’s own data folder', async () => {
		writeFindings('demo-export', FINDINGS);
		const outside = path.join(fm.root, 'elsewhere.txt');
		writeFileSync(outside, FINDINGS);
		const files = new FindingsFiles(() => path.join(fm.root, 'data'));
		await files.load([
			{ taskId: 'demo-export', file: findingsPath('demo-export') },
			{ taskId: 'demo-export', file: outside },
			{ taskId: 'demo-theme', file: findingsPath('demo-export') }
		]);
		expect(files.get('demo-export', findingsPath('demo-export'))).toBe(FINDINGS);
		expect(files.get('demo-export', outside)).toBeNull();
		expect(files.get('demo-theme', findingsPath('demo-export'))).toBeNull();
	});
});

describe('InboxService', () => {
	async function service(f = fleet()) {
		writeFindings('demo-export', FINDINGS);
		const store = await MessageStore.open(path.join(stateDir, 'messages.json'), fm.root);
		const adapter = createScriptAdapter({ firstmateDir: fm.root, homeDir: fm.root });
		const messenger = new Messenger({ adapter, store });
		const inbox = new InboxService({
			sources: () => sources(f, messenger.view().messages),
			dataDir: () => path.join(fm.root, 'data'),
			messenger,
			unavailable: () => null
		});
		return { inbox, messenger };
	}
	const notes = () =>
		readFileSync(path.join(fm.root, 'note-stdin.log'), 'utf8')
			.trim()
			.split('\n')
			.map((l) => JSON.parse(l) as string);

	it('writes the answer to Firstmate through fm-inbox.sh note, naming task, key and option', async () => {
		const { inbox } = await service();
		const r = await inbox.answer('inbox-a1', {
			cardId: `demo-export:${KEY}`,
			choice: 'fix',
			note: 'Title case, please.'
		});
		expect(r).toMatchObject({ ok: true, created: true });
		expect(notes()).toEqual([
			[
				'Re: demo-export',
				'Decision inbox answer (review question).',
				'Task: demo-export (CSV export)',
				`Decision key: ${KEY}`,
				'Question: 2 questions from the automated review',
				'Answer: Fix - Have the worker fix it.',
				'Note: Title case, please.'
			].join('\n')
		]);
		const calls = readFileSync(path.join(fm.root, 'calls.log'), 'utf8');
		expect(calls).toContain('fm-inbox.sh [note] [--request-id] [inbox-a1] [--json] [-]');
		// The card now reads as sent, until the key resolves.
		const card = (await inbox.view()).cards.find((c) => c.id === `demo-export:${KEY}`)!;
		expect(card.sent).toMatchObject({ choice: 'fix', note: 'Title case, please.' });
	});

	it('repeats the original message for the same request id', async () => {
		const { inbox } = await service();
		const body = { cardId: 'demo-search:merge-pr', choice: 'approve' };
		await inbox.answer('inbox-r1', body);
		const again = await inbox.answer('inbox-r1', body);
		expect(again).toMatchObject({ ok: true, created: false });
		expect(notes()).toHaveLength(1);
		expect(notes()[0]).toContain('Pull request: https://example.test/demo/pull/12');
	});

	it('refuses a closed question, a bad choice and a long note without writing anything', async () => {
		const { inbox } = await service(fleet({ open: false }));
		expect(
			await inbox.answer('inbox-x1', { cardId: `demo-export:${KEY}`, choice: 'fix' })
		).toMatchObject({
			ok: false,
			status: 404
		});
		expect(
			await inbox.answer('inbox-x2', { cardId: 'demo-search:merge-pr', choice: 'merge' })
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await inbox.answer('inbox-x3', {
				cardId: 'demo-search:merge-pr',
				choice: 'fix',
				note: 'x'.repeat(2001)
			})
		).toMatchObject({ ok: false, status: 413 });
		expect(
			await inbox.answer(null, { cardId: 'demo-search:merge-pr', choice: 'fix' })
		).toMatchObject({ ok: false, status: 400 });
		expect(() => readFileSync(path.join(fm.root, 'note-stdin.log'))).toThrow();
	});

	it('reports when answers cannot be sent', async () => {
		const inbox = new InboxService({
			sources: () => sources(fleet()),
			dataDir: () => path.join(fm.root, 'data'),
			messenger: null,
			unavailable: () => 'Messaging is off.'
		});
		const v = await inbox.view();
		expect(v).toMatchObject({ available: true, canAnswer: false, reason: 'Messaging is off.' });
		expect(
			await inbox.answer('inbox-z', { cardId: 'demo-search:merge-pr', choice: 'fix' })
		).toEqual({ ok: false, status: 503, error: 'Messaging is off.' });
	});
});
