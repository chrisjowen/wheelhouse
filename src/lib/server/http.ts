import { json } from '@sveltejs/kit';

export const NO_STORE = { 'cache-control': 'no-store' };

/**
 * A request's JSON object body, or the response that refuses it: wrong
 * content type (415), too large (413) or not a JSON object (400).
 */
export async function readJson(
	request: Request,
	maxBytes: number
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
	const refuse = (message: string, status: number) => ({
		ok: false as const,
		response: json({ message }, { status, headers: NO_STORE })
	});
	if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
		return refuse('Send the request as JSON.', 415);
	}
	const raw = await request.text();
	if (Buffer.byteLength(raw) > maxBytes) return refuse('The request is too large.', 413);
	try {
		const body: unknown = JSON.parse(raw);
		if (body && typeof body === 'object' && !Array.isArray(body)) {
			return { ok: true, body: body as Record<string, unknown> };
		}
	} catch {
		// fall through
	}
	return refuse('The request is not valid JSON.', 400);
}
