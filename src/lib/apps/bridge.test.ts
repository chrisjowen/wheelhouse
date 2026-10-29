import { describe, expect, it, vi } from 'vitest';
import {
	appNotificationHandler,
	appRequestHandler,
	DENIED,
	INVALID_PARAMS,
	METHOD_NOT_FOUND,
	parseMessage,
	RpcPeer,
	type AppHandlers,
	type RpcMessage
} from './bridge';
import { APPS_PROTOCOL } from './types';

function handlers(o: Partial<AppHandlers> = {}): AppHandlers {
	return {
		context: () => ({ theme: 'light' }),
		callTool: async (name) => ({ content: [{ type: 'text', text: name }] }),
		readResource: async (uri) => ({ contents: [{ uri, text: 'x' }] }),
		sendMessage: async () => true,
		openLink: () => {},
		displayMode: async (m) => m,
		resize: () => {},
		log: () => {},
		initialized: () => {},
		...o
	};
}

/** A peer answering through `h`, and every message it sent. */
function peer(h: AppHandlers) {
	const sent: RpcMessage[] = [];
	const p = new RpcPeer({
		send: (m) => sent.push(m),
		onRequest: appRequestHandler(h, { name: 'wheelhouse', version: '1.2.3' }, { openLinks: {} }),
		onNotification: appNotificationHandler(h)
	});
	const ask = async (method: string, params?: unknown) => {
		const id = sent.length + 100;
		p.receive({ jsonrpc: '2.0', id, method, params });
		await vi.waitFor(() => expect(sent.find((m) => m.id === id)).toBeDefined());
		return sent.find((m) => m.id === id)!;
	};
	return { p, sent, ask };
}

describe('the app bridge', () => {
	it('drops anything that is not well-formed JSON-RPC', () => {
		expect(parseMessage(null)).toBeNull();
		expect(parseMessage('{"jsonrpc":"2.0"}')).toBeNull();
		expect(parseMessage({ jsonrpc: '1.0', id: 1, method: 'ping' })).toBeNull();
		expect(parseMessage({ jsonrpc: '2.0' })).toBeNull();
		expect(parseMessage({ jsonrpc: '2.0', id: {}, method: 'ping' })).toBeNull();
		expect(parseMessage({ jsonrpc: '2.0', method: 7 })).toBeNull();
		expect(parseMessage({ jsonrpc: '2.0', id: 1, method: 'ping' })).not.toBeNull();
	});

	it('answers ui/initialize with the host, its capabilities and its context', async () => {
		const { ask } = peer(handlers());
		expect(
			await ask('ui/initialize', {
				protocolVersion: APPS_PROTOCOL,
				appInfo: { name: 'a', version: '1' },
				appCapabilities: {}
			})
		).toMatchObject({
			result: {
				protocolVersion: APPS_PROTOCOL,
				hostInfo: { name: 'wheelhouse', version: '1.2.3' },
				hostCapabilities: { openLinks: {} },
				hostContext: { theme: 'light' }
			}
		});
	});

	it('passes tool calls and reads to the page’s handlers, which name no other server', async () => {
		const callTool = vi.fn(async () => ({ content: [], structuredContent: { n: 1 } }));
		const { ask } = peer(handlers({ callTool }));
		expect(await ask('tools/call', { name: 'refresh', arguments: { a: 1 } })).toMatchObject({
			result: { structuredContent: { n: 1 } }
		});
		expect(callTool).toHaveBeenCalledWith('refresh', { a: 1 });
		expect(await ask('tools/call', {})).toMatchObject({ error: { code: INVALID_PARAMS } });
		expect(await ask('resources/read', { uri: 'ui://x/y' })).toMatchObject({
			result: { contents: [{ uri: 'ui://x/y' }] }
		});
	});

	it('opens http(s) links only', async () => {
		const openLink = vi.fn();
		const { ask } = peer(handlers({ openLink }));
		expect(await ask('ui/open-link', { url: 'https://example.com/a' })).toMatchObject({
			result: {}
		});
		expect(openLink).toHaveBeenCalledWith('https://example.com/a');
		expect(await ask('ui/open-link', { url: 'javascript:alert(1)' })).toMatchObject({
			error: { code: DENIED }
		});
		expect(await ask('ui/open-link', { url: 'file:///etc/passwd' })).toMatchObject({
			error: { code: DENIED }
		});
		expect(openLink).toHaveBeenCalledTimes(1);
	});

	it('sends a message only when the captain agrees, and says so when not', async () => {
		const sendMessage = vi.fn(async (text: string) => text === 'yes please');
		const { ask } = peer(handlers({ sendMessage }));
		const msg = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] });
		expect(await ask('ui/message', msg('yes please'))).toMatchObject({ result: {} });
		expect(await ask('ui/message', msg('no thanks'))).toMatchObject({
			error: { code: DENIED, message: 'Message sending denied' }
		});
		expect(await ask('ui/message', { role: 'user', content: [{ type: 'image' }] })).toMatchObject({
			error: { code: INVALID_PARAMS }
		});
		expect(sendMessage).toHaveBeenCalledTimes(2);
	});

	it('refuses what this host does not offer', async () => {
		const { ask } = peer(handlers());
		for (const method of [
			'ui/update-model-context',
			'ui/download-file',
			'sampling/createMessage',
			'tools/list'
		]) {
			expect(await ask(method, {})).toMatchObject({ error: { code: METHOD_NOT_FOUND } });
		}
	});

	it('acts on the view’s notifications and ignores the rest', () => {
		const h = handlers({ initialized: vi.fn(), resize: vi.fn(), log: vi.fn() });
		const { p, sent } = peer(h);
		p.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized' });
		p.receive({
			jsonrpc: '2.0',
			method: 'ui/notifications/size-changed',
			params: { height: 240, width: -5 }
		});
		p.receive({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'warning' } });
		p.receive({ jsonrpc: '2.0', method: 'ui/notifications/whatever' });
		expect(h.initialized).toHaveBeenCalledOnce();
		expect(h.resize).toHaveBeenCalledWith({ height: 240, width: undefined });
		expect(h.log).toHaveBeenCalledWith('warning', undefined);
		expect(sent).toEqual([]);
	});

	it('matches its own requests to the view’s answers, and gives up on silence', async () => {
		vi.useFakeTimers();
		try {
			const sent: RpcMessage[] = [];
			const p = new RpcPeer({
				send: (m) => sent.push(m),
				onRequest: () => ({}),
				onNotification: () => {}
			});
			const done = p.request('ui/resource-teardown', {});
			p.receive({ jsonrpc: '2.0', id: sent[0].id, result: { bye: true } });
			await expect(done).resolves.toEqual({ bye: true });
			const silent = p.request('ui/resource-teardown', {}, 500);
			vi.advanceTimersByTime(600);
			await expect(silent).rejects.toThrow('did not answer');
			p.notify('ui/notifications/tool-input', { arguments: {} });
			p.close();
			p.notify('ui/notifications/tool-result', { content: [] });
			expect(sent.map((m) => m.method)).toEqual([
				'ui/resource-teardown',
				'ui/resource-teardown',
				'ui/notifications/tool-input'
			]);
		} finally {
			vi.useRealTimers();
		}
	});
});
