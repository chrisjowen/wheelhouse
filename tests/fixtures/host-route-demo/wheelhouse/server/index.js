/**
 * An example of a host route and an address rewrite, in the installed-plugin
 * format, with no dependencies. While it is on, Wheelhouse shows addresses on
 * its computer at `{port}.localhost` and hands requests for that name to
 * `echo`, which answers with what it was asked and what Wheelhouse told it,
 * and echoes each WebSocket text message back. Wheelhouse's tests load it.
 *
 * @typedef {import('../../../../../packages/plugin-sdk/index.js').WheelhousePlugin} WheelhousePlugin
 */

import { createHash } from 'node:crypto';

/** @type {WheelhousePlugin} */
export default {
	providers: [],
	contributions: [],
	hostRoutes: [
		{
			id: 'echo',
			async request(req, res, ctx) {
				const body = JSON.stringify({
					method: req.method,
					url: req.url,
					host: ctx.host,
					origin: ctx.origin,
					port: ctx.port,
					settings: ctx.settings,
					loopbackAddresses: await ctx.loopbackAddresses(),
					reservedPorts: ctx.reservedPorts()
				});
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(body);
			},
			upgrade(req, socket, _head, ctx) {
				const key = req.headers['sec-websocket-key'];
				const accept = createHash('sha1')
					.update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
					.digest('base64');
				socket.write(
					'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
						`Sec-WebSocket-Accept: ${accept}\r\n\r\n`
				);
				socket.on('data', (/** @type {Buffer} */ frame) => {
					// One small masked text frame from the client; anything else closes the socket.
					const opcode = frame[0] & 0x0f;
					const length = frame[1] & 0x7f;
					if (opcode !== 1 || !(frame[1] & 0x80) || length > 125) return socket.end();
					const mask = frame.subarray(2, 6);
					const text = Buffer.from(frame.subarray(6, 6 + length).map((b, i) => b ^ mask[i % 4]));
					const reply = Buffer.from(`echo ${text} on ${ctx.port}`);
					socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
				});
			}
		}
	]
};
