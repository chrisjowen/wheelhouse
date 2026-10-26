/** One line of a line diff: kept, added or removed. */
export interface DiffLine {
	op: ' ' | '+' | '-';
	text: string;
	/** For kept lines, the line's index in the old text. */
	from?: number;
}

/**
 * A line diff of two texts (longest common subsequence). Common lines at the
 * start and end are matched first, so a small edit to a passage file costs
 * little; files are at most 64 KiB.
 */
export function diffLines(a: string[], b: string[]): DiffLine[] {
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	const n = endA - start;
	const m = endB - start;
	const w = m + 1;
	const t = new Uint32Array((n + 1) * w);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			t[i * w + j] =
				a[start + i] === b[start + j]
					? t[(i + 1) * w + j + 1] + 1
					: Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
		}
	}
	const out: DiffLine[] = [];
	for (let k = 0; k < start; k++) out.push({ op: ' ', text: a[k], from: k });
	let i = 0;
	let j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && a[start + i] === b[start + j]) {
			out.push({ op: ' ', text: a[start + i], from: start + i });
			i++;
			j++;
		} else if (j < m && (i >= n || t[i * w + j + 1] >= t[(i + 1) * w + j])) {
			out.push({ op: '+', text: b[start + j++] });
		} else {
			out.push({ op: '-', text: a[start + i++] });
		}
	}
	for (let k = endA; k < a.length; k++) out.push({ op: ' ', text: a[k], from: k });
	return out;
}

/** Split text into lines, without the empty one after a final newline. */
export const linesOf = (text: string) => {
	const l = text.split('\n');
	if (l.length && l[l.length - 1] === '') l.pop();
	return l;
};
