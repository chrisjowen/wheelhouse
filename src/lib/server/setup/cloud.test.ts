import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANSWERS_SCHEMA, answersFile } from './answers';
import { cloudSignInPending, isCloudMachine, markSignedIn, signedInFile } from './cloud';

let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-cloud-'));
	mkdirSync(path.join(root, 'config'));
	env = {
		WHEELHOUSE_CONFIG_DIR: path.join(root, 'config'),
		WHEELHOUSE_STATE_DIR: path.join(root, 'state')
	};
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const answer = (text: string) => writeFileSync(answersFile(path.join(root, 'config')), text);

describe('a cloud machine', () => {
	it('is not an install of the captain’s own, nor one with answers it cannot use', () => {
		expect(isCloudMachine(path.join(root, 'config'))).toBe(false);
		expect(cloudSignInPending(env)).toBe(false);
		answer('{"agent":"claude"}');
		expect(isCloudMachine(path.join(root, 'config'))).toBe(false);
		expect(cloudSignInPending(env)).toBe(false);
	});

	it('opens the wizard until its sign-in step is done', () => {
		answer(JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription' }));
		expect(isCloudMachine(path.join(root, 'config'))).toBe(true);
		expect(cloudSignInPending(env)).toBe(true);
		markSignedIn(path.join(root, 'state'), 'claude');
		expect(signedInFile(path.join(root, 'state'))).toBe(
			path.join(root, 'state', 'setup', 'signed-in.json')
		);
		expect(cloudSignInPending(env)).toBe(false);
	});
});
