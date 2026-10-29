import { afterEach, describe, expect, it } from 'vitest';
import { startMcpAppServer } from '../../../../tests/fixtures/mcp-app-demo/mcp/server.mjs';
import { McpError, McpHttpClient, PROTOCOL_VERSIONS } from './mcp';

type Server = Awaited<ReturnType<typeof startMcpAppServer>>;
let server: Server | null = null;
afterEach(async () => {
	await server?.close();
	server = null;
});

const client = (url: string) =>
	new McpHttpClient({ url, clientInfo: { name: 'wheelhouse', version: '9.9.9' } });

describe('the MCP client', () => {
	it('advertises the MCP Apps extension, so a server offers its UI tools', async () => {
		server = await startMcpAppServer();
		const c = client(`${server.url}/mcp`);
		expect(await c.connect()).toMatchObject({
			protocol: PROTOCOL_VERSIONS[0],
			serverInfo: { name: 'mcp-app-demo' }
		});
		expect(server.state.initialize[0]).toMatchObject({
			protocolVersion: PROTOCOL_VERSIONS[0],
			capabilities: {
				extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } }
			},
			clientInfo: { name: 'wheelhouse', version: '9.9.9' }
		});
		const { tools } = (await c.request('tools/list', {})) as {
			tools: { name: string; _meta?: unknown }[];
		};
		expect(tools.find((t) => t.name === 'show_status')?._meta).toEqual({
			ui: { resourceUri: 'ui://demo/status.html' }
		});
	});

	it('calls tools and reads resources, answered as JSON or as an event stream', async () => {
		for (const sse of [false, true]) {
			server = await startMcpAppServer({ sse });
			const c = client(`${server.url}/mcp`);
			expect(
				await c.request('tools/call', { name: 'show_status', arguments: { name: 'Ada' } })
			).toMatchObject({ structuredContent: { greeting: 'Hello, Ada!', count: 0 } });
			const read = (await c.request('resources/read', { uri: 'ui://demo/status.html' })) as {
				contents: { mimeType: string; text: string }[];
			};
			expect(read.contents[0].mimeType).toBe('text/html;profile=mcp-app');
			expect(read.contents[0].text).toContain('ui/initialize');
			await server.close();
			server = null;
		}
	});

	it('says what the server refused', async () => {
		server = await startMcpAppServer();
		const err = await client(`${server.url}/mcp`)
			.request('tools/call', { name: 'nope' })
			.catch((e) => e);
		expect(err).toBeInstanceOf(McpError);
		expect(err).toMatchObject({ code: -32602, message: 'Unknown tool nope' });
	});

	it('starts a new session when the server forgets the old one', async () => {
		server = await startMcpAppServer();
		const c = client(`${server.url}/mcp`);
		await c.request('tools/list', {});
		server.forgetSessions();
		await expect(c.request('tools/list', {})).resolves.toHaveProperty('tools');
		expect(server.state.initialize).toHaveLength(2);
	});

	it('says plainly when the server cannot be reached', async () => {
		server = await startMcpAppServer();
		const url = `${server.url}/mcp`;
		await server.close();
		server = null;
		await expect(client(url).connect()).rejects.toThrow('could not reach the MCP server');
	});
});
