import { cloudSignInPending } from '../setup/cloud';

/**
 * Whether Wheelhouse starts the Firstmate session as it launches. It does,
 * unless it is only a restart of its own server (cli/supervise.ts), the setup
 * wizard just connected it, or this is a cloud machine whose agent is not
 * signed in yet: started then, the agent would sit at its own sign-in screen,
 * setup's finish would find that session running (it never starts a second),
 * and the captain would be asked to sign in again after the wizard's sign-in.
 * In the last two, setup starts it when the captain finishes.
 *
 * Returns why it is not started, as Wheelhouse logs it, or null to start it.
 */
export function launchHold(env: NodeJS.ProcessEnv, startSession = true): string | null {
	if (!startSession) return 'connected by setup; it starts when setup finishes.';
	if (env.WHEELHOUSE_RESTARTED === '1')
		return 'left as it is; Wheelhouse only restarted its own server.';
	if (cloudSignInPending(env)) return 'starts when setup finishes, once its agent is signed in.';
	return null;
}
