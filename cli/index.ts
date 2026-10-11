#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { version } from '../package.json';
import { checkCompatibility, resolveInstall } from '../src/lib/server/firstmate/install';
import { defaultStateDir, isInside } from '../src/lib/server/store/store';

/**
 * `wheelhouse open`: find Firstmate, check its integration scripts, start the
 * Wheelhouse server on loopback and open the browser. Wheelhouse attaches to an
 * existing Firstmate session; it never starts, stops or reconfigures Firstmate,
 * and closing it leaves Firstmate and its crew running. Messages to Firstmate
 * go only through its inbox script; Wheelhouse keeps its own record of them in
 * a state directory outside the Firstmate home.
 */

export const DEFAULT_PORT = 4310;
const HOST = '127.0.0.1';

type Handler = (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;

function parsePort(value: string): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0 || n > 65535) {
		throw new InvalidArgumentError('Port must be a whole number from 0 to 65535.');
	}
	return n;
}

/** The SvelteKit build sits next to the bundled CLI: dist/cli.js → build/handler.js. */
function handlerPath(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, '..', 'build', 'handler.js');
}

function openBrowser(url: string): void {
	const [cmd, args] =
		process.platform === 'darwin'
			? ['open', [url]]
			: process.platform === 'win32'
				? ['cmd', ['/c', 'start', '""', url]]
				: ['xdg-open', [url]];
	try {
		const child = spawn(cmd, args as string[], { detached: true, stdio: 'ignore' });
		child.on('error', () => console.log(`Open ${url} in your browser.`));
		child.unref();
	} catch {
		console.log(`Open ${url} in your browser.`);
	}
}

interface OpenOptions {
	firstmate?: string;
	home?: string;
	port: number;
	browser: boolean;
	stateDir?: string;
}

async function open(opts: OpenOptions): Promise<void> {
	const resolved = resolveInstall({
		firstmate: opts.firstmate,
		home: opts.home,
		cwd: process.cwd(),
		env: process.env
	});
	if (!resolved.ok) {
		console.error(`wheelhouse: ${resolved.error}`);
		process.exit(1);
	}
	const { install, notes } = resolved;
	for (const n of notes) console.log(n);
	console.log(`Firstmate:  ${install.firstmateDir}`);
	console.log(`Home:       ${install.homeDir}`);

	const compat = await checkCompatibility(install);
	if (compat.compatible) {
		console.log(
			`Scripts:    compatible${compat.firstmateVersion ? ` (Firstmate ${compat.firstmateVersion})` : ''}`
		);
	} else {
		console.warn('Warning: this Firstmate may not be compatible with Wheelhouse:');
		for (const p of compat.problems) console.warn(`  - ${p}`);
		console.warn('Wheelhouse will start and show what it can; see /api/health.');
	}

	const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : defaultStateDir(process.env);
	if (isInside(stateDir, install.homeDir)) {
		console.error(
			`wheelhouse: the state directory ${stateDir} is inside the Firstmate home. Wheelhouse never writes there; pass --state-dir <dir> outside it.`
		);
		process.exit(1);
	}
	console.log(`State:      ${stateDir}`);

	const file = handlerPath();
	if (!existsSync(file)) {
		console.error(
			`wheelhouse: the web app is not built (${file} is missing). Run \`npm run build\`.`
		);
		process.exit(1);
	}
	process.env.WHEELHOUSE_FIRSTMATE_DIR = install.firstmateDir;
	process.env.WHEELHOUSE_HOME = install.homeDir;
	process.env.WHEELHOUSE_STATE_DIR = stateDir;
	const { handler } = (await import(pathToFileURL(file).href)) as { handler: Handler };

	const server = createServer((req, res) => handler(req, res));
	await new Promise<void>((resolve) => {
		server.once('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				console.error(
					`wheelhouse: port ${opts.port} on ${HOST} is already in use. Pass --port <n> to pick another.`
				);
			} else {
				console.error(`wheelhouse: could not start the server: ${err.message}`);
			}
			process.exit(1);
		});
		server.listen(opts.port, HOST, () => resolve());
	});
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : opts.port;
	const url = `http://${HOST}:${port}/`;
	console.log(`Wheelhouse is listening on ${url}`);
	console.log('Press Ctrl+C to close Wheelhouse. Firstmate and its crew keep running.');
	if (opts.browser) openBrowser(url);

	let closing = false;
	const close = () => {
		if (closing) return;
		closing = true;
		const holder = (globalThis as Record<symbol, { shutdown?: () => void } | undefined>)[
			Symbol.for('wheelhouse.runtime')
		];
		holder?.shutdown?.();
		server.close(() => {
			console.log('Wheelhouse closed. Firstmate and its crew are still running.');
			process.exit(0);
		});
		server.closeAllConnections();
		setTimeout(() => process.exit(0), 3000).unref();
	};
	process.on('SIGINT', close);
	process.on('SIGTERM', close);
}

export function program(): Command {
	const cli = new Command('wheelhouse')
		.description('A local companion to Firstmate: watch the crew at work from a web UI.')
		.version(version);

	cli
		.command('open', { isDefault: true })
		.description('Start Wheelhouse against a running Firstmate and open it in the browser.')
		.option('--firstmate <dir>', 'Firstmate code directory (default: the checkout you are in)')
		.option(
			'--home <dir>',
			'Firstmate operational home (default: $FM_HOME, else the code directory)'
		)
		.option('--port <n>', 'port to listen on (127.0.0.1 only)', parsePort, DEFAULT_PORT)
		.option(
			'--state-dir <dir>',
			'where Wheelhouse keeps its message records (default: $WHEELHOUSE_STATE_DIR, else $XDG_STATE_HOME/wheelhouse, else ~/.local/state/wheelhouse)'
		)
		.option('--no-browser', 'do not open the browser')
		.action((opts: OpenOptions) => open(opts));
	return cli;
}

await program().parseAsync(process.argv);
