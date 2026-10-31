import { describe, expect, it } from 'vitest';
import { SeenAddresses } from './seen';

describe('SeenAddresses', () => {
	it('finds addresses on this computer in every text the sources hold, however deep', async () => {
		const seen = new SeenAddresses({
			sources: async () => [
				{
					tasks: [
						{ preview: { url: 'http://127.0.0.1:4397/' }, note: 'see http://localhost:8080/x' }
					]
				},
				{ cards: [{ evidence: ['https://localhost:9443/', 'http://example.com:3000/'] }] },
				[{ message: { content: [{ text: 'Preview: http://localhost:5173/app' }] } }]
			]
		});
		expect((await seen.list()).sort()).toEqual([
			'http://127.0.0.1:4397/',
			'http://localhost:5173/app',
			'http://localhost:8080/x',
			'https://localhost:9443/'
		]);
	});

	it('looks again at most every couple of seconds, and keeps what it saw', async () => {
		let now = 0;
		let reads = 0;
		let text = 'http://localhost:5173/';
		const seen = new SeenAddresses({
			sources: async () => {
				reads++;
				return [text];
			},
			now: () => now
		});
		expect(await seen.list()).toEqual(['http://localhost:5173/']);
		text = 'http://localhost:3000/';
		expect(await seen.list()).toEqual(['http://localhost:5173/']);
		expect(reads).toBe(1);
		now = 2_000;
		expect(await seen.list()).toEqual(['http://localhost:5173/', 'http://localhost:3000/']);
		// Gone from the sources, still known.
		text = '';
		now = 10_000;
		expect(await seen.list()).toEqual(['http://localhost:5173/', 'http://localhost:3000/']);
		expect(reads).toBe(3);
	});

	it('reports nothing new while a source cannot be read', async () => {
		const seen = new SeenAddresses({
			sources: async () => {
				throw new Error('gone');
			}
		});
		expect(await seen.list()).toEqual([]);
	});
});
