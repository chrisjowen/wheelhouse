import type { Harness } from '../../../harness';
import { contextFileFor, contextHarness } from '../../material/context';
import type { AgentContext, AgentIO, AgentLaunch } from './types';

/** A launch known by the nonce it stamps on its hook receipt. */
export interface ReceiptLaunch extends AgentLaunch {
	readonly nonce: string | null;
}

/** The variables a launch that writes a hook receipt with its nonce is started with. */
export const receiptEnv = (ctx: AgentContext, nonce: string): Record<string, string> => ({
	WH_SESSION_RECORD: ctx.hookFile,
	WH_SESSION_NONCE: nonce
});

/**
 * The variable that points a Codex hook or Pi extension at the session context
 * (material/context.ts), only while that harness is to get it.
 */
export const contextEnv = (harness: Harness, ctx: AgentContext): Record<string, string> =>
	contextHarness(harness, ctx.env) ? { WH_SESSION_CONTEXT: contextFileFor(ctx.hookFile) } : {};

/**
 * Read back the record and nonce a running launch was started with (Codex's
 * SessionStart recorder, Pi's extension). Its chat is trusted only when it
 * writes this state directory's record and has a well-formed nonce.
 */
export async function recoverReceipt(
	ctx: AgentContext,
	io: AgentIO
): Promise<{ nonce: string | null; chatReady: boolean }> {
	const recorder = (await io.variable('WH_SESSION_RECORD')) === ctx.hookFile;
	const value = (await io.variable('WH_SESSION_NONCE')) ?? '';
	const nonce = /^[0-9a-f-]{36}$/.test(value) ? value : null;
	return { nonce, chatReady: recorder && nonce !== null };
}
