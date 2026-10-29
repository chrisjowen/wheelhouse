/**
 * Telling which version is newer: release tags (`v1.2.0`, `1.2.0`) and
 * package versions compared as semantic versions, and what a repository
 * offers as `git ls-remote` lists it.
 */

export interface Version {
	major: number;
	minor: number;
	patch: number;
	/** The pre-release part (`rc.1` of `1.2.0-rc.1`), or null for a release. */
	pre: string | null;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** `1.2.3`, `v1.2.3` or `1.2.3-rc.1` as a version; null for anything else. */
export function parseVersion(s: string): Version | null {
	const m = SEMVER.exec(s.trim());
	if (!m) return null;
	return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}

function comparePre(a: string | null, b: string | null): number {
	if (a === b) return 0;
	// A release is newer than any of its pre-releases.
	if (a === null) return 1;
	if (b === null) return -1;
	const pa = a.split('.');
	const pb = b.split('.');
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		if (pa[i] === undefined) return -1;
		if (pb[i] === undefined) return 1;
		const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : null;
		const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : null;
		if (na !== null && nb !== null) {
			if (na !== nb) return na < nb ? -1 : 1;
		} else if (na !== null) return -1;
		else if (nb !== null) return 1;
		else if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
	}
	return 0;
}

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when the same;
 * null when either is not a version.
 */
export function compareVersions(a: string, b: string): number | null {
	const va = parseVersion(a);
	const vb = parseVersion(b);
	if (!va || !vb) return null;
	for (const k of ['major', 'minor', 'patch'] as const) {
		if (va[k] !== vb[k]) return va[k] < vb[k] ? -1 : 1;
	}
	return comparePre(va.pre, vb.pre);
}

/**
 * The newest release tag newer than `current`, or null. Pre-releases count
 * only when `current` is one itself; tags that are not versions never count.
 */
export function newerTag(current: string, tags: string[]): string | null {
	const cur = parseVersion(current);
	if (!cur) return null;
	let best: string | null = null;
	for (const t of tags) {
		const v = parseVersion(t);
		if (!v || (v.pre !== null && cur.pre === null)) continue;
		if ((compareVersions(t, current) ?? 0) <= 0) continue;
		if (best === null || (compareVersions(t, best) ?? 0) > 0) best = t;
	}
	return best;
}

export interface RemoteRefs {
	/** The commit the default branch is at. */
	head: string | null;
	/** Branch name → commit. */
	heads: Map<string, string>;
	/** Tag name → the commit it names (annotated tags peeled). */
	tags: Map<string, string>;
}

/** What `git ls-remote <url>` printed, as branches and tags. */
export function parseLsRemote(text: string): RemoteRefs {
	const out: RemoteRefs = { head: null, heads: new Map(), tags: new Map() };
	const peeled = new Map<string, string>();
	for (const line of text.split('\n')) {
		const [sha, ref] = line.trim().split(/\s+/);
		if (!sha || !ref || !/^[0-9a-f]{40}$/.test(sha)) continue;
		if (ref === 'HEAD') out.head = sha;
		else if (ref.startsWith('refs/heads/')) out.heads.set(ref.slice(11), sha);
		else if (ref.startsWith('refs/tags/')) {
			const name = ref.slice(10);
			if (name.endsWith('^{}')) peeled.set(name.slice(0, -3), sha);
			else out.tags.set(name, sha);
		}
	}
	for (const [name, sha] of peeled) out.tags.set(name, sha);
	return out;
}
