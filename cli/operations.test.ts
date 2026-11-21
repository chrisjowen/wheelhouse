import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { version } from '../package.json';
import { program } from './index';
import {
	access,
	commandTree,
	flagsOf,
	OPERATIONS_FILE,
	operationsReference,
	routeTree
} from './operations';

const root = path.resolve(__dirname, '..');
const committed = () => readFile(path.join(root, OPERATIONS_FILE), 'utf8');
const REGENERATE = 'run `npm run gen:operations` and commit the result';

// The drift test: the skill's reference must say what this checkout does.
describe('the operations reference', () => {
	it('is for this version of Wheelhouse', async () => {
		const header = /^Generated from Wheelhouse (\S+) /m.exec(await committed())?.[1];
		expect(header, `the reference is for another version; ${REGENERATE}`).toBe(version);
	});

	it('lists every HTTP route and the methods it exports', async () => {
		const text = await committed();
		const missing = (await routeTree(path.join(root, 'src', 'routes'))).flatMap((r) =>
			r.methods
				.filter((m) => !text.includes(`| \`${r.path}\` | ${m} |`))
				.map((m) => `${m} ${r.path}`)
		);
		expect(missing, `routes missing from the reference; ${REGENERATE}`).toEqual([]);
	});

	it('lists every command and every flag', async () => {
		const text = await committed();
		const missing = commandTree(program()).flatMap(({ name, command }) => [
			...(text.includes(`### ${name}\n`) ? [] : [name]),
			...flagsOf(command)
				.filter((flag) => !text.includes(flag))
				.map((flag) => `${name} ${flag}`)
		]);
		expect(missing, `commands or flags missing from the reference; ${REGENERATE}`).toEqual([]);
	});

	it('is exactly what the generator writes now', async () => {
		expect(await committed(), REGENERATE).toBe(await operationsReference(root, version));
	});
});

describe('route access', () => {
	it('says who may call a route, from the agent token’s own tables', () => {
		expect(access('GET', '/api/inbox')).toBe('read');
		expect(access('POST', '/api/inbox')).toBe('captain only');
		expect(access('POST', '/api/plugins/[plugin]/config')).toBe('agent token');
		expect(access('PUT', '/api/projects/[id]/passage/file')).toBe('agent token');
		expect(access('POST', '/api/projects/[id]/passage/consent')).toBe('captain only');
		expect(access('POST', '/api/features')).toBe('page only');
	});
});
