<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { currentFleet, currentHealth } from '$lib/client/live.svelte';
	import { needsYou } from '$lib/harbour';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import { Anchor, Check, ChevronDown, Moon, Sun } from '@lucide/svelte';

	let { dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void } = $props();

	const fleet = $derived(currentFleet());
	const health = $derived(currentHealth());
	const sup = $derived(health?.supervisor);
	const projects = $derived(fleet?.projects ?? []);

	// Project scope lives in the URL (?project=); a task page shows its own project.
	const taskId = $derived(page.url.pathname.match(/^\/tasks\/([^/]+)/)?.[1] ?? null);
	const onBridge = $derived(page.url.pathname === '/bridge');
	const current = $derived.by(() => {
		const q = page.url.searchParams.get('project');
		if (q) return q;
		if (taskId) {
			const id = decodeURIComponent(taskId);
			return fleet?.tasks.find((t) => t.id === id)?.projectId ?? 'all';
		}
		return 'all';
	});
	const needCount = (pid: string) =>
		(fleet?.tasks ?? []).filter((t) => (pid === 'all' || t.projectId === pid) && needsYou(t))
			.length;
	const currentName = $derived(
		current === 'all' ? 'All projects' : (projects.find((p) => p.id === current)?.name ?? current)
	);

	function pick(id: string) {
		const view = page.url.pathname === '/' ? page.url.searchParams.get('view') : null;
		const q = [
			id !== 'all' ? `project=${encodeURIComponent(id)}` : null,
			view ? `view=${encodeURIComponent(view)}` : null
		].filter(Boolean);
		goto(q.length ? `/?${q.join('&')}` : '/');
	}

	const watch = $derived(
		!sup?.available
			? { dot: 'bg-muted-foreground', label: 'Firstmate unknown' }
			: sup.onWatch
				? { dot: 'bg-success', label: 'Firstmate on watch' }
				: sup.onWatch === false
					? { dot: 'bg-danger', label: 'Firstmate off watch' }
					: { dot: 'bg-warning', label: 'Firstmate unclear' }
	);
</script>

<header class="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
	<div class="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:gap-8 sm:px-6">
		<a
			href="/"
			class="flex items-center gap-2 font-semibold tracking-tight"
			aria-label="Wheelhouse"
		>
			<Anchor class="size-5 text-sea" aria-hidden="true" /><span class="hidden sm:inline"
				>Wheelhouse</span
			>
		</a>

		<nav class="flex items-center gap-1 text-sm" aria-label="Main">
			<a
				href="/"
				aria-current={page.url.pathname === '/' || taskId ? 'page' : undefined}
				class="rounded-md px-3 py-1.5 transition-colors {page.url.pathname === '/' || taskId
					? 'bg-accent font-medium text-foreground'
					: 'text-muted-foreground hover:text-foreground'}">Harbour</a
			>
			<a
				href="/bridge"
				aria-current={onBridge ? 'page' : undefined}
				class="rounded-md px-3 py-1.5 transition-colors {onBridge
					? 'bg-accent font-medium text-foreground'
					: 'text-muted-foreground hover:text-foreground'}">Bridge</a
			>
		</nav>

		<div class="ml-auto flex items-center gap-2 sm:gap-3">
			<Tooltip.Root>
				<Tooltip.Trigger
					class="hidden cursor-default items-center gap-2 text-sm text-muted-foreground md:flex"
				>
					<span class="size-2 rounded-full {watch.dot}" aria-hidden="true"></span>{watch.label}
				</Tooltip.Trigger>
				<Tooltip.Content class="max-w-xs">
					{#if sup?.onWatch}
						Firstmate is running and reading its inbox.
					{:else}
						{sup?.reason ?? 'Firstmate’s readiness is unknown.'}
					{/if}
					{#if health?.firstmate.version}
						Firstmate {health.firstmate.version}{health.firstmate.compatible
							? ', compatible'
							: ', not compatible'}.
					{/if}
				</Tooltip.Content>
			</Tooltip.Root>

			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class="max-w-44 min-w-0 justify-between gap-2 sm:max-w-none sm:min-w-44"
						>
							<span class="truncate">{currentName}</span>
							<span class="flex items-center gap-1.5">
								{#if needCount(current)}
									<span
										class="tabular rounded-full bg-sea px-1.5 text-[11px] leading-4 font-medium text-white dark:text-slate-950"
										aria-label="{needCount(current)} need you">{needCount(current)}</span
									>
								{/if}
								<ChevronDown class="size-4 text-muted-foreground" />
							</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-56">
					{#each [{ id: 'all', name: 'All projects' }, ...projects] as p, i (p.id)}
						{#if i === 1}<DropdownMenu.Separator />{/if}
						<DropdownMenu.Item onSelect={() => pick(p.id)} class="justify-between gap-6">
							<span class="truncate">{p.name}</span>
							<span class="flex items-center gap-2">
								{#if needCount(p.id)}<span class="tabular text-xs text-sea"
										>{needCount(p.id)} need you</span
									>{/if}
								{#if current === p.id}<Check class="size-4" aria-label="Selected" />{/if}
							</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<Button
				variant="ghost"
				size="icon-sm"
				onclick={onToggleTheme}
				aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
			>
				{#if dark}<Sun />{:else}<Moon />{/if}
			</Button>
		</div>
	</div>
</header>
