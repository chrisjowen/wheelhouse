import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storeFileFor } from '../store/store';

/**
 * The captain's consent to run a project file's network checks. Before
 * Wheelhouse runs the GitHub, npm or HTTP checks a project's
 * `.wheelhouse.yaml` declares, the captain enables that file once on the
 * project's passage page; Wheelhouse records the file's sha256, and a changed
 * file is off again until the captain enables the new version.
 *
 * The record lives beside the message store, in Wheelhouse's own state
 * directory (one file per Firstmate home), never in the Firstmate home.
 * Writes go to a temporary file renamed over the old one.
 */

export const CONSENT_SCHEMA = 'wheelhouse-passage-consent.v1';

interface ConsentFile {
	schema: typeof CONSENT_SCHEMA;
	home: string;
	projects: Record<string, { digest: string; enabledAt: string }>;
}

export function consentFileFor(stateDir: string, homeDir: string): string {
	return path.join(path.dirname(storeFileFor(stateDir, homeDir)), 'passage-consent.json');
}

const DIGEST = /^[0-9a-f]{64}$/;

export class ConsentStore {
	private projects = new Map<string, { digest: string; enabledAt: string }>();
	private writing: Promise<void> = Promise.resolve();

	private constructor(
		readonly file: string,
		private home: string
	) {}

	/** Load the record; a missing or unreadable file means nothing is enabled. */
	static async open(file: string, home: string): Promise<ConsentStore> {
		const s = new ConsentStore(file, home);
		try {
			const doc = JSON.parse(await readFile(file, 'utf8'));
			if (doc?.schema === CONSENT_SCHEMA && doc.projects && typeof doc.projects === 'object') {
				for (const [id, v] of Object.entries(doc.projects as Record<string, unknown>)) {
					const r = v as { digest?: unknown; enabledAt?: unknown };
					if (typeof r?.digest === 'string' && DIGEST.test(r.digest)) {
						s.projects.set(id, {
							digest: r.digest,
							enabledAt: typeof r.enabledAt === 'string' ? r.enabledAt : new Date(0).toISOString()
						});
					}
				}
			}
		} catch {
			// nothing enabled yet
		}
		return s;
	}

	/** The project file with this digest is enabled. */
	enabled(projectId: string, digest: string | null): boolean {
		return !!digest && this.projects.get(projectId)?.digest === digest;
	}

	enabledAt(projectId: string): string | null {
		return this.projects.get(projectId)?.enabledAt ?? null;
	}

	/** Enable (digest) or turn off (null) a project file's checks, and save. */
	async set(projectId: string, digest: string | null, now = new Date()): Promise<void> {
		if (digest !== null && !DIGEST.test(digest)) throw new Error('not a file digest');
		const before = this.projects.get(projectId);
		if (digest) this.projects.set(projectId, { digest, enabledAt: now.toISOString() });
		else this.projects.delete(projectId);
		const doc: ConsentFile = {
			schema: CONSENT_SCHEMA,
			home: this.home,
			projects: Object.fromEntries(this.projects)
		};
		const text = `${JSON.stringify(doc, null, '\t')}\n`;
		const write = this.writing.then(async () => {
			await mkdir(path.dirname(this.file), { recursive: true });
			const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
			try {
				await writeFile(tmp, text, { mode: 0o600 });
				await rename(tmp, this.file);
			} catch (e) {
				await rm(tmp, { force: true });
				throw e;
			}
		});
		this.writing = write.catch(() => {});
		try {
			await write;
		} catch (e) {
			// Not saved, so not enabled: keep what the file still says.
			if (before) this.projects.set(projectId, before);
			else this.projects.delete(projectId);
			throw e;
		}
	}
}
