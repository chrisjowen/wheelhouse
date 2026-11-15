#!/usr/bin/env node
import { protocol } from '../src/lib/server/events/extension';
let request: Record<string, unknown> = {};
try {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		const b = Buffer.from(chunk);
		size += b.length;
		if (size > 65536) throw new Error('Request too large.');
		chunks.push(b);
	}
	request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
	process.stdout.write(JSON.stringify(await protocol(process.argv[2], request)));
} catch {
	process.stdout.write(
		JSON.stringify({
			schema: 'firstmate.extension-response.v1',
			request_id: request.request_id ?? '',
			ok: false,
			result: null,
			error: {
				code: 'invalid-request',
				retryable: false,
				diagnostic: 'Wheelhouse events request refused.'
			}
		})
	);
}
