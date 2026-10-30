import { describe, expect, it } from 'vitest';
import { ReportedPorts } from './reported';

describe('ReportedPorts', () => {
	it('finds ports in every text the sources hold, however deep', async () => {
		const ports = new ReportedPorts({
			sources: async () => [
				{
					tasks: [
						{ preview: { url: 'http://127.0.0.1:4397/' }, note: 'see http://localhost:8080/x' }
					]
				},
				{
					cards: [
						{ question: 'ok?', evidence: ['https://localhost:9443/', 'http://example.com:3000/'] }
					]
				},
				[{ message: { content: [{ text: 'Preview: http://localhost:5173/app' }] } }]
			]
		});
		expect(await ports.has(5173)).toBe(true);
		expect(await ports.has(4397)).toBe(true);
		expect(await ports.has(8080)).toBe(true);
		expect(await ports.has(9443)).toBe(false);
		expect(await ports.has(3000)).toBe(false);
	});

	it('looks again for an unknown port at most every couple of seconds, and keeps what it saw', async () => {
		let now = 0;
		let reads = 0;
		let text = 'http://localhost:5173/';
		const ports = new ReportedPorts({
			sources: async () => {
				reads++;
				return [text];
			},
			now: () => now
		});
		expect(await ports.has(3000)).toBe(false);
		expect(await ports.has(3000)).toBe(false);
		expect(reads).toBe(1);
		text = 'http://localhost:3000/';
		now = 2_000;
		expect(await ports.has(3000)).toBe(true);
		// Known ports are answered without a read, and stay known after their text has gone.
		text = '';
		now = 10_000;
		expect(await ports.has(5173)).toBe(true);
		expect(reads).toBe(2);
	});

	it('reports nothing new while a source cannot be read', async () => {
		const ports = new ReportedPorts({
			sources: async () => {
				throw new Error('gone');
			}
		});
		expect(await ports.has(5173)).toBe(false);
	});
});
