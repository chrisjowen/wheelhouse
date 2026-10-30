import { describe, expect, it } from 'vitest';
import { Pairing, PAIRING_MAX_TRIES } from './pairing';

describe('Pairing', () => {
	it('makes an eight-letter code without look-alike letters, valid for ten minutes, once', () => {
		let t = 0;
		const p = new Pairing(
			() => t,
			(n) => Buffer.from(Array.from({ length: n }, (_, i) => i * 37))
		);
		const { code, expiresAt } = p.start();
		expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
		expect(expiresAt).toBe(new Date(600_000).toISOString());
		expect(p.offer(code.toLowerCase())).toBe('match');
		expect(p.offer(code)).toBe('closed');

		p.start();
		t = 600_000;
		expect(p.open()).toBeNull();
		expect(p.note).toMatch(/expired/);
	});

	it('ends after enough wrong codes', () => {
		const p = new Pairing(() => 0);
		const { code } = p.start();
		for (let i = 1; i < PAIRING_MAX_TRIES; i++) expect(p.offer('WRONG-CODE')).toBe('wrong');
		expect(p.offer('nope')).toBe('wrong');
		expect(p.offer(code)).toBe('closed');
	});
});
