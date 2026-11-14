import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultConfigDir } from '../plugins/config';
import { defaultStateDir } from '../store/store';
import { readAnswers } from './answers';

/**
 * A cloud machine: one the cloud product (Fleetyard) made, which has setup
 * answers it can use (see answers.ts). It is reached only through Wheelhouse
 * Cloud, whose gateway has every relayed session signed with the captain's
 * passkey, so on it, and only on it, the setup wizard answers relayed requests
 * too (see refusesSetup), and its first page opens the wizard until the
 * agent's sign-in step is done. Without usable answers (every install on the
 * captain's own computer) nothing here applies.
 *
 * The step is done once the wizard's test of the agent passes, or the wizard
 * finishes: it keeps `setup/signed-in.json` in Wheelhouse's state directory.
 */

export const isCloudMachine = (configDir: string) => readAnswers(configDir).state === 'ok';

export const signedInFile = (stateDir: string) => path.join(stateDir, 'setup', 'signed-in.json');

/** Keep that the cloud machine's sign-in step is done, through a temporary file. */
export function markSignedIn(stateDir: string, agent: string): void {
	const file = signedInFile(stateDir);
	mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify({ agent, at: new Date().toISOString() }, null, '\t')}\n`);
	renameSync(tmp, file);
}

/** Whether this is a cloud machine whose agent sign-in step is not done yet. */
export function cloudSignInPending(env: NodeJS.ProcessEnv): boolean {
	return isCloudMachine(defaultConfigDir(env)) && !existsSync(signedInFile(defaultStateDir(env)));
}
