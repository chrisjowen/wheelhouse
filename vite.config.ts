import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

interface RuntimeHolder {
	upgrade?: (r: IncomingMessage, s: Duplex, h: Buffer) => boolean;
	request?: (r: IncomingMessage, s: ServerResponse) => boolean;
}
const runtimeHolder = () =>
	(globalThis as Record<symbol, RuntimeHolder | undefined>)[Symbol.for('wheelhouse.runtime')];

/**
 * In development, hand session-terminal WebSocket upgrades, and requests and
 * upgrades for plugins' host routes (*.localhost), to Wheelhouse's runtime, as the CLI's server
 * does in production (src/lib/server/runtime.ts). Vite's own HMR socket and
 * anything else are left alone.
 */
const sessionTerminals = (): Plugin => ({
	name: 'wheelhouse-session-terminals',
	configureServer(server) {
		server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
			runtimeHolder()?.upgrade?.(req, socket, head);
		});
		server.middlewares.use((req, res, next) => {
			if (!runtimeHolder()?.request?.(req, res)) next();
		});
	}
});

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), sessionTerminals()],
	server: { host: '127.0.0.1' },
	preview: { host: '127.0.0.1' },
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts', 'cli/**/*.test.ts'],
					exclude: ['src/**/*.dom.test.ts']
				}
			},
			{
				// Components mounted in a simulated browser: `*.dom.test.ts`.
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'dom',
					environment: 'happy-dom',
					include: ['src/**/*.dom.test.ts']
				}
			},
			{
				extends: true,
				test: {
					name: 'smoke',
					environment: 'node',
					include: ['tests/smoke/**/*.test.ts'],
					testTimeout: 60_000,
					hookTimeout: 60_000
				}
			}
		]
	}
});
