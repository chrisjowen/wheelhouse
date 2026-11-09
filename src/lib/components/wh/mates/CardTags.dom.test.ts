import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskSummary } from '$lib/types';
import { taskSummary } from '../../../../../tests/helpers/task-summary';

vi.mock('$app/state', () => ({ page: { data: {} } }));
vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Response('{}', { status: 200 }))
);
const { default: TaskCard } = await import('../TaskCard.svelte');
const { default: MoveCard } = await import('../MoveCard.svelte');
const { default: CompactCard } = await import('../views/CompactCard.svelte');

/**
 * A second mate's task carries two tags side by side on every card: the second
 * mate's name (its host only as secondary detail), then its project, the
 * project tag drawn exactly as on a card of the captain's own.
 */

// A task awaiting review, so the Harbour's review card (MoveCard) draws it too.
const awaiting: Partial<TaskSummary> = {
	projectId: 'wheelhouse',
	attention: { kind: 'review', owner: 'captain', text: 'Ready for your review.', url: null }
};
const remote = taskSummary('wh-vault-chat-add@hostinger-mate', 'needs-review', {
	...awaiting,
	secondMate: { id: 'hostinger-mate', host: 'hostinger-box', where: 'remote' }
});
const own = taskSummary('wh-local', 'needs-review', awaiting);

const cards = { TaskCard, MoveCard, CompactCard } as const;

let apps: ReturnType<typeof mount>[] = [];
afterEach(() => {
	for (const a of apps) unmount(a);
	apps = [];
	document.body.innerHTML = '';
});

function draw(name: keyof typeof cards, task: TaskSummary): HTMLElement {
	const target = document.createElement('div');
	document.body.append(target);
	apps.push(
		mount(cards[name] as never, { target, props: { task, projectName: 'wheelhouse' } as never })
	);
	flushSync();
	return target;
}

describe.each(Object.keys(cards) as (keyof typeof cards)[])('%s', (name) => {
	it('shows [second mate][project] side by side for a second mate’s task', () => {
		const card = draw(name, remote);
		const mate = card.querySelector<HTMLElement>('[data-second-mate-task]')!;
		const project = card.querySelector<HTMLElement>('[data-project-tag]')!;
		expect(mate.textContent).toContain('hostinger-mate');
		expect(project.textContent).toBe('wheelhouse');
		// One row, the second mate first.
		const row = mate.parentElement!;
		expect(row.contains(project)).toBe(true);
		expect(mate.compareDocumentPosition(project) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		// The host is there, but only as secondary detail.
		const host = mate.querySelector<HTMLElement>('[data-second-mate-host]')!;
		expect(host.textContent).toContain('hostinger-box');
		expect(host.className).toContain('opacity-70');
	});

	it('draws its project tag exactly as on a card of the captain’s own', () => {
		const theirs = draw(name, remote).querySelector<HTMLElement>('[data-project-tag]')!;
		const ours = draw(name, own);
		expect(ours.querySelector('[data-second-mate-task]')).toBeNull();
		const tag = ours.querySelector<HTMLElement>('[data-project-tag]')!;
		expect(theirs.className).toBe(tag.className);
		expect(theirs.textContent).toBe(tag.textContent);
	});
});
