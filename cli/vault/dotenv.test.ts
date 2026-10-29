import { describe, expect, it } from 'vitest';
import { parseDotenv } from './dotenv';

describe('parseDotenv', () => {
	it('reads the forms .env files commonly use', () => {
		const text = [
			'# deploy tokens',
			'',
			'VERCEL_TOKEN=abc123',
			'export SUPABASE_TOKEN = sbp_x  # the CLI token',
			"SINGLE='a # not a comment'",
			'DOUBLE="line1\\nline2 \\"q\\""',
			'EMPTY=',
			'URL=https://example.com/#frag'
		].join('\r\n');
		expect(parseDotenv(text)).toEqual({
			entries: [
				{ name: 'VERCEL_TOKEN', value: 'abc123', line: 3 },
				{ name: 'SUPABASE_TOKEN', value: 'sbp_x', line: 4 },
				{ name: 'SINGLE', value: 'a # not a comment', line: 5 },
				{ name: 'DOUBLE', value: 'line1\nline2 "q"', line: 6 },
				{ name: 'EMPTY', value: '', line: 7 },
				{ name: 'URL', value: 'https://example.com/#frag', line: 8 }
			],
			skipped: []
		});
	});

	it('reports lines it cannot read by number only', () => {
		expect(parseDotenv('OK=1\nnot an assignment\n1BAD=x\nOPEN="unterminated\n')).toEqual({
			entries: [{ name: 'OK', value: '1', line: 1 }],
			skipped: [2, 3, 4]
		});
	});
});
