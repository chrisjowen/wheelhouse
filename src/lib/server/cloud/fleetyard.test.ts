import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GATEWAY } from '../../cloud';
import { ANSWERS_SCHEMA, answersFile } from '../setup/answers';
import { fleetyardLink } from './fleetyard';
import { CLOUD_SETTINGS_SCHEMA, CloudSettings, cloudDir } from './settings';

let root: string;
let config: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'wh-fleetyard-'));
	config = path.join(root, 'config');
	mkdirSync(config);
	env = { WHEELHOUSE_CONFIG_DIR: config };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const page = (relayed: boolean) =>
	new Request('http://127.0.0.1:4310/', {
		headers: relayed ? { 'x-wheelhouse-remote': '1' } : {}
	});
const cloudMachine = (extra: Record<string, unknown> = {}) =>
	writeFileSync(
		answersFile(config),
		JSON.stringify({ schema: ANSWERS_SCHEMA, agent: 'claude', auth: 'subscription', ...extra })
	);

describe('the way back to Fleetyard', () => {
	it('is not shown on an install of the captain’s own, relayed or not', async () => {
		expect(await fleetyardLink(page(true), env)).toBeNull();
		expect(await fleetyardLink(page(false), env)).toBeNull();
	});

	it('is not shown on a cloud machine’s page served here directly', async () => {
		cloudMachine({ fleetyardUrl: 'https://fleetyard.example.com/' });
		expect(await fleetyardLink(page(false), env)).toBeNull();
	});

	it('goes where the setup answers say, through the relay', async () => {
		cloudMachine({ fleetyardUrl: 'https://fleetyard.example.com/machines' });
		expect(await fleetyardLink(page(true), env)).toBe('https://fleetyard.example.com/machines');
	});

	it('else goes to the gateway the machine uses', async () => {
		cloudMachine();
		expect(await fleetyardLink(page(true), env)).toBe(DEFAULT_GATEWAY);
		mkdirSync(cloudDir(config));
		writeFileSync(
			new CloudSettings(cloudDir(config)).file,
			JSON.stringify({ schema: CLOUD_SETTINGS_SCHEMA, gateway: 'https://cloud.example.com' })
		);
		expect(await fleetyardLink(page(true), env)).toBe('https://cloud.example.com');
	});
});
