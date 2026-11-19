import { homedir } from 'node:os';
import path from 'node:path';
import {
	GROK_SESSION_VARIABLE,
	grokArgv,
	grokRecords,
	grokScreen,
	isGrokSessionId,
	locateGrokTranscript
} from '../grok';
import { nativeScreen } from './screen';
import type { AgentLaunch, PrimaryAgent } from './types';

/**
 * Grok: started trusted with a conversation id Wheelhouse chooses, which marks
 * the launch and binds its chat to that conversation. Input goes only to its
 * proven composer, and a turn is stopped with Ctrl+C.
 */

/** Longer than the second in which Grok takes another Ctrl+C as a request to quit. */
const GROK_STOP_HOLD_MS = 1200;

/** One Grok launch, known by the conversation id it was started with. */
interface GrokLaunch extends AgentLaunch {
	readonly sessionId: string | null;
}

function launch(sessionId: string | null): GrokLaunch {
	let stopHold: Promise<void> = Promise.resolve();
	return {
		sessionId,
		chatReady: sessionId !== null,
		screen: (io) => nativeScreen(io, grokScreen),
		picker: async () => null,

		/**
		 * Grok cancels a turn with Ctrl+C (to Escape it only answers "Press Ctrl+c to
		 * cancel the turn"), pressed only while its screen shows a turn it can cancel,
		 * so the key reaches nothing else, and never within GROK_STOP_HOLD_MS of the
		 * last press: a second Ctrl+C that soon quits Grok.
		 */
		async interrupt(io) {
			await stopHold;
			const shown = grokScreen(await io.screen().catch(() => null));
			if (shown.kind !== 'prompt')
				return { ok: false, status: 409, error: 'Use Grok’s terminal to stop it.' };
			if (!shown.busy) return { ok: true };
			const pressed = await io.keys(['C-c']);
			stopHold = io.sleep(GROK_STOP_HOLD_MS);
			return pressed;
		}
	};
}

export const grok: PrimaryAgent<GrokLaunch> = {
	id: 'grok',
	skipPermissionsSetting: false,
	slashCommands: false,
	menuOpen: 'grok is waiting for attention. Answer the choice or open its terminal before sending.',
	restartToChat: 'Restart the grok session from Wheelhouse to enable its chat.',

	async start(_ctx, binary, nonce) {
		return {
			argv: grokArgv(binary, nonce),
			env: { [GROK_SESSION_VARIABLE]: nonce },
			launch: launch(nonce)
		};
	},

	async recover(_ctx, io, current) {
		const value = await io.variable(GROK_SESSION_VARIABLE);
		const sessionId = isGrokSessionId(value) ? value : null;
		// The same launch keeps its stop hold across reads.
		return current && current.sessionId === sessionId ? current : launch(sessionId);
	},

	chat: {
		kind: 'stream',
		locate: (ctx, running, state) =>
			locateGrokTranscript(
				{
					firstmateDir: ctx.firstmateDir,
					grokHome: ctx.env.GROK_HOME || path.join(ctx.env.HOME || homedir(), '.grok'),
					sessionId: running?.sessionId ?? null
				},
				state
			),
		decode: grokRecords
	}
};
