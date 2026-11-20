import type { PageLoad } from './$types';

// The panel lives in the browser only: it is framed by the page under review and talks to it.
export const ssr = false;

/** A loopback origin (the recording proxy's), the only kind the panel talks to. */
const loopback = (raw: string | null): string | null => {
	const u = URL.parse(raw ?? '');
	return u &&
		u.protocol === 'http:' &&
		['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) &&
		u.origin === raw
		? u.origin
		: null;
};

export const load: PageLoad = ({ params, url }) => {
	const back = url.searchParams.get('back') ?? '';
	return {
		taskId: params.id,
		title: url.searchParams.get('title') || params.id,
		preview: url.searchParams.get('preview') ?? '',
		from: loopback(url.searchParams.get('from')),
		back:
			back.startsWith('/') && !back.startsWith('//') && !back.includes('\\')
				? back
				: `/tasks/${encodeURIComponent(params.id)}`
	};
};
