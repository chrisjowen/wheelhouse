import { json } from '@sveltejs/kit';
import { NO_STORE, readJson } from '$lib/server/http';
import { illustrate } from '$lib/server/live/illustrate';
import { which } from '$lib/server/sessions/tmux';
import type { RequestHandler } from './$types';

/** A picture the discussion crew asked the illustrator for, as SVG. */
export const POST: RequestHandler = async ({ request }) => {
	const read = await readJson(request, 8192);
	if (!read.ok) return read.response;
	const { prompt, title } = read.body;
	if (typeof prompt !== 'string' || !prompt.trim())
		return json({ message: 'Say what to draw.' }, { status: 400, headers: NO_STORE });
	const claude = process.env.WHEELHOUSE_LIVE_CLAUDE || which('claude', process.env.PATH);
	if (!claude)
		return json(
			{ message: 'Drawing needs Claude Code (claude) on PATH.' },
			{ status: 503, headers: NO_STORE }
		);
	const ask = `${typeof title === 'string' && title.trim() ? `Title: ${title.trim()}\n` : ''}${prompt.trim()}`;
	const svg = await illustrate(
		claude,
		ask.slice(0, 2000),
		process.env.WHEELHOUSE_LIVE_MODEL || 'sonnet'
	);
	return svg
		? json({ svg }, { headers: NO_STORE })
		: json(
				{ message: 'The illustrator did not return a picture.' },
				{ status: 502, headers: NO_STORE }
			);
};
