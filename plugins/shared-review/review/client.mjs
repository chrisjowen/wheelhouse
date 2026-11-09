/**
 * The owner's side of a review server's API (/_review/api/…), for the desk:
 * the same calls reach the desk's own server on this computer and a deployed
 * one, each with its own owner token. The token is sent only in the
 * Authorization header and never appears in an error.
 */

export class OwnerClient {
	constructor(server, token, fetchImpl = fetch) {
		this.server = server.replace(/\/+$/, '');
		this.token = token;
		this.fetch = fetchImpl;
	}

	async call(method, p, o = {}) {
		let r;
		try {
			r = await this.fetch(`${this.server}/_review/api/${p}`, {
				method,
				headers: {
					authorization: `Bearer ${this.token}`,
					...(o.json !== undefined ? { 'content-type': 'application/json' } : {}),
					...(o.raw !== undefined ? { 'content-type': 'application/octet-stream' } : {})
				},
				body: o.json !== undefined ? JSON.stringify(o.json) : o.raw,
				signal: AbortSignal.timeout(o.timeoutMs ?? 15_000)
			});
		} catch (e) {
			throw new Error(
				`${this.server} did not answer (${e instanceof Error ? e.message : String(e)})`
			);
		}
		const v = await r.json().catch(() => ({}));
		if (!r.ok) {
			const err = new Error(
				typeof v.error === 'string' ? v.error : `${this.server} answered ${r.status}`
			);
			err.status = r.status;
			throw err;
		}
		return v;
	}

	info(o) {
		return this.call('GET', 'info', o);
	}
	list() {
		return this.call('GET', 'reviews');
	}
	create(body) {
		return this.call('POST', 'reviews', { json: body, timeoutMs: 30_000 });
	}
	get(rid) {
		return this.call('GET', `reviews/${rid}`);
	}
	putFile(rid, rel, buf) {
		const p = rel.split('/').map(encodeURIComponent).join('/');
		return this.call('PUT', `reviews/${rid}/files/${p}`, { raw: buf, timeoutMs: 60_000 });
	}
	open(rid) {
		return this.call('POST', `reviews/${rid}/open`, { json: {} });
	}
	close(rid) {
		return this.call('POST', `reviews/${rid}/close`, { json: {} });
	}
	purge(rid) {
		return this.call('DELETE', `reviews/${rid}`);
	}
}
