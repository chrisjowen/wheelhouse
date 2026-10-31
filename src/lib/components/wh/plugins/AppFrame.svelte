<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { LoaderCircle, Minimize2, Play } from '@lucide/svelte';
	import {
		appNotificationHandler,
		appRequestHandler,
		DENIED,
		RpcError,
		RpcPeer,
		type AppHandlers
	} from '$lib/apps/bridge';
	import {
		containerDimensions,
		hostCapabilities,
		hostContext,
		hostStyles
	} from '$lib/apps/context';
	import { cspOrigins } from '$lib/apps/csp';
	import type { AppOpenView, AppRef, DisplayMode } from '$lib/apps/types';
	import { addressRewrites } from '$lib/client/addresses.svelte';
	import { callAppTool, openApp, readAppResource, runApp, startService } from '$lib/client/apps';
	import { sendToInbox } from '$lib/client/chat.svelte';
	import { enterFullscreen, leaveFullscreen } from '$lib/client/fullscreen.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ServiceView } from '$lib/plugins/types';

	/**
	 * An MCP app in a plugin slot, or under a tool call in the chat. In a slot,
	 * Wheelhouse calls the app's tool itself with the provider's arguments; in
	 * the chat, the app gets the arguments and result of Firstmate's call. It draws the app's own HTML in a frame on the
	 * sandbox's origin (a loopback port for its server alone), never
	 * Wheelhouse's: the app cannot reach this page, its session token,
	 * Wheelhouse's API or another server's app. It talks to
	 * the page only through the bridge, and what it asks for is checked: tool
	 * calls and reads reach its own server only, a call that may change
	 * something waits for the captain's agreement, a message to Firstmate is
	 * shown first and sent only when the captain says so, and links open in a
	 * new tab. When the app's server is not running, the captain can start it
	 * here.
	 */
	let {
		ref,
		title,
		plugin,
		fill = false
	}: {
		/** Which app: a slot's contribution, or a chat tool call. */
		ref: AppRef;
		/** What the captain knows it as: the contribution's title, or the tool's. */
		title: string;
		/** The plugin whose MCP server it comes from. */
		plugin: string;
		fill?: boolean;
	} = $props();

	const MAX_HEIGHT = 720;
	const token = () => (page.data.sessionToken as string) ?? '';
	const version = () => (page.data.health as { version?: string } | undefined)?.version ?? '0.0.0';

	type Ready = Extract<AppOpenView, { state: 'ready' }>;
	let phase = $state<'opening' | 'service' | 'ready' | 'failed'>('opening');
	// Raw, not proxied: what the bridge posts to the frame must be plain data.
	let view = $state.raw<Ready | null>(null);
	let service = $state.raw<ServiceView | null>(null);
	let serverTitle = $state('');
	let failure = $state<string | null>(null);
	let note = $state<string | null>(null);
	let starting = $state(false);
	let height = $state(160);
	let mode = $state<DisplayMode>('inline');

	let box = $state<HTMLDivElement | null>(null);
	let frame = $state<HTMLIFrameElement | null>(null);
	let exitFullscreen = $state<() => void>(() => {});

	type Ask =
		| { kind: 'tool'; title: string; description: string | null; args: string }
		| { kind: 'message'; text: string };
	let asking = $state<(Ask & { answer: (yes: boolean) => void }) | null>(null);
	let dialog = $state<HTMLDialogElement | null>(null);
	let queue: Promise<unknown> = Promise.resolve();

	/** Ask the captain, one question at a time. */
	function ask(q: Ask): Promise<boolean> {
		const next = queue.then(
			() =>
				new Promise<boolean>((resolve) => {
					asking = {
						...q,
						answer: (yes) => {
							asking = null;
							resolve(yes);
						}
					};
				})
		);
		queue = next.catch(() => {});
		return next;
	}

	$effect(() => {
		if (!dialog) return;
		if (asking && !dialog.open) dialog.showModal();
		else if (!asking && dialog.open) dialog.close();
	});

	async function open() {
		phase = 'opening';
		failure = null;
		try {
			const v = await openApp(ref, token());
			if (v.state === 'ready') {
				view = v;
				serverTitle = v.server.title;
				phase = 'ready';
			} else if (v.state === 'service') {
				service = v.service;
				serverTitle = v.server.title;
				phase = 'service';
			} else {
				failure = v.reason;
				phase = 'failed';
			}
		} catch (e) {
			failure = (e as Error).message;
			phase = 'failed';
		}
	}

	async function start() {
		if (!service) return;
		starting = true;
		const v = await startService(
			{ plugin: service.plugin, service: service.service, project: service.project },
			token()
		);
		starting = false;
		if (v?.state === 'running') await open();
		else service = v ?? service;
	}

	onMount(() => {
		void open();
	});

	const sandboxSrc = $derived.by(() => {
		if (!view) return null;
		const u = new URL(view.sandbox);
		u.searchParams.set('host', location.origin);
		return u.href;
	});
	const origins = $derived(view ? cspOrigins(view.csp) : []);

	const theme = () =>
		document.documentElement.classList.contains('dark') ? ('dark' as const) : ('light' as const);
	const styles = () => {
		const css = getComputedStyle(document.documentElement);
		return hostStyles((t) => css.getPropertyValue(t));
	};
	const dimensions = () => {
		const r = box?.getBoundingClientRect() ?? { width: 0, height: 0 };
		return mode === 'fullscreen'
			? { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) }
			: containerDimensions(r, fill, MAX_HEIGHT);
	};

	// The bridge to one opened app: made when its frame is, gone with it (and nothing else reruns it).
	$effect(() => {
		if (!view || !frame) return;
		const app = view;
		const el = frame;
		return untrack(() => bridge(app, el));
	});

	function bridge(app: Ready, el: HTMLIFrameElement) {
		const sandboxOrigin = new URL(app.sandbox).origin;
		const at = ref;
		let initialized = false;
		let declaredModes: DisplayMode[] | null = null;
		let lastDims = '';
		const run = runApp(at, token()).catch((e: Error) => ({
			ok: false as const,
			reason: e.message
		}));

		const post = (m: unknown) => el.contentWindow?.postMessage(m, sandboxOrigin);
		const handlers: AppHandlers = {
			context: () =>
				hostContext({
					tool: app.tool,
					theme: theme(),
					styles: styles(),
					displayMode: mode,
					dimensions: dimensions(),
					locale: navigator.language,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					hover: matchMedia('(hover: hover)').matches,
					touch: matchMedia('(pointer: coarse)').matches,
					version: version()
				}),
			async callTool(name, toolArgs) {
				let r = await callAppTool(at, { name, arguments: toolArgs, confirmed: false }, token());
				if (!r.ok && r.confirm) {
					const yes = await ask({
						kind: 'tool',
						title: r.confirm.title,
						description: r.confirm.description,
						args: JSON.stringify(toolArgs, null, 2)
					});
					if (!yes) throw new RpcError(DENIED, 'The captain declined the call.');
					r = await callAppTool(at, { name, arguments: toolArgs, confirmed: true }, token());
				}
				if (!r.ok) throw new RpcError(DENIED, r.reason);
				return r.result;
			},
			async readResource(uri) {
				const r = await readAppResource(at, uri, token());
				if (!r.ok) throw new RpcError(DENIED, r.reason);
				return r.result;
			},
			async sendMessage(text) {
				if (!(await ask({ kind: 'message', text }))) return false;
				const sent = await sendToInbox(
					`From the “${title}” app (${plugin} plugin):\n\n${text}`,
					token()
				);
				if (!sent.ok) throw new RpcError(DENIED, sent.error);
				return true;
			},
			openLink(url) {
				window.open(addressRewrites.view(url), '_blank', 'noopener,noreferrer');
			},
			async displayMode(want) {
				const allowed = want === 'inline' || want === 'fullscreen';
				if (!allowed || (declaredModes && !declaredModes.includes(want))) return mode;
				if (want !== mode) await setMode(want);
				return mode;
			},
			resize({ height: h }) {
				// Full screen and a page the app fills have a fixed size; elsewhere it grows with the app.
				if (h !== undefined && !fill && mode === 'inline') {
					height = Math.max(40, Math.min(h, MAX_HEIGHT));
				}
			},
			log(level, data) {
				console.info(`[${plugin} app] ${level}:`, data);
			},
			initialized() {
				if (initialized) return;
				initialized = true;
				lastDims = JSON.stringify(dimensions());
				peer.notify('ui/notifications/tool-input', { arguments: app.input });
				void run.then((r) => {
					if (r.ok) {
						peer.notify('ui/notifications/tool-result', r.result);
					} else {
						note = `The app’s tool did not run: ${r.reason}`;
						peer.notify('ui/notifications/tool-cancelled', { reason: r.reason });
					}
				});
			}
		};
		const answerRequest = appRequestHandler(
			handlers,
			{ name: 'wheelhouse', version: version() },
			hostCapabilities({ ...app.csp })
		);
		const peer = new RpcPeer({
			send: post,
			onRequest: (method, params) => {
				if (method === 'ui/initialize') {
					const caps = (params as { appCapabilities?: { availableDisplayModes?: unknown } })
						?.appCapabilities;
					if (Array.isArray(caps?.availableDisplayModes)) {
						declaredModes = caps.availableDisplayModes as DisplayMode[];
					}
				}
				return answerRequest(method, params);
			},
			onNotification: appNotificationHandler(handlers)
		});

		async function setMode(want: DisplayMode) {
			mode = want;
			if (want === 'fullscreen' && box) await enterFullscreen(box);
			else leaveFullscreen(box);
			changed({ displayMode: mode });
		}
		exitFullscreen = () => void setMode('inline');

		function changed(extra: Record<string, unknown> = {}) {
			if (!initialized) return;
			const dims = dimensions();
			const key = JSON.stringify(dims);
			const update = { ...extra, ...(key !== lastDims ? { containerDimensions: dims } : {}) };
			lastDims = key;
			if (Object.keys(update).length) peer.notify('ui/notifications/host-context-changed', update);
		}

		let served = false;
		const onMessage = (event: MessageEvent) => {
			if (event.source !== el.contentWindow || event.origin !== sandboxOrigin) return;
			const m = event.data as { method?: unknown } | null;
			if (m && m.method === 'ui/notifications/sandbox-proxy-ready') {
				if (served) return;
				served = true;
				post({
					jsonrpc: '2.0',
					method: 'ui/notifications/sandbox-resource-ready',
					params: { html: app.html, csp: app.csp }
				});
				return;
			}
			peer.receive(event.data);
		};
		window.addEventListener('message', onMessage);

		// The theme toggle and the room the app has reach it as they change.
		const themeWatch = new MutationObserver(() =>
			changed({ theme: theme(), styles: { variables: styles() } })
		);
		themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
		const sizeWatch = new ResizeObserver(() => changed());
		if (box) sizeWatch.observe(box);
		const onFullscreen = () => {
			if (!document.fullscreenElement && mode === 'fullscreen') void setMode('inline');
		};
		document.addEventListener('fullscreenchange', onFullscreen);

		return () => {
			if (initialized) peer.request('ui/resource-teardown', {}, 1000).catch(() => {});
			peer.close();
			window.removeEventListener('message', onMessage);
			themeWatch.disconnect();
			sizeWatch.disconnect();
			document.removeEventListener('fullscreenchange', onFullscreen);
			leaveFullscreen(box);
			exitFullscreen = () => {};
		};
	}

	const bordered = $derived(view?.prefersBorder !== false);
</script>

{#if phase === 'opening'}
	<p class="text-sm text-muted-foreground {fill ? 'px-4 py-10 sm:px-6' : ''}" aria-busy="true">
		Opening the app…
	</p>
{:else if phase === 'service' && service}
	<div class="text-sm {fill ? 'px-4 py-10 sm:px-6' : ''}" data-app-service>
		<p>
			The app runs on {service.title}, which is not running.{service.reason
				? ` ${service.reason}`
				: ''}
		</p>
		{#if service.launchable}
			<Button class="mt-3" size="sm" disabled={starting} onclick={start}>
				{#if starting}<LoaderCircle class="size-4 animate-spin" aria-hidden="true" />Starting…
				{:else}<Play class="size-4" aria-hidden="true" />Start {service.title}{/if}
			</Button>
		{:else if service.hint}
			<p class="mt-2 text-muted-foreground">
				Start it by hand: <code class="font-mono text-xs select-all">{service.hint}</code>
			</p>
		{/if}
	</div>
{:else if phase === 'failed'}
	<p class="text-sm text-muted-foreground {fill ? 'px-4 py-10 sm:px-6' : ''}">
		Not available. {failure}
	</p>
{:else if view && sandboxSrc}
	<div
		bind:this={box}
		class={mode === 'fullscreen'
			? 'fixed inset-0 z-50 flex flex-col bg-background'
			: fill
				? 'flex min-h-0 flex-1 flex-col'
				: ''}
		data-app={'chat' in ref ? `chat/${ref.chat}` : `${ref.plugin}/${ref.contribution}`}
	>
		{#if mode === 'fullscreen'}
			<div class="flex shrink-0 items-center gap-3 border-b px-4 py-1.5 text-sm">
				<span class="min-w-0 flex-1 truncate">{title}</span>
				<Button variant="outline" size="sm" onclick={() => exitFullscreen()}>
					<Minimize2 class="size-4" aria-hidden="true" />Exit full screen
				</Button>
			</div>
		{/if}
		<iframe
			bind:this={frame}
			src={sandboxSrc}
			title={`${title}: an app from ${view.server.title}`}
			sandbox="allow-scripts allow-same-origin allow-forms"
			referrerpolicy="no-referrer"
			class="block w-full {mode === 'fullscreen' || fill ? 'min-h-0 flex-1' : ''} {bordered &&
			mode === 'inline'
				? 'rounded-md border bg-card'
				: ''}"
			style:height={mode === 'inline' && !fill ? `${height}px` : null}
		></iframe>
	</div>
	<p class="text-xs text-muted-foreground {fill ? 'px-4 pt-1.5 sm:px-6' : 'mt-1.5'}" data-app-note>
		An MCP app from {view.server.title}, in a sandbox{origins.length
			? `; it may reach ${origins.join(', ')}`
			: ', with no network access'}.{note ? ` ${note}` : ''}
	</p>
{/if}

<dialog
	bind:this={dialog}
	class="m-auto w-[min(94vw,560px)] max-w-none rounded-xl border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/60"
	onclose={() => {
		if (!dialog?.open) asking?.answer(false);
	}}
	aria-labelledby="app-ask-title"
>
	{#if asking}
		<div class="px-5 py-4">
			{#if asking.kind === 'tool'}
				<h2 id="app-ask-title" class="text-lg">Let the app run “{asking.title}”?</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					The {title} app asks {serverTitle} to run a tool that does not say it only reads, so it may
					change something.{asking.description ? ` ${asking.description}` : ''}
				</p>
				<pre
					class="mt-3 max-h-60 overflow-auto rounded-md border bg-card px-3 py-2 font-mono text-xs"
					aria-label="Its arguments">{asking.args}</pre>
			{:else}
				<h2 id="app-ask-title" class="text-lg">Send this to Firstmate?</h2>
				<p class="mt-1 text-sm text-muted-foreground">
					The {title} app wrote it. It goes as a message from you, marked as from the app.
				</p>
				<p
					class="mt-3 max-h-60 overflow-auto rounded-md border bg-card px-3 py-2 text-sm whitespace-pre-wrap"
				>
					{asking.text}
				</p>
			{/if}
			<div class="mt-4 flex flex-wrap justify-end gap-2">
				<Button variant="outline" onclick={() => asking?.answer(false)}>No</Button>
				<Button onclick={() => asking?.answer(true)}
					>{asking.kind === 'tool' ? 'Run it once' : 'Send it'}</Button
				>
			</div>
		</div>
	{/if}
</dialog>
