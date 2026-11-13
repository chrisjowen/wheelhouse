import type { RoleProvider, PluginStatus } from '../../plugins/types';
import type { ReviewSurface, SkillResult } from './skill';

/**
 * Keeps the manage-wheelhouse skill saying which review surface is active
 * (see skill.ts reviewSurfaceSection): `sync` reinstalls it whenever the
 * active surface differs from the one it last installed, so choosing another
 * provider, or turning off or removing the chosen one, reaches Firstmate's
 * next read of the skill. Calls run one at a time; a failed install is tried
 * again on a later call, at most once a minute for the same surface, and the
 * failure is logged only when its message changes.
 */
const RETRY_MS = 60_000;

export class SkillSync {
	/** The surface last installed: a plugin id, '' for the built-in, undefined before the first. */
	private last: string | undefined;
	private chain: Promise<unknown> = Promise.resolve();
	/** The last failed install: its surface key, when it ran, and its message. */
	private failed: { key: string; at: number; message: string } | null = null;

	constructor(
		private readonly surface: () => Promise<ReviewSurface | null>,
		private readonly install: (surface: ReviewSurface | null) => Promise<SkillResult>,
		private readonly log: (line: string) => void = () => {},
		private readonly now: () => number = Date.now
	) {}

	/** Reinstall the skill when the active review surface changed; null when it had not. */
	sync(): Promise<SkillResult | null> {
		const run = this.chain.then(async () => {
			const surface = await this.surface();
			const key = surface?.id ?? '';
			if (key === this.last) return null;
			const f = this.failed;
			if (f?.key === key && this.now() - f.at < RETRY_MS) return null;
			const r = await this.install(surface);
			if (r.state === 'error') {
				this.last = undefined;
				this.failed = { key, at: this.now(), message: r.message };
				if (f?.message !== r.message) this.log(r.message);
			} else {
				this.last = key;
				this.failed = null;
				this.log(r.message);
			}
			return r;
		});
		this.chain = run.catch(() => {});
		return run;
	}
}

/** The review surface as the skill names it: the active provider, with its repository when installed. */
export function reviewSurfaceOf(
	active: RoleProvider | null,
	statuses: PluginStatus[]
): ReviewSurface | null {
	if (!active) return null;
	const status = statuses.find((s) => s.id === active.id && s.state === 'loaded');
	return { id: active.id, name: active.name, repository: status?.repository ?? null };
}
