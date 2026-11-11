import { defaultConfigDir } from '$lib/server/plugins/config';
import { updateDir, UpdateSettings } from '$lib/server/upgrade/settings';
import { updateService } from '$lib/server/upgrade/service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const svc = updateService();
	const source = await svc.readSource();
	const dir = svc.installDir();
	let installKind: 'npm' | 'clone' | 'unknown' = 'unknown';
	if (dir) {
		const { detectInstallKind } = await import('$lib/server/upgrade/kind');
		const info = await detectInstallKind(dir);
		installKind = info.kind;
	}
	// Also fetch a current wheelhouse view for mismatch messaging
	const view = await svc.wheelhouse();
	return {
		source,
		installKind,
		view
	};
};
