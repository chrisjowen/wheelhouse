import { cleanCsp, cspHeader } from '../../apps/csp';
import {
	APP_MIME,
	LEGACY_RESOURCE_KEY,
	type AppCallView,
	type AppOpenView,
	type AppRef,
	type CallToolResult,
	type McpTool,
	type ReadResourceResult,
	type Visibility
} from '../../apps/types';
import type { ServiceView } from '../../plugins/types';
import type { AppTarget } from '../plugins/registry';
import type { ServiceResolution } from '../plugins/types';
import { McpError, McpHttpClient } from './mcp';

/**
 * Wheelhouse as an MCP Apps host. A contribution with `render: { app }` names
 * a tool on one of its plugin's MCP servers, which runs on that plugin's
 * companion service; Wheelhouse connects to it over HTTP, reads the tool's UI
 * resource, calls the tool with the provider's arguments and hands both to the
 * page, which draws the app in a sandboxed frame on its own origin. What the
 * app then asks for comes back here and is checked:
 *
 * - `tools/call` reaches only its own server, and only tools whose visibility
 *   includes "app". A tool that says it is read-only (`readOnlyHint`) runs; any
 *   other runs only once the captain agrees to that one call.
 * - `resources/read` reaches only its own server.
 *
 * Every call an app makes is logged, as is each app's policy when it opens.
 * Wheelhouse connects to no MCP server but those plugins declare, and only on
 * loopback.
 */

const TOOLS_TTL_MS = 30_000;
const ENDPOINT_TTL_MS = 60_000;
const MAX_TOOL_PAGES = 20;
const MAX_HTML = 4 * 1024 * 1024;
const RUN_TIMEOUT_MS = 60_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface AppHostDeps {
	/** The plugin registry: app contributions and companion services. */
	registry: {
		app(ref: AppRef): Promise<AppTarget | null>;
		service(
			plugin: string,
			service: string,
			project: string | null
		): Promise<{ title: string; resolution: ServiceResolution } | null>;
	};
	/** A companion service's status, as `/api/services` answers. */
	serviceView(q: {
		plugin: string;
		service: string;
		project: string | null;
	}): Promise<ServiceView | null>;
	/** The sandbox page's address, or why there is none. */
	sandbox(): { url: string } | { reason: string };
	version: string;
	fetch?: typeof fetch;
	log?: (line: string) => void;
	now?: () => number;
}

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const unavailable = (reason: string): AppOpenView => ({
	schema: 'wheelhouse-app.v1',
	state: 'unavailable',
	reason
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Where a tool's UI is (`_meta.ui.resourceUri`, or the deprecated flat key), if it has one. */
export function resourceUri(tool: McpTool): string | null {
	const meta = tool._meta ?? {};
	const ui = isRecord(meta.ui) ? meta.ui : {};
	const uri = typeof ui.resourceUri === 'string' ? ui.resourceUri : meta[LEGACY_RESOURCE_KEY];
	return typeof uri === 'string' && uri.startsWith('ui://') ? uri : null;
}

/** Who may call a tool; both the agent and the app unless it says otherwise. */
export function visibility(tool: McpTool): Visibility[] {
	const ui = isRecord(tool._meta?.ui) ? (tool._meta!.ui as Record<string, unknown>) : {};
	const v = ui.visibility;
	return Array.isArray(v)
		? v.filter((x): x is Visibility => x === 'model' || x === 'app')
		: ['model', 'app'];
}

const toolTitle = (t: McpTool) => t.title ?? t.annotations?.title ?? t.name;

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

export class AppHost {
	private readonly clients = new Map<string, McpHttpClient>();
	private readonly tools = new Map<string, { at: number; tools: Promise<McpTool[]> }>();
	private readonly endpoints = new Map<string, { at: number; url: Promise<Result<string>> }>();
	private readonly logged = new Set<string>();
	private readonly now: () => number;
	private readonly log: (line: string) => void;

	constructor(private readonly deps: AppHostDeps) {
		this.now = deps.now ?? Date.now;
		this.log = deps.log ?? ((line) => console.log(line));
	}

	/**
	 * Everything the page needs to draw the app: its HTML and policy, the tool
	 * and its arguments, and the sandbox. When the server's service does not
	 * answer, its status instead, so the page can offer Launch.
	 */
	async open(ref: AppRef): Promise<AppOpenView | null> {
		const target = await this.deps.registry.app(ref);
		if (!target) return null;
		const server = { id: target.server.id, title: target.server.title };
		if (!target.args.available) return unavailable(target.args.reason);
		const sandbox = this.deps.sandbox();
		if (!('url' in sandbox)) return unavailable(sandbox.reason);
		const view = await this.deps.serviceView({
			plugin: target.plugin.id,
			service: target.server.service,
			project: target.serviceProject
		});
		if (!view) return unavailable(`${target.plugin.name} has no such service here.`);
		if (view.state !== 'running') {
			return { schema: 'wheelhouse-app.v1', state: 'service', server, service: view };
		}
		const url = endpointUrl(view.url, target.server.path);
		if (!url.ok) return unavailable(url.reason);
		this.endpoints.set(this.endpointKey(target), {
			at: this.now(),
			url: Promise.resolve(url)
		});
		try {
			const tool = (await this.listTools(url.value)).find((t) => t.name === target.tool);
			if (!tool) {
				return unavailable(`${target.server.title} has no tool “${target.tool}”.`);
			}
			const uri = resourceUri(tool);
			if (!uri) return unavailable(`${target.server.title}’s “${target.tool}” has no app.`);
			const read = await this.client(url.value).request('resources/read', { uri });
			const html = appHtml(read as ReadResourceResult, uri);
			if (!html.ok)
				return unavailable(`${target.server.title}’s app could not be read: ${html.reason}`);
			const csp = cleanCsp(html.value.meta.csp);
			const audit = `${url.value} ${uri} ${cspHeader(csp)}`;
			if (!this.logged.has(audit)) {
				this.logged.add(audit);
				this.log(
					`MCP app ${target.plugin.id}/${target.server.id} ${uri} opened with: ${cspHeader(csp)}`
				);
			}
			return {
				schema: 'wheelhouse-app.v1',
				state: 'ready',
				server,
				tool,
				html: html.value.html,
				csp,
				prefersBorder:
					typeof html.value.meta.prefersBorder === 'boolean' ? html.value.meta.prefersBorder : null,
				input: target.args.value,
				sandbox: sandbox.url
			};
		} catch (e) {
			this.forget(url.value);
			return unavailable(`${target.server.title} did not answer: ${message(e)}`);
		}
	}

	/** Wheelhouse's own call of the app's tool, with the provider's arguments. */
	async run(ref: AppRef): Promise<AppCallView<CallToolResult> | null> {
		const target = await this.deps.registry.app(ref);
		if (!target) return null;
		if (!target.args.available) return { ok: false, reason: target.args.reason };
		const args = target.args.value;
		return this.withServer(target, (client) =>
			client
				.request('tools/call', { name: target.tool, arguments: args }, RUN_TIMEOUT_MS)
				.then(toolResult)
		);
	}

	/**
	 * A `tools/call` the app made, under the policy above. `confirmed` says the
	 * captain agreed to this one call, which the page asks before it sends it.
	 */
	async call(
		ref: AppRef,
		name: string,
		args: Record<string, unknown>,
		confirmed: boolean
	): Promise<AppCallView<CallToolResult> | null> {
		const target = await this.deps.registry.app(ref);
		if (!target) return null;
		const at = `MCP app ${target.plugin.id}/${target.server.id}`;
		return this.withServer(target, async (client, url) => {
			const tool =
				(await this.listTools(url)).find((t) => t.name === name) ??
				(await this.listTools(url, true)).find((t) => t.name === name);
			if (!tool) {
				this.log(`${at}: refused a call of ${name}, which its server does not have.`);
				return {
					ok: false,
					refused: true,
					reason: `${target.server.title} has no tool “${name}”.`
				};
			}
			if (!visibility(tool).includes('app')) {
				this.log(`${at}: refused a call of ${name}, which is not offered to apps.`);
				return { ok: false, refused: true, reason: `“${name}” is not offered to apps.` };
			}
			const readOnly = tool.annotations?.readOnlyHint === true;
			if (!readOnly && !confirmed) {
				return {
					ok: false,
					reason: `“${toolTitle(tool)}” may change something, so it runs only once you agree.`,
					confirm: {
						tool: tool.name,
						title: toolTitle(tool),
						description: tool.description ?? null
					}
				};
			}
			this.log(
				`${at}: the app called ${name}${readOnly ? ' (read-only)' : ' (the captain agreed)'}.`
			);
			return client
				.request('tools/call', { name, arguments: args }, RUN_TIMEOUT_MS)
				.then(toolResult);
		});
	}

	/** A `resources/read` the app made, from its own server only. */
	async read(ref: AppRef, uri: string): Promise<AppCallView<ReadResourceResult> | null> {
		const target = await this.deps.registry.app(ref);
		if (!target) return null;
		return this.withServer(target, async (client) => {
			const r = await client.request('resources/read', { uri });
			if (!Array.isArray(r.contents)) {
				return { ok: false, reason: 'the server answered with no contents.' };
			}
			return { ok: true, result: r as ReadResourceResult };
		});
	}

	private async withServer<T>(
		target: AppTarget,
		work: (client: McpHttpClient, url: string) => Promise<AppCallView<T>>
	): Promise<AppCallView<T>> {
		const url = await this.endpoint(target);
		if (!url.ok) return { ok: false, reason: url.reason };
		try {
			return await work(this.client(url.value), url.value);
		} catch (e) {
			if (!(e instanceof McpError) || e.code === null) this.forget(url.value);
			return { ok: false, reason: `${target.server.title}: ${message(e)}` };
		}
	}

	private endpointKey(t: AppTarget) {
		return `${t.plugin.id}/${t.server.id}@${t.serviceProject ?? ''}`;
	}

	/** The MCP endpoint for a target's server, from its service's address (kept for a minute). */
	private endpoint(t: AppTarget): Promise<Result<string>> {
		const key = this.endpointKey(t);
		const hit = this.endpoints.get(key);
		if (hit && this.now() - hit.at < ENDPOINT_TTL_MS) return hit.url;
		const url = this.deps.registry
			.service(t.plugin.id, t.server.service, t.serviceProject)
			.then((found): Result<string> => {
				if (!found) return { ok: false, reason: `${t.plugin.name} has no such service here.` };
				if (!found.resolution.available) return { ok: false, reason: found.resolution.reason };
				return endpointUrl(found.resolution.spec.url, t.server.path);
			});
		this.endpoints.set(key, { at: this.now(), url });
		void url.then((r) => {
			if (!r.ok) this.endpoints.delete(key);
		});
		return url;
	}

	private client(url: string): McpHttpClient {
		let c = this.clients.get(url);
		if (!c) {
			c = new McpHttpClient({
				url,
				clientInfo: { name: 'wheelhouse', version: this.deps.version },
				fetch: this.deps.fetch
			});
			this.clients.set(url, c);
		}
		return c;
	}

	/** Drop a server's connection and what it said, so the next request starts afresh. */
	private forget(url: string) {
		this.clients.delete(url);
		this.tools.delete(url);
	}

	/** The server's tools (every page of them), kept for 30 s unless `fresh`. */
	private listTools(url: string, fresh = false): Promise<McpTool[]> {
		const hit = this.tools.get(url);
		if (hit && !fresh && this.now() - hit.at < TOOLS_TTL_MS) return hit.tools;
		const tools = (async () => {
			const all: McpTool[] = [];
			let cursor: string | undefined;
			for (let page = 0; page < MAX_TOOL_PAGES; page++) {
				const r = await this.client(url).request('tools/list', cursor ? { cursor } : {});
				for (const t of Array.isArray(r.tools) ? r.tools : []) {
					if (isRecord(t) && typeof t.name === 'string') all.push(t as unknown as McpTool);
				}
				cursor = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
				if (!cursor) break;
			}
			return all;
		})();
		this.tools.set(url, { at: this.now(), tools });
		tools.catch(() => this.tools.delete(url));
		return tools;
	}
}

/** The MCP endpoint `path` on a service's address, if it stays an http(s) address on loopback. */
export function endpointUrl(serviceUrl: string | null, path: string): Result<string> {
	let url: URL;
	try {
		url = new URL(path, serviceUrl ?? undefined);
	} catch {
		return { ok: false, reason: 'its MCP server has no address Wheelhouse can use.' };
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK.has(url.hostname)) {
		return { ok: false, reason: 'its MCP server is not on this computer (loopback).' };
	}
	return { ok: true, value: url.href };
}

/** A tool's result, if it has the shape of one. */
function toolResult(r: Record<string, unknown>): AppCallView<CallToolResult> {
	if (!Array.isArray(r.content)) return { ok: false, reason: 'the tool answered with no content.' };
	return { ok: true, result: r as CallToolResult };
}

/** The app's HTML and its `_meta.ui`, from a `resources/read` answer. */
export function appHtml(
	r: ReadResourceResult,
	uri: string
): Result<{ html: string; meta: Record<string, unknown> }> {
	const contents = Array.isArray(r?.contents) ? r.contents.filter(isRecord) : [];
	const item = contents.find((c) => c.uri === uri) ?? contents[0];
	if (!item) return { ok: false, reason: 'the server sent no content.' };
	const mime = String(item.mimeType ?? '')
		.replace(/\s+/g, '')
		.toLowerCase();
	if (mime !== APP_MIME) {
		return { ok: false, reason: `it is ${item.mimeType ?? 'of no type'}, not ${APP_MIME}.` };
	}
	let html: string;
	if (typeof item.text === 'string') html = item.text;
	else if (typeof item.blob === 'string') html = Buffer.from(item.blob, 'base64').toString('utf8');
	else return { ok: false, reason: 'it has neither text nor a blob.' };
	if (Buffer.byteLength(html) > MAX_HTML) return { ok: false, reason: 'it is larger than 4 MiB.' };
	const meta = isRecord(item._meta) && isRecord(item._meta.ui) ? item._meta.ui : {};
	return { ok: true, value: { html, meta } };
}
