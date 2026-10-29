import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * An example plugin with one MCP app. Its companion service `mcp` runs the
 * MCP server in `../../mcp/server.mjs` on a port of its own; `mcpServers`
 * says that server's MCP endpoint is `/mcp` on that service's address; and
 * the `status` page draws the UI of its `show_status` tool, with the
 * arguments its provider returns. A `port` in its settings (plugins.json)
 * fixes the server's port, as Wheelhouse's smoke test does.
 *
 * @typedef {import('../../../../../packages/plugin-sdk/index.js').WheelhousePlugin} WheelhousePlugin
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/** @type {WheelhousePlugin} */
export default {
	providers: [
		{
			id: 'status-args',
			scope: 'fleet',
			ttlMs: 60_000,
			async fetch(ctx) {
				const n = ctx.tasks.length;
				return {
					available: true,
					value: { name: `the captain (${n} task${n === 1 ? '' : 's'} in the fleet)` },
					source: 'the fleet',
					observedAt: null
				};
			}
		}
	],
	contributions: [
		{
			slot: 'nav.page',
			id: 'status',
			title: 'Demo status',
			provider: 'status-args',
			render: { app: { server: 'demo', tool: 'show_status' } }
		}
	],
	services: [
		{
			id: 'mcp',
			title: 'the demo MCP server',
			scope: 'fleet',
			async resolve(ctx) {
				const port =
					typeof ctx.settings.port === 'number' ? ctx.settings.port : await ctx.servicePort(4391);
				const url = `http://127.0.0.1:${port}`;
				return {
					available: true,
					spec: {
						url,
						health: `${url}/health`,
						identity: { url: `${url}/health`, path: ['name'], value: 'mcp-app-demo' },
						argv: [process.execPath, path.join(root, 'mcp', 'server.mjs'), '--port', String(port)],
						cwd: root,
						binds: 'loopback'
					},
					hint: `node ${path.join(root, 'mcp', 'server.mjs')} --port ${port}`
				};
			}
		}
	],
	mcpServers: [{ id: 'demo', title: 'Demo server', service: 'mcp', path: '/mcp' }]
};
