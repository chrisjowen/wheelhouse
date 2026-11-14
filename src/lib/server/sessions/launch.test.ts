import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANSWERS_SCHEMA, answersFile } from '../setup/answers';
import { markSignedIn } from '../setup/cloud';
import { launchHold } from './launch';

let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-launch-'));
	mkdirSync(path.join(root, 'config'));
	env = {
		WHEELHOUSE_CONFIG_DIR: path.join(root, 'config'),
		WHEELHOUSE_STATE_DIR: path.join(root, 'state')
	};
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const cloudMachine = () =>
	writeFileSync(
		answersFile(path.join(root, 'config')),
		JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription' })
	);

describe('starting the Firstmate session as Wheelhouse launches', () => {
	it('starts it on an install of the captain’s own', () => {
		expect(launchHold(env)).toBeNull();
	});

	it('leaves it after a restart of Wheelhouse’s own server, or a connect by setup', () => {
		expect(launchHold({ ...env, WHEELHOUSE_RESTARTED: '1' })).toMatch(/left as it is/);
		expect(launchHold(env, false)).toMatch(/setup finishes/);
	});

	it('waits on a cloud machine until its agent is signed in, so it never asks again', () => {
		cloudMachine();
		expect(launchHold(env)).toMatch(/signed in/);
		markSignedIn(path.join(root, 'state'), 'claude');
		expect(launchHold(env)).toBeNull();
	});
});
