import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseGraph } from '../graph';

/**
 * Test fixture: `docket graph --json --root examples/acme-platform` from
 * docket 9fe78c8 (21 exhibits, 37 links), with the root path made generic.
 */
export const ACME_FILE = path.join(import.meta.dirname, 'acme-platform.graph.json');
export const ACME = readFileSync(ACME_FILE, 'utf8');

export function acme() {
	const r = parseGraph(ACME);
	if (!r.ok) throw new Error(r.reason);
	return r.graph;
}
