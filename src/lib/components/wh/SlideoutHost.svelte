<script lang="ts">
	/**
	 * The task slide-out every page shares (lib/client/slideout.svelte.ts). A link to a task's page, from
	 * anywhere (Harbour, On deck, the Logbook, the chat, search…), slides the task
	 * out instead of leaving the page; the task page itself stays behind the
	 * slide-out's Open full page (`data-open-full-page`) and for an address typed
	 * or opened in a new tab.
	 */
	import { onMount } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { currentFleet } from '$lib/client/live.svelte';
	import { slideout } from '$lib/client/slideout.svelte';
	import { taskLink } from '$lib/decisionhome';
	import type { TaskSummary } from '$lib/types';
	import TaskSlideout from '$lib/components/firstmate/TaskSlideout.svelte';

	const fleet = $derived(currentFleet());
	const tasks = $derived(fleet?.tasks ?? []);
	const task = $derived(slideout.taskId ? tasks.find((t) => t.id === slideout.taskId) : null);
	const project = $derived.by(() => {
		const id = task?.projectId;
		if (!id || id === 'unassigned') return null;
		return fleet?.projects.find((p) => p.id === id)?.name ?? id;
	});

	/** Chat about this: the Firstmate chat, with a message about the task started. */
	function chat(t: TaskSummary) {
		slideout.close();
		void goto(`/?chat=${encodeURIComponent(t.id)}`);
	}

	function intercept(e: MouseEvent) {
		if (e.defaultPrevented || e.button !== 0) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const a = (e.target as Element | null)?.closest?.('a[href]');
		if (!(a instanceof HTMLAnchorElement)) return;
		if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;
		if (a.hasAttribute('data-open-full-page')) return;
		let url: URL;
		try {
			url = new URL(a.href, location.href);
		} catch {
			return;
		}
		if (url.origin !== location.origin) return;
		const t = taskLink(url);
		// Within a task's own pages (its document reader's way back), the link goes to the page.
		const here = taskLink(new URL(location.pathname.replace(/\/doc\/?$/, ''), location.href));
		if (t && t.id !== here?.id) {
			e.preventDefault();
			slideout.openTask(t.id, t.tab);
		}
	}

	// Going to another page from the slide-out (the Decisions page, a project…) puts it away.
	afterNavigate((nav) => {
		if (nav.type !== 'enter' && nav.from?.url.href !== nav.to?.url.href) slideout.close();
	});

	onMount(() => {
		// Before the router's own click handling, which leaves a prevented click alone.
		window.addEventListener('click', intercept, true);
		return () => window.removeEventListener('click', intercept, true);
	});
</script>

<TaskSlideout
	taskId={slideout.taskId}
	tab={slideout.panel?.tab ?? null}
	{tasks}
	{project}
	onClose={() => slideout.close()}
	onChat={chat}
/>
