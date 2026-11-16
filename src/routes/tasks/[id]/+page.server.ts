import { taskDetail } from '$lib/server/detail';
import { loadSlots } from '$lib/server/runtime';
import { slotKey } from '$lib/plugins/keys';
import type { TaskDetail } from '$lib/types';
import type { PageServerLoad } from './$types';

/** How long the page waits for the task's evidence before it shows without it. */
const INLINE_MS = 300;

type Read = { detail: TaskDetail | null; problem: string | null };

export const load: PageServerLoad = async ({ params }) => {
	const read: Promise<Read> = taskDetail(params.id).then(
		(r) => (r.ok ? { detail: r.detail, problem: null } : { detail: null, problem: r.message }),
		(e: unknown) => ({
			detail: null,
			problem: `The task’s details cannot be read: ${(e as Error)?.message ?? e}`
		})
	);
	// Evidence read in time comes with the page. Slower (a remote second mate's reads go over
	// SSH and can take many seconds) streams in after it, and the page shows the task from
	// the fleet meanwhile.
	let timer: ReturnType<typeof setTimeout> | undefined;
	const [quick, slots] = await Promise.all([
		Promise.race([
			read,
			new Promise<null>((done) => (timer = setTimeout(() => done(null), INLINE_MS)))
		]).finally(() => clearTimeout(timer)),
		loadSlots([slotKey.task(params.id)])
	]);
	return {
		id: params.id,
		detail: quick ?? read,
		slots,
		slotsAt: Date.now()
	};
};
