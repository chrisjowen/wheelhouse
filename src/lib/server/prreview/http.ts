import { error, json } from '@sveltejs/kit';
import { reviewSubject } from '../detail';
import type { ReviewService, ReviewSubject, StartResult } from './service';

const MAX_BODY = 16 * 1024;

/** A review request's JSON body (small), or a 400. */
export async function body(request: Request): Promise<Record<string, unknown>> {
	const text = await request.text();
	if (text.length > MAX_BODY) error(413, 'That request is too large.');
	if (!text.trim()) return {};
	try {
		const v = JSON.parse(text);
		if (v && typeof v === 'object' && !Array.isArray(v)) return v;
	} catch {
		// fall through
	}
	error(400, 'Send a JSON object.');
}

export const optString = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Start a review agent run for a task and answer with it (202), or the reason it cannot run. */
export async function start(
	id: string,
	fn: (review: ReviewService, subject: ReviewSubject) => Promise<StartResult>
): Promise<Response> {
	const r = await reviewSubject(id);
	if (!r.ok) error(r.status, r.message);
	const res = await fn(r.runtime.review, r.subject);
	if (!res.ok) return json({ message: res.message }, { status: res.status });
	return json(res, { status: res.run ? 202 : 200 });
}
