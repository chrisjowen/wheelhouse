import type { DisplayMode, McpTool } from './types';

/**
 * What Wheelhouse tells an MCP app about where it is drawn (the spec's host
 * context): the theme, Wheelhouse's own colours and type under the spec's
 * style variables, the display mode, the room it has and the tool it shows.
 */

/** The spec's style variables, each from the Wheelhouse token that plays its part. */
export const STYLE_TOKENS: Record<string, string> = {
	'--color-background-primary': '--background',
	'--color-background-secondary': '--card',
	'--color-background-tertiary': '--muted',
	'--color-background-inverse': '--foreground',
	'--color-text-primary': '--foreground',
	'--color-text-secondary': '--muted-foreground',
	'--color-text-inverse': '--background',
	'--color-text-info': '--sea',
	'--color-text-danger': '--danger',
	'--color-text-success': '--success',
	'--color-text-warning': '--warning',
	'--color-border-primary': '--border',
	'--color-border-secondary': '--hair',
	'--color-ring-primary': '--ring',
	'--font-sans': '--font-sans',
	'--font-mono': '--font-mono',
	'--border-radius-md': '--radius'
};

/** The style variables, with the values `read` gives each Wheelhouse token (empty ones left out). */
export function hostStyles(read: (token: string) => string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, token] of Object.entries(STYLE_TOKENS)) {
		const v = read(token).trim();
		if (v) out[name] = v;
	}
	return out;
}

/**
 * How much room the app has: a page or tab it fills has a fixed size; a card
 * or section is as wide as its place and grows with the app, up to `maxHeight`.
 */
export function containerDimensions(
	size: { width: number; height: number },
	fill: boolean,
	maxHeight: number
): Record<string, number> {
	const width = Math.round(size.width);
	return fill ? { width, height: Math.round(size.height) } : { width, maxHeight };
}

export function hostContext(o: {
	tool: McpTool;
	theme: 'light' | 'dark';
	styles: Record<string, string>;
	displayMode: DisplayMode;
	dimensions: Record<string, number>;
	locale?: string;
	timeZone?: string;
	hover?: boolean;
	touch?: boolean;
	version: string;
}): Record<string, unknown> {
	return {
		toolInfo: { tool: o.tool },
		theme: o.theme,
		styles: { variables: o.styles },
		displayMode: o.displayMode,
		availableDisplayModes: ['inline', 'fullscreen'],
		containerDimensions: o.dimensions,
		...(o.locale ? { locale: o.locale } : {}),
		...(o.timeZone ? { timeZone: o.timeZone } : {}),
		userAgent: `wheelhouse/${o.version}`,
		platform: 'web',
		deviceCapabilities: { hover: o.hover ?? true, touch: o.touch ?? false }
	};
}

/** What the host offers the app (`hostCapabilities`): no model context, downloads or sampling. */
export function hostCapabilities(csp: Record<string, unknown>): Record<string, unknown> {
	return {
		openLinks: {},
		serverTools: {},
		serverResources: {},
		logging: {},
		message: { text: {} },
		sandbox: { csp }
	};
}
