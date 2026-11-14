import { defaultConfigDir } from '../plugins/config';
import { readAnswers } from '../setup/answers';
import { CloudSettings, cloudDir } from './settings';
import { viaRelay } from './remote';

/**
 * The way back to Fleetyard, the cloud product's own site, from a cloud
 * machine's Wheelhouse: the header shows it to a page that came through
 * Wheelhouse Cloud on a machine the cloud product made (one with setup
 * answers, setup/answers.ts). It goes to the address the answers give, else
 * to the gateway this machine is paired with (the gateway is Fleetyard's
 * site). A page served here directly, and every install of the captain's own,
 * gets none.
 */
export async function fleetyardLink(
	request: Request,
	env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
	if (!viaRelay(request)) return null;
	const configDir = defaultConfigDir(env);
	const answers = readAnswers(configDir);
	if (answers.state !== 'ok') return null;
	if (answers.fleetyard) return answers.fleetyard;
	const { settings } = await new CloudSettings(cloudDir(configDir)).read();
	return settings.device?.gateway ?? settings.gateway;
}
