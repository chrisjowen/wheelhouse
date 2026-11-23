import path from 'node:path';
import type { Harness } from '../../harness';

/**
 * The context the Firstmate session Wheelhouse starts is given at its start
 * (bundle.ts sessionContext). Wheelhouse keeps it current in a file beside the
 * session's hook record, in its own state directory, and the session's start
 * hook prints it: Claude Code's SessionStart hook adds its
 * `hookSpecificOutput.additionalContext`, again after /clear, a compaction or
 * a resume. Nothing is written to Firstmate's home, and a session Wheelhouse
 * did not start never sees it.
 *
 * Claude Code's hook is verified to reach the model. Codex's hook and Pi's
 * extension carry it the same way, but only when WHEELHOUSE_SESSION_CONTEXT
 * names them (`codex,pi`) until each is verified on a real session; other
 * harnesses rely on the skills alone.
 */

export const CONTEXT_ID = 'context:session-start';
export const CONTEXT_FLAG = 'WHEELHOUSE_SESSION_CONTEXT';
/** Claude Code documents it, and Wheelhouse's tests drive it. */
const VERIFIED: readonly Harness[] = ['claude'];
/** Carry it, but only when the flag names them. */
const UNVERIFIED: readonly Harness[] = ['codex', 'pi'];
/** Claude Code adds hook context of at most 10,000 characters; ours stays far below. */
export const CONTEXT_MAX_BYTES = 2048;

/** Whether the session on `harness` gets the context. */
export function contextHarness(harness: Harness, env: NodeJS.ProcessEnv): boolean {
	if (VERIFIED.includes(harness)) return true;
	const named = (env[CONTEXT_FLAG] ?? '').split(/[\s,]+/);
	return UNVERIFIED.includes(harness) && named.includes(harness);
}

/** Where a session's start hook reads its context: beside its hook record. */
export const contextFileFor = (hookFile: string) =>
	path.join(path.dirname(hookFile), 'session-context.json');

/** The file's contents: SessionStart hook output, as Claude Code (and Codex) read it. */
export const hookOutput = (text: string) =>
	JSON.stringify({
		hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text }
	}) + '\n';
