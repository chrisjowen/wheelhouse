import { randomBytes } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ServicePorts } from '../../plugins/ports';
import {
	answerOpenCodePicker,
	createOpenCodeSession,
	interruptOpenCode,
	openCodeSnapshot,
	openCodeStatus,
	OpenCodeError,
	parseOpenCodeConnection,
	pendingOpenCodePicker,
	selectOpenCodeSession,
	sendOpenCode,
	type OpenCodeConnection
} from '../opencode';
import { blocked } from './screen';
import type { AgentLaunch, PrimaryAgent, SendResult } from './types';

/**
 * OpenCode: started with permissions auto-approved and its private session
 * server on a loopback port Wheelhouse keeps for it, with credentials it reads
 * from a 0600 connection file, never from its process arguments. The chat
 * talks to that server's API, bound to the one session Wheelhouse creates for
 * the launch: messages, Stop and choices go through the API, never typed.
 */

const CONNECTION = 'WH_OPENCODE_CONNECTION';
const RESTART = 'Restart the OpenCode primary from Wheelhouse to enable chat.';

/** argv that starts `opencode` with the connection file's port and credentials, keeping them out of its process arguments. */
export function openCodeArgv(binary: string, connectionFile: string): string[] {
	return [
		process.execPath,
		'-e',
		`const fs = require('node:fs');
const {spawn} = require('node:child_process');
const connection = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const child = spawn(process.argv[2], ['--auto', '--hostname', '127.0.0.1', '--port', new URL(connection.url).port], {
 stdio: 'inherit', env: {...process.env, OPENCODE_SERVER_USERNAME: connection.username, OPENCODE_SERVER_PASSWORD: connection.password}
});
child.on('error', () => { console.error('OpenCode could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; })`,
		connectionFile,
		binary
	];
}

/** One OpenCode launch, known by its private connection; null for one the chat cannot trust. */
interface OpenCodeLaunch extends AgentLaunch {
	readonly connection: OpenCodeConnection | null;
}

function launch(connection: OpenCodeConnection | null): OpenCodeLaunch {
	/** One call to the launch's API, as the page shows its outcome. */
	const call = async (
		action: (connection: OpenCodeConnection) => Promise<void>
	): Promise<SendResult> => {
		if (!connection) return { ok: false, status: 409, error: RESTART };
		try {
			await action(connection);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				status: error instanceof OpenCodeError ? error.status : 503,
				error: error instanceof Error ? error.message : 'OpenCode is unavailable.'
			};
		}
	};
	return {
		connection,
		chatReady: connection !== null,

		/** Bind the native TUI to the launch's session once it is ready, within 20 seconds. */
		async ready(io) {
			if (!connection) return null;
			const until = Date.now() + 20_000;
			let failure = 'The native TUI is not ready.';
			while (Date.now() < until) {
				try {
					if (!(await io.screen())?.includes('┃')) throw new Error('The native TUI is not ready.');
					await createOpenCodeSession(connection);
					await selectOpenCodeSession(connection);
					return null;
				} catch (error) {
					failure = error instanceof Error ? error.message : String(error);
				}
				await io.sleep(250);
			}
			return `OpenCode started but its chat could not be connected: ${failure} Open its terminal, finish setup, then restart the primary.`;
		},

		async screen(io) {
			try {
				if (connection) {
					const status = await openCodeStatus(connection);
					io.read();
					return status;
				}
			} catch {
				/* The optional terminal remains available while the API recovers. */
			}
			return blocked(
				io,
				'OpenCode’s session API is not ready. Retry shortly or open its terminal.'
			);
		},

		picker: async () => (connection ? pendingOpenCodePicker(connection) : null),
		send: (_io, body) => call((connection) => sendOpenCode(connection, body)),
		interrupt: () => call(interruptOpenCode),
		pick: (_io, signature, action) =>
			call((connection) => answerOpenCodePicker(connection, signature, action)),
		signIn: async () => ({ ok: false, status: 409, error: 'Sign in to OpenCode in its terminal.' }),
		ports: () => (connection ? [Number(new URL(connection.url).port)] : [])
	};
}

export const openCode: PrimaryAgent<OpenCodeLaunch> = {
	id: 'opencode',
	menuOpen:
		'opencode is waiting for attention. Answer the choice or open its terminal before sending.',
	restartToChat: RESTART,

	async start(ctx, binary, nonce) {
		const port = await new ServicePorts(path.join(ctx.stateDir, 'primary-ports.json')).port(
			'opencode',
			null,
			4096,
			[],
			[]
		);
		const connection = parseOpenCodeConnection({
			url: `http://127.0.0.1:${port}`,
			directory: ctx.firstmateDir,
			sessionId: `ses_${nonce.replace(/-/g, '')}`,
			username: 'wheelhouse',
			password: randomBytes(32).toString('hex')
		});
		const connectionFile = path.join(path.dirname(ctx.hookFile), `opencode-${nonce}.json`);
		await writeFile(connectionFile, JSON.stringify(connection), { mode: 0o600, flag: 'wx' });
		return {
			argv: openCodeArgv(binary, connectionFile),
			env: { [CONNECTION]: connectionFile },
			launch: launch(connection)
		};
	},

	async recover(ctx, io) {
		const file = (await io.variable(CONNECTION)) ?? '';
		try {
			if (
				!/^opencode-[0-9a-f-]{36}\.json$/.test(path.basename(file)) ||
				(await realpath(path.dirname(file))) !== (await realpath(path.dirname(ctx.hookFile)))
			)
				throw new Error('Wrong state directory');
			const connection = parseOpenCodeConnection(JSON.parse(await readFile(file, 'utf8')));
			if ((await realpath(connection.directory)) !== (await realpath(ctx.firstmateDir)))
				throw new Error('Wrong Firstmate checkout');
			return launch(connection);
		} catch {
			// An old or differently scoped session stays terminal-accessible only.
			return launch(null);
		}
	},

	chat: {
		kind: 'snapshot',
		async read(_ctx, running) {
			if (!running?.connection) throw new OpenCodeError(RESTART);
			return openCodeSnapshot(running.connection);
		}
	}
};
