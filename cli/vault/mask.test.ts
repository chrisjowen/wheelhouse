import { describe, expect, it } from 'vitest';
import { MASK, Masker } from './mask';

/** Feed `text` to a masker in pieces of `size` bytes and collect what it lets through. */
function through(values: string[], text: string, size: number): string {
	const m = new Masker(values);
	const buf = Buffer.from(text);
	const out: Buffer[] = [];
	for (let i = 0; i < buf.length; i += size) out.push(m.write(buf.subarray(i, i + size)));
	out.push(m.end());
	return Buffer.concat(out).toString();
}

describe('Masker', () => {
	it('hides every exact copy of a value', () => {
		expect(through(['s3cr3t'], 'token=s3cr3t and again s3cr3t.', 1024)).toBe(
			`token=${MASK} and again ${MASK}.`
		);
	});

	it('catches a value split across chunks, at every split', () => {
		const text = 'before tok_ABCDEFGH after';
		for (let size = 1; size <= text.length; size++) {
			expect(through(['tok_ABCDEFGH'], text, size), `chunks of ${size}`).toBe(
				`before ${MASK} after`
			);
		}
	});

	it('hides the longer of two values that start at the same place', () => {
		for (const size of [1, 3, 64]) {
			expect(through(['abc', 'abcdef'], 'x abcdef y abc z', size)).toBe(`x ${MASK} y ${MASK} z`);
		}
	});

	it('does not reveal the start of a longer value that a shorter one sits inside', () => {
		for (let size = 1; size <= 8; size++) {
			expect(through(['abcdef', 'cd'], '[abcdef] [cd]', size)).toBe(`[${MASK}] [${MASK}]`);
		}
	});

	it('handles multi-byte characters split between chunks', () => {
		for (let size = 1; size <= 6; size++) {
			expect(through(['pässwörd'], 'é pässwörd ü', size)).toBe(`é ${MASK} ü`);
		}
	});

	it('passes output through untouched when there is nothing to hide', () => {
		expect(through([], 'plain output', 3)).toBe('plain output');
		expect(through([''], 'plain output', 3)).toBe('plain output');
		expect(through(['zzz'], 'almost zz', 2)).toBe('almost zz');
	});

	it('does not catch an encoded copy', () => {
		const b64 = Buffer.from('s3cr3t').toString('base64');
		expect(through(['s3cr3t'], b64, 4)).toBe(b64);
	});
});
