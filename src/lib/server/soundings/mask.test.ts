import { describe, expect, it } from 'vitest';
import { cleanCommand, maskSecrets, tildePath } from './mask';

describe('maskSecrets', () => {
	it('masks secret options, with = or a space', () => {
		expect(maskSecrets('agent --token=abcd1234efgh5678 --port 80')).toBe(
			'agent --token=••• --port 80'
		);
		expect(maskSecrets('agent --api-key sk_live_value --verbose')).toBe(
			'agent --api-key ••• --verbose'
		);
		expect(maskSecrets('mysql --password "hunter 2" -h db')).toBe('mysql --password ••• -h db');
	});

	it('masks secrets in variables, URLs and headers', () => {
		expect(maskSecrets('GITHUB_TOKEN=abc123 PORT=3000 node app')).toBe(
			'GITHUB_TOKEN=••• PORT=3000 node app'
		);
		expect(maskSecrets('psql postgres://admin:s3cr3t@db.local:5432/app')).toBe(
			'psql postgres://admin:•••@db.local:5432/app'
		);
		expect(maskSecrets('curl https://api.example.com/x?api_key=XYZ&page=2')).toBe(
			'curl https://api.example.com/x?api_key=•••&page=2'
		);
		expect(maskSecrets("curl -H 'Authorization: Bearer abcdefgh12345678'")).toBe(
			"curl -H 'Authorization: Bearer •••'"
		);
	});

	it('masks well-known token shapes and long random values wherever they are', () => {
		const out = maskSecrets(
			'run ghp_0123456789abcdefghijABCDEFGHIJ sk-ant-api03-abcdefghijklmnop AKIAABCDEFGHIJKLMNOP x 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
		);
		expect(out).not.toMatch(/ghp_|sk-ant|AKIA|9f86d08/);
		expect(out).toBe('run ••• ••• ••• x •••');
	});

	it('leaves ordinary command lines alone', () => {
		const plain =
			'/usr/local/bin/node /Users/sam/work/site/node_modules/.bin/vite --port 5173 --host 127.0.0.1';
		expect(maskSecrets(plain)).toBe(plain);
	});
});

describe('cleanCommand', () => {
	it('masks, hides the home folder and cuts long lines', () => {
		expect(tildePath('/Users/sam/.claw/config.json', '/Users/sam')).toBe('~/.claw/config.json');
		const out = cleanCommand(
			`/Users/sam/bin/tool --secret=xyz ${'a '.repeat(200)}`,
			'/Users/sam',
			60
		);
		expect(out.startsWith('~/bin/tool --secret=••• a a')).toBe(true);
		expect(out.length).toBe(60);
		expect(out.endsWith('…')).toBe(true);
	});
});
