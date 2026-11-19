import { homedir } from 'node:os';
import path from 'node:path';
import { codexRecords, locateCodexTranscript } from '../codex';
import { codexScreen } from '../codex-screen';
import { shellLine } from '../tmux';
import { receiptEnv, recoverReceipt } from './receipt';
import { nativeScreen } from './screen';
import type { AgentLaunch, PrimaryAgent } from './types';

/**
 * Codex: started with approvals, sandboxing and hook trust prompts bypassed,
 * and a CLI-layer SessionStart hook that records which rollout this launch
 * writes, stamped with the launch's nonce, so the chat binds that exact
 * session and never guesses the newest. Input goes only to its positively
 * identified composer or numbered dialogs.
 */

/** CLI-layer hooks add our exact session recorder while preserving Firstmate's project hooks. */
export function codexArgv(binary: string): string[] {
	const script = `const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (Buffer.byteLength(input) > 65536) process.exit(1); });
process.stdin.on('end', () => {
 const record = JSON.parse(input);
 const file = process.env.WH_SESSION_RECORD;
 if (!file || !process.env.WH_SESSION_NONCE) process.exit(1);
 fs.writeFileSync(file + '.tmp', JSON.stringify({...record, wheelhouse_nonce: process.env.WH_SESSION_NONCE}), {mode: 0o600});
 fs.renameSync(file + '.tmp', file);
});`;
	const command = shellLine([process.execPath, '-e', script]);
	return [
		binary,
		'--dangerously-bypass-approvals-and-sandbox',
		'--dangerously-bypass-hook-trust',
		'-c',
		`hooks.SessionStart=[{hooks=[{type="command",command=${JSON.stringify(command)},timeout=10}]}]`
	];
}

/** One Codex launch, known by the nonce its recorder stamps on the receipt. */
interface CodexLaunch extends AgentLaunch {
	readonly nonce: string | null;
}

function launch(nonce: string | null, chatReady: boolean): CodexLaunch {
	return {
		nonce,
		chatReady,
		screen: (io) => nativeScreen(io, codexScreen),
		async picker(io) {
			const shown = codexScreen(await io.screen());
			return shown.kind === 'picker' ? shown.picker : null;
		}
	};
}

export const codex: PrimaryAgent<CodexLaunch> = {
	id: 'codex',
	menuOpen:
		'codex is waiting for attention. Answer the choice or open its terminal before sending.',
	restartToChat: 'Restart the codex session from Wheelhouse to enable its chat recorder.',

	async start(ctx, binary, nonce) {
		return { argv: codexArgv(binary), env: receiptEnv(ctx, nonce), launch: launch(nonce, true) };
	},

	async recover(ctx, io) {
		const { nonce, chatReady } = await recoverReceipt(ctx, io);
		return launch(nonce, chatReady);
	},

	chat: {
		locate: (ctx, running, state) =>
			locateCodexTranscript(
				{
					firstmateDir: ctx.firstmateDir,
					hookFile: ctx.hookFile,
					sessionNonce: running?.nonce ?? null,
					codexHome: ctx.env.CODEX_HOME || path.join(ctx.env.HOME || homedir(), '.codex')
				},
				state
			),
		decode: codexRecords
	}
};
