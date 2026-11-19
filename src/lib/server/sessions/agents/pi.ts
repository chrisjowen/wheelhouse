import { rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { piExtensionSource, piScreen, piSnapshot } from '../pi';
import { receiptEnv, recoverReceipt, type ReceiptLaunch } from './receipt';
import { nativeScreen } from './screen';
import type { PrimaryAgent } from './types';

/**
 * Pi: started with project trust approved and Wheelhouse's extension, which
 * records the session and the leaf of its active branch, stamped with the
 * launch's nonce. Its chat is read whole from that branch, since navigation can
 * change it in place. Input goes only to its empty editor.
 */

/** argv for the Firstmate session's `pi`, with Wheelhouse's extension and the provider chosen at launch. */
export function piArgv(binary: string, extensionFile: string, provider?: string | null): string[] {
	return [
		binary,
		'--approve',
		'--extension',
		extensionFile,
		...(provider ? ['--provider', provider] : [])
	];
}

function launch(nonce: string | null, chatReady: boolean): ReceiptLaunch {
	return {
		nonce,
		chatReady,
		screen: (io) => nativeScreen(io, piScreen),
		picker: async () => null
	};
}

export const pi: PrimaryAgent<ReceiptLaunch> = {
	id: 'pi',
	skipPermissionsSetting: false,
	slashCommands: false,
	menuOpen: 'pi is waiting for attention. Answer the choice or open its terminal before sending.',
	restartToChat: 'Restart the pi session from Wheelhouse to enable its chat recorder.',

	async start(ctx, binary, nonce) {
		const extensionFile = path.join(path.dirname(ctx.hookFile), 'pi-extension.mjs');
		await writeFile(`${extensionFile}.${nonce}.tmp`, piExtensionSource(), { mode: 0o600 });
		await rename(`${extensionFile}.${nonce}.tmp`, extensionFile);
		return {
			argv: piArgv(binary, extensionFile, ctx.piProvider()),
			env: receiptEnv(ctx, nonce),
			launch: launch(nonce, true)
		};
	},

	async recover(ctx, io) {
		const { nonce, chatReady } = await recoverReceipt(ctx, io);
		return launch(nonce, chatReady);
	},

	chat: {
		kind: 'snapshot',
		read: (ctx, running) =>
			piSnapshot({
				firstmateDir: ctx.firstmateDir,
				hookFile: ctx.hookFile,
				sessionNonce: running?.nonce ?? null,
				agentDir:
					ctx.env.PI_CODING_AGENT_DIR || path.join(ctx.env.HOME || homedir(), '.pi', 'agent')
			})
	}
};
