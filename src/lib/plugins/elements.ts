import type { PreviewContext, ServiceView, SlotEntry } from './types';

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

/** A feedback list a plugin's element sends to Firstmate about one task. */
export interface FeedbackList {
	/** The task it is about; the entry's own task when left out. */
	task?: string | null;
	/** What the list is about, in a few words (e.g. "data/x/plan.md: Request changes"). */
	subject?: string | null;
	/** One change per line, with what it points at (e.g. a quote and its line). */
	items: { text: string; points?: string | null }[];
}

/** Whether Firstmate's inbox took the list (`pending`: Wheelhouse is still confirming it), or why not. */
export type FeedbackResult = { ok: true; pending: boolean } | { ok: false; error: string };

/**
 * A feedback list tidied by the preview helper: points for the worker, each
 * with what it points at and the list's items (numbered from 1) it came from;
 * or why there are none.
 */
export type SummaryResult =
	| { ok: true; points: { text: string; points: string | null; from: number[] }[] }
	| { ok: false; error: string };

/**
 * What the page lets a plugin's element do: read and, on the captain's click,
 * start the plugin's own companion services, and, for a plugin with the
 * `feedback` capability, have the preview helper tidy a feedback list and send
 * Firstmate one. The plugin is the
 * element's own, fixed when the host is made, and the page supplies the
 * session token, so the element need not handle it (it is not hidden: the
 * element runs with the page's permissions).
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
	/**
	 * Send Firstmate one feedback list about a task, as the Preview tab's list
	 * goes, attributed to this plugin. Only for a plugin whose manifest asks
	 * for the `feedback` capability, and only from the captain's click: it is
	 * refused, with the reason, otherwise.
	 */
	sendFeedback(list: FeedbackList): Promise<FeedbackResult>;
	/**
	 * Have the preview helper tidy a feedback list into points the captain can
	 * edit and pick before sending them with `sendFeedback`. It sends nothing.
	 * The same capability and click as `sendFeedback`; refused, with the
	 * reason, otherwise, or when the helper cannot answer.
	 */
	summariseFeedback(list: FeedbackList): Promise<SummaryResult>;
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
	/** Post a plugin's feedback list (`POST /api/plugins/<id>/feedback`). */
	feedback: (
		plugin: string,
		body: { taskId: string; subject: string | null; items: FeedbackList['items'] },
		token: string
	) => Promise<FeedbackResult>;
	/** Have a plugin's feedback list tidied (`POST /api/plugins/<id>/feedback/summary`). */
	summarise?: (
		plugin: string,
		body: { taskId: string; subject: string | null; items: FeedbackList['items'] },
		token: string
	) => Promise<SummaryResult>;
	/** Whether the captain has just clicked or pressed a key (the page's transient activation). */
	clicked?: () => boolean;
	/** The page's session token, read at the click. */
	token: () => string;
}

/** The browser's transient activation; a browser that cannot tell is trusted. */
const justClicked = () =>
	typeof navigator === 'undefined' || !navigator.userActivation
		? true
		: navigator.userActivation.isActive;

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
	const listBody = (list: FeedbackList) => {
		const l = (typeof list === 'object' && list !== null ? list : {}) as Partial<FeedbackList>;
		const task = typeof l.task === 'string' && l.task ? l.task : (entry.taskId ?? null);
		if (!task) return null;
		return {
			taskId: task,
			subject: typeof l.subject === 'string' ? l.subject : null,
			items: Array.isArray(l.items) ? l.items : []
		};
	};
	return Object.freeze({
		pluginId: plugin,
		service: async (service: string, o: { project?: string | null } = {}) =>
			deps.status(ref(service, o.project)),
		launch: async (service: string, o: { project?: string | null; open?: string | null } = {}) =>
			deps.launch(
				ref(service, o.project),
				deps.token(),
				typeof o.open === 'string' ? o.open : null
			),
		sendFeedback: async (list: FeedbackList): Promise<FeedbackResult> => {
			// Read at the call, before anything awaits: the send must be the captain's click.
			if (!(deps.clicked ?? justClicked)()) {
				return { ok: false, error: 'Feedback is sent only when the captain clicks to send it.' };
			}
			const body = listBody(list);
			if (!body) return { ok: false, error: 'Name the task the feedback is about.' };
			return deps.feedback(plugin, body, deps.token());
		},
		summariseFeedback: async (list: FeedbackList): Promise<SummaryResult> => {
			// The helper runs only on the captain's click, as a send does.
			if (!(deps.clicked ?? justClicked)()) {
				return { ok: false, error: 'Feedback is summarised only when the captain clicks to.' };
			}
			if (!deps.summarise) return { ok: false, error: 'This page cannot summarise feedback.' };
			const body = listBody(list);
			if (!body) return { ok: false, error: 'Name the task the feedback is about.' };
			return deps.summarise(plugin, body, deps.token());
		}
	});
}

/** An element that carries the plugin's data. */
export type PluginElement = HTMLElement & {
	data?: unknown;
	entry?: SlotEntry;
	host?: PluginHost;
	/** A preview.action element: the preview it acts on. */
	preview?: PreviewContext;
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
