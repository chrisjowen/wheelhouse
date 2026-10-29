/**
 * Hides secret values in a command's output as it streams, the way `op run`
 * does: every exact copy of a value becomes MASK. A value split across chunks
 * is still caught, because the end of each chunk that could begin a value is
 * held back until the next one. Only exact copies are caught: an encoded,
 * reversed or partial copy of a value passes through.
 */

export const MASK = '<concealed by wh-vault>';

export class Masker {
	private readonly values: Buffer[];
	private readonly longest: number;
	private readonly mask: Buffer;
	private pending = Buffer.alloc(0);

	constructor(values: string[], mask = MASK) {
		// Longest first, so where two values start at the same place the longer one is hidden.
		this.values = [...new Set(values.filter((v) => v.length > 0))]
			.map((v) => Buffer.from(v, 'utf8'))
			.sort((a, b) => b.length - a.length);
		this.longest = this.values[0]?.length ?? 0;
		this.mask = Buffer.from(mask, 'utf8');
	}

	/** What of the output so far can be shown now. */
	write(chunk: Buffer): Buffer {
		return this.scan(Buffer.concat([this.pending, chunk]), false);
	}

	/** The rest, once the output has ended. */
	end(): Buffer {
		return this.scan(this.pending, true);
	}

	private scan(buf: Buffer, final: boolean): Buffer {
		// A value that starts before `limit` lies wholly in `buf`; one that starts later may not.
		const limit = final ? buf.length : Math.max(0, buf.length - (this.longest - 1));
		const out: Buffer[] = [];
		let i = 0;
		for (;;) {
			let at = -1;
			let len = 0;
			for (const v of this.values) {
				const p = buf.indexOf(v, i);
				if (p !== -1 && p < limit && (at === -1 || p < at)) {
					at = p;
					len = v.length;
				}
			}
			if (at === -1) break;
			out.push(buf.subarray(i, at), this.mask);
			i = at + len;
		}
		const keep = Math.max(i, limit);
		out.push(buf.subarray(i, keep));
		this.pending = Buffer.from(buf.subarray(keep));
		return Buffer.concat(out);
	}
}
