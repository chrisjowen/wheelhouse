import type { ServiceView } from '../plugins/types';

/**
 * MCP Apps (the `io.modelcontextprotocol/ui` extension, stable spec
 * 2026-01-26): the parts of the protocol Wheelhouse speaks as a host, and the
 * views its `/api/apps/*` routes answer with. Shared by the server and the
 * browser.
 */

/** The extension's id, advertised to servers in `initialize`. */
export const UI_EXTENSION = 'io.modelcontextprotocol/ui';
/** The one UI resource type: an HTML document. */
export const APP_MIME = 'text/html;profile=mcp-app';
/** The MCP Apps protocol version Wheelhouse speaks to a view. */
export const APPS_PROTOCOL = '2026-01-26';

/** An MCP tool, as `tools/list` describes it (the fields Wheelhouse reads). */
export interface McpTool {
	name: string;
	title?: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: {
		title?: string;
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
	_meta?: Record<string, unknown>;
}

/** A tool's result: content blocks, optional structured content, and whether it failed. */
export interface CallToolResult {
	content: unknown[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
	_meta?: Record<string, unknown>;
	[key: string]: unknown;
}

/** What `resources/read` answers. */
export interface ReadResourceResult {
	contents: {
		uri: string;
		mimeType?: string;
		text?: string;
		blob?: string;
		_meta?: Record<string, unknown>;
	}[];
	[key: string]: unknown;
}

/** The origins an app's resource declares it needs (`_meta.ui.csp`). */
export interface AppCsp {
	connectDomains?: string[];
	resourceDomains?: string[];
	frameDomains?: string[];
	baseUriDomains?: string[];
}

export type DisplayMode = 'inline' | 'fullscreen' | 'pip';

/** Who may call a tool: the agent (`model`), the server's own app (`app`), or both (the default). */
export type Visibility = 'model' | 'app';

/** Which plugin contribution an app request is for: the entry's own place. */
export interface AppRef {
	plugin: string;
	contribution: string;
	project: string | null;
	task: string | null;
}

/** What `POST /api/apps/open` answers. */
export type AppOpenView =
	| {
			schema: 'wheelhouse-app.v1';
			state: 'ready';
			/** The plugin's MCP server the app comes from. */
			server: { id: string; title: string };
			tool: McpTool;
			/** The app's HTML, sent to the sandbox once it is ready. */
			html: string;
			/** The origins the app may reach: only those it declared that Wheelhouse can express. */
			csp: AppCsp;
			/** Whether the app asked for a visible border, if it said. */
			prefersBorder: boolean | null;
			/** The tool's arguments: the contribution's provider value. */
			input: Record<string, unknown>;
			/** The sandbox page, on its server's own loopback origin, with the app's signed policy. */
			sandbox: string;
	  }
	| {
			schema: 'wheelhouse-app.v1';
			/** The server's companion service does not answer; `service` says how to start it. */
			state: 'service';
			server: { id: string; title: string };
			service: ServiceView;
	  }
	| { schema: 'wheelhouse-app.v1'; state: 'unavailable'; reason: string };

/** What `POST /api/apps/run`, `/call` and `/read` answer. */
export type AppCallView<T> =
	| { ok: true; result: T }
	| {
			ok: false;
			reason: string;
			/** Wheelhouse's policy refused it (not a failure of the server). */
			refused?: boolean;
			/** Set when the tool may change something: the captain must agree to this one call first. */
			confirm?: { tool: string; title: string; description: string | null };
	  };
