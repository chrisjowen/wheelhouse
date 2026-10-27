import type { SlotEntry } from './types';

/**
 * Custom elements from installed plugins' UI bundles. A contribution with
 * `render: { element: '<plugin>-<name>' }` is drawn by the element of that tag,
 * which the plugin's bundle defines (`customElements.define`). The page imports
 * the bundle once, waits for the tag to be defined, creates the element and
 * hands it the provider's value as its `data` property and the slot entry as
 * `entry`; a later value is set on the same element. The element mounts in the
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

/** An element that carries the plugin's data. */
export type PluginElement = HTMLElement & { data?: unknown; entry?: SlotEntry };

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
	el.entry = o.entry;
	el.data = o.data;
	host.append(el);
	return el;
}
