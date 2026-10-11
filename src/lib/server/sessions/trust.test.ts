import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeStore, registerTrust } from './trust';

// Every store here is a temporary file; the real ~/.claude.json is never read or written.
let root: string;
let store: string;
let dir: string;

beforeEach(() => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wh-trust-')));
	store = path.join(root, 'config', '.claude.json');
	mkdirSync(path.dirname(store));
	dir = path.join(root, 'sessions', '20261011-140509-abcd');
	mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const read = (file = store) => JSON.parse(readFileSync(file, 'utf8'));

describe('claudeStore', () => {
	it('is .claude.json in CLAUDE_CONFIG_DIR, else HOME', () => {
		expect(claudeStore({ HOME: '/home/c' })).toBe('/home/c/.claude.json');
		expect(claudeStore({ HOME: '/home/c', CLAUDE_CONFIG_DIR: '/cfg' })).toBe('/cfg/.claude.json');
		expect(claudeStore({})).toBeNull();
		expect(claudeStore({ CLAUDE_CONFIG_DIR: 'relative' })).toBeNull();
	});
});

describe('registerTrust', () => {
	it('trusts exactly the directory, keeping everything else in the store', () => {
		const other = {
			hasTrustDialogAccepted: false,
			hasClaudeMdExternalIncludesApproved: false,
			hasClaudeMdExternalIncludesWarningShown: true
		};
		writeFileSync(
			store,
			JSON.stringify({
				numStartups: 7,
				oauthAccount: { email: 'x' },
				projects: { '/work/other': other, [dir]: { allowedTools: ['Read'] } }
			})
		);
		expect(registerTrust(store, dir)).toBeNull();
		const after = read();
		expect(after.numStartups).toBe(7);
		expect(after.oauthAccount).toEqual({ email: 'x' });
		// Another project's decisions, including import consent, are untouched.
		expect(after.projects['/work/other']).toEqual(other);
		// Only the trust flag is added for the session's directory.
		expect(after.projects[dir]).toEqual({ allowedTools: ['Read'], hasTrustDialogAccepted: true });
		expect(readFileSync(store, 'utf8')).toMatch(/^\{\n {2}"numStartups"/);
	});

	it('never grants external CLAUDE.md import consent', () => {
		expect(registerTrust(store, dir)).toBeNull();
		expect(Object.keys(read().projects[dir])).toEqual(['hasTrustDialogAccepted']);
	});

	it('creates a private store when there is none, leaving no temporary file', () => {
		expect(registerTrust(store, dir)).toBeNull();
		expect(read()).toEqual({ projects: { [dir]: { hasTrustDialogAccepted: true } } });
		expect(statSync(store).mode & 0o777).toBe(0o600);
		expect(readdirSync(path.dirname(store))).toEqual(['.claude.json']);
	});

	it('keys the entry by the directory’s real path', () => {
		const link = path.join(root, 'link');
		symlinkSync(dir, link);
		expect(registerTrust(store, link)).toBeNull();
		expect(Object.keys(read().projects)).toEqual([dir]);
	});

	it('writes through a symlinked store to its real file', () => {
		const real = path.join(root, 'config', 'real.json');
		writeFileSync(real, '{}');
		rmSync(store, { force: true });
		symlinkSync(real, store);
		expect(registerTrust(store, dir)).toBeNull();
		expect(read(real).projects[dir].hasTrustDialogAccepted).toBe(true);
	});

	it('refuses, changing nothing, when the store is not what Claude Code writes', () => {
		for (const bad of ['[1, 2]', '{"projects": []}', 'not json']) {
			writeFileSync(store, bad);
			expect(registerTrust(store, dir)).not.toBeNull();
			expect(readFileSync(store, 'utf8')).toBe(bad);
		}
		rmSync(store);
		mkdirSync(store);
		expect(registerTrust(store, dir)).toMatch(/not a regular file/);
	});

	it('refuses a directory that does not exist', () => {
		expect(registerTrust(store, path.join(root, 'missing'))).toMatch(/ENOENT/);
	});
});
