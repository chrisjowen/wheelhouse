import { describe, expect, it, vi } from 'vitest';
import { linksAt, openTerminalLink, type TerminalRow } from './terminallinks';

const COLS = 20;
/** Rows as a terminal of COLS columns draws them: each padded with blanks to its width. */
const screen = (lines: string[], wrapped: number[] = []) => {
	const rows: TerminalRow[] = lines.map((l, i) => ({
		cells: [...l.padEnd(COLS, ' ')],
		wrapped: wrapped.includes(i)
	}));
	return (i: number) => rows[i];
};

describe('the links in a terminal', () => {
	it('finds an address on one row, without the punctuation after it', () => {
		const rows = screen(['see http://a.io/x.', 'or (https://b.io).']);
		expect(linksAt(1, COLS, rows)).toEqual([
			{ url: 'http://a.io/x', start: { x: 5, y: 1 }, end: { x: 17, y: 1 } }
		]);
		expect(linksAt(2, COLS, rows).map((l) => l.url)).toEqual(['https://b.io']);
	});

	it('joins an address broken into full rows, as Claude Code and tmux draw it', () => {
		const rows = screen([
			'Use the url below:',
			'https://claude.com/c',
			'ai/oauth?code=true&c',
			'lient_id=9d1c',
			'',
			'Paste code here >'
		]);
		const url = 'https://claude.com/cai/oauth?code=true&client_id=9d1c';
		for (const y of [2, 3, 4]) {
			expect(linksAt(y, COLS, rows)).toEqual([
				{ url, start: { x: 1, y: 2 }, end: { x: 13, y: 4 } }
			]);
		}
		expect(linksAt(1, COLS, rows)).toEqual([]);
		expect(linksAt(6, COLS, rows)).toEqual([]);
	});

	it('joins across the terminal’s own wrap', () => {
		const rows = screen(['go https://x.io/abcd', 'ef now'], [1]);
		expect(linksAt(2, COLS, rows)[0]).toMatchObject({ url: 'https://x.io/abcdef' });
	});

	it('stops at a row that does not run on: short, ending in a space, or a border', () => {
		expect(linksAt(1, COLS, screen(['https://x.io/a', 'bcdef']))[0].url).toBe('https://x.io/a');
		expect(linksAt(1, COLS, screen(['https://x.io/abcdef ', 'next']))[0].url).toBe(
			'https://x.io/abcdef'
		);
		expect(linksAt(1, COLS, screen(['│ https://x.io/abcd│', '│ more'])).map((l) => l.url)).toEqual([
			'https://x.io/abcd'
		]);
	});

	it('keeps a bracket the address opened, and finds none in plain text', () => {
		const rows = screen(['http://w.org/A_(b)']);
		expect(linksAt(1, COLS, rows)[0].url).toBe('http://w.org/A_(b)');
		expect(linksAt(1, COLS, screen(['no links here']))).toEqual([]);
		expect(linksAt(9, COLS, screen(['x']))).toEqual([]);
	});

	it('maps cells past a wide character', () => {
		const cells = [...'❯', '', ...' http://a.io'.padEnd(COLS - 2, ' ')];
		const rows = (i: number) => (i === 0 ? { cells, wrapped: false } : undefined);
		expect(linksAt(1, COLS, rows)).toEqual([
			{ url: 'http://a.io', start: { x: 4, y: 1 }, end: { x: 14, y: 1 } }
		]);
	});
});

describe('opening a link', () => {
	it('opens http and https in a tab of its own, and nothing else', () => {
		const open = vi.fn();
		openTerminalLink('https://claude.com/x?a=1', open);
		expect(open).toHaveBeenCalledWith('https://claude.com/x?a=1', '_blank', 'noopener,noreferrer');
		openTerminalLink('javascript:alert(1)', open);
		openTerminalLink('not a url', open);
		expect(open).toHaveBeenCalledOnce();
	});
});
