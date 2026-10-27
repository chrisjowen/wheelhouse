import type { ServiceView, SlotEntry } from './types';

/**
 * Custom elements from installed plugins' UI bundles. A contribution with
 * `render: { element: '<plugin>-<name>' }` is drawn by the element of that tag,
 * which the plugin's bundle defines (`customElements.define`). The page imports
 * the bundle once, waits for the tag to be defined, creates the element and
 * hands it the provider's value as its `data` property, the slot entry as
 * `entry` and a small host API as `host`; a later value is set on the same
 * element. The element mounts in the
 * page itself (light DOM, or its own shadow root), so Wheelhouse's CSS
 * variables reach it either way.
 */

export const DEFINE_TIMEOUT_MS = 5_000;

export type Importer = (url: string) => Promise<unknown>;

const bundles = new Map<string, Promise<unknown>>();

/** Import a UI bundle once per page; a failed import is tried again next time. */
export function loadBundle(url: string, importer: Importer): Promise<unknown> {
	let p = bundles.get(url);
	if (!p) {
		p = importer(url).catch((e) => {
			bundles.delete(url);
			throw e;
		});
		bundles.set(url, p);
	}
	return p;
}

/**
 * What the page lets a plugin's element do: read and, on the captain's click,
 * start the plugin's own companion services. The plugin is the element's
 * own, fixed when the host is made, and the session token stays in the
 * page's closure; the element never sees it.
 */
export interface PluginHost {
	readonly pluginId: string;
	/** Whether one of this plugin's services is up; null when it declares no such service. */
	service(service: string, o?: { project?: string | null }): Promise<ServiceView | null>;
	/**
	 * Start one of this plugin's services and, once it answers, open `open` (or
	 * its own address) in a new tab. Call it from a click handler only.
	 */
	launch(
		service: string,
		o?: { project?: string | null; open?: string | null }
	): Promise<ServiceView | null>;
}

export interface HostDeps {
	status: (r: {
		plugin: string;
		service: string;
		project: string | null;
	}) => Promise<ServiceView | null>;
	launch: (
		r: { plugin: string; service: string; project: string | null },
		token: string,
		open: string | null
	) => Promise<ServiceView | null>;
	/** The page's session token, read at the click. */
	token: () => string;
}

/**
 * The host API for one entry's element: services of the entry's own plugin,
 * for the entry's project unless the element names another.
 */
export function pluginHost(entry: SlotEntry, deps: HostDeps): PluginHost {
	const plugin = entry.pluginId;
	const ref = (service: unknown, project: unknown) => {
		if (typeof service !== 'string' || !service) throw new TypeError('Name a service.');
		const p = project === undefined ? entry.projectId : project;
		return { plugin, service, project: typeof p === 'string' && p ? p : null };
	};
	return Object.freeze({
		pluginId: plugin,
		service: async (service: string, o: { project?: string | null } = {}) =>
			deps.status(ref(service, o.project)),
		launch: async (service: string, o: { project?: string | null; open?: string | null } = {}) =>
			deps.launch(ref(service, o.project), deps.token(), typeof o.open === 'string' ? o.open : null)
	});
}

/** An element that carries the plugin's data. */
export type PluginElement = HTMLElement & {
	data?: unknown;
	entry?: SlotEntry;
	host?: PluginHost;
};

/**
 * Define (by importing its bundle when it is not yet defined), create and
 * append the entry's element to `host`. Rejects with a plain reason.
 */
export async function mountElement(
	host: HTMLElement,
	o: {
		tag: string;
		ui: string | null | undefined;
		data: unknown;
		entry: SlotEntry;
		host?: PluginHost;
		importer?: Importer;
		timeoutMs?: number;
	}
): Promise<PluginElement> {
	if (!customElements.get(o.tag)) {
		if (!o.ui) throw new Error('this Wheelhouse has no UI bundle for it');
		try {
			await loadBundle(o.ui, o.importer ?? ((u) => import(/* @vite-ignore */ u)));
		} catch (e) {
			throw new Error(`its UI bundle did not load (${e instanceof Error ? e.message : String(e)})`);
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				customElements.whenDefined(o.tag),
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error(`its UI bundle does not define <${o.tag}>`)),
						o.timeoutMs ?? DEFINE_TIMEOUT_MS
					);
				})
			]);
		} finally {
			clearTimeout(timer);
		}
	}
	const el = document.createElement(o.tag) as PluginElement;
	if (o.host) el.host = o.host;
	el.entry = o.entry;
	el.data = o.data;
	host.append(el);
	return el;
}
