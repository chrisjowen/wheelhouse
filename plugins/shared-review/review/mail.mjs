/**
 * Sending sign-in links. Two senders: SMTP, which every email provider
 * offers (`smtps://user:password@smtp.example.com:465`, or `smtp://…:587`,
 * which must offer STARTTLS; only a relay on this computer, such as
 * `smtp://127.0.0.1:25`, is spoken to in plain text), and an outbox folder for trying it on one
 * computer, which writes each message to a file readable only by its owner.
 * Neither logs a message or a link.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { randomId, tidy } from './lib.mjs';

/** An RFC 5322 message: plain text, UTF-8, the body base64-encoded so any server takes it. */
export function message({ from, to, subject, text, domain }) {
	const b64 = Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
	const enc = (s) =>
		/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
	return [
		`From: ${tidy(from)}`,
		`To: <${to}>`,
		`Subject: ${enc(tidy(subject, 200))}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${randomId(12)}@${domain}>`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=utf-8',
		'Content-Transfer-Encoding: base64',
		'',
		b64,
		''
	].join('\r\n');
}

/** The address inside a From value such as `Reviews <reviews@example.com>`. */
export function address(from) {
	const m = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from) ?? /^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(from);
	return m ? m[1] : null;
}

/** Writes each message to `<dir>/<time>-<id>.eml`, mode 0600. */
export function outboxSender(dir) {
	return {
		kind: 'outbox',
		async send({ to, raw }) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			const file = path.join(dir, `${Date.now()}-${randomId(6)}.eml`);
			writeFileSync(file, `X-Outbox-To: ${to}\r\n${raw}`, { mode: 0o600 });
		}
	};
}

/** Sends through an SMTP server named by URL (credentials in the URL, which is a secret). */
export function smtpSender(smtpUrl, o = {}) {
	const u = new URL(smtpUrl);
	if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') {
		throw new Error('the SMTP address must start with smtp:// or smtps://');
	}
	const implicit = u.protocol === 'smtps:';
	// A relay on this computer (smtp://127.0.0.1:25) may speak plain SMTP; anywhere else must use TLS.
	const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
	const port = Number(u.port || (implicit ? 465 : 587));
	const user = decodeURIComponent(u.username);
	const pass = decodeURIComponent(u.password);
	return {
		kind: 'smtp',
		send: ({ from, to, raw }) =>
			smtpSend({
				host: u.hostname,
				port,
				implicit,
				plain: !implicit && local,
				user,
				pass,
				from,
				to,
				raw,
				...o
			})
	};
}

/** One SMTP conversation: EHLO, STARTTLS (unless already TLS), AUTH PLAIN, MAIL, RCPT, DATA, QUIT. */
function smtpSend({
	host,
	port,
	implicit,
	plain,
	user,
	pass,
	from,
	to,
	raw,
	timeoutMs = 20_000,
	tlsOptions = {}
}) {
	return new Promise((resolve, reject) => {
		let socket = implicit
			? tls.connect({ host, port, servername: host, ...tlsOptions })
			: net.connect({ host, port });
		let buf = '';
		/** Reply codes not yet read, and a reader waiting for one. */
		const replies = [];
		let waiting = null;
		const fail = (e) => {
			socket.destroy();
			reject(e instanceof Error ? e : new Error(String(e)));
		};
		const timer = setTimeout(
			() => fail(new Error('the mail server did not answer in time')),
			timeoutMs
		);
		const onData = (d) => {
			buf += d.toString('utf8');
			let nl;
			while ((nl = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, nl);
				buf = buf.slice(nl + 1);
				// A reply's last line is `NNN text`; earlier ones are `NNN-text`.
				const m = /^(\d{3})(?: |$)/.exec(line);
				if (!m) continue;
				if (waiting) {
					const w = waiting;
					waiting = null;
					w(Number(m[1]));
				} else replies.push(Number(m[1]));
			}
		};
		const read = () =>
			replies.length ? Promise.resolve(replies.shift()) : new Promise((r) => (waiting = r));
		const say = async (cmd, ok) => {
			if (cmd !== null) socket.write(`${cmd}\r\n`);
			const code = await read();
			if (!ok.includes(code)) {
				// Never echo the command: AUTH carries the password.
				throw new Error(
					`the mail server refused (${code}) at ${cmd === null ? 'greeting' : cmd.split(' ')[0]}`
				);
			}
			return code;
		};
		const attach = (s) => {
			s.on('data', onData);
			s.on('error', fail);
		};
		attach(socket);
		(async () => {
			const name = 'review-server';
			await say(null, [220]);
			await say(`EHLO ${name}`, [250]);
			if (!implicit && !plain) {
				await say('STARTTLS', [220]);
				socket.removeListener('data', onData);
				socket = tls.connect({ socket, servername: host, ...tlsOptions });
				attach(socket);
				await new Promise((r, j) => {
					socket.once('secureConnect', r);
					socket.once('error', j);
				});
				await say(`EHLO ${name}`, [250]);
			}
			if (user) {
				const plain = Buffer.from(`\u0000${user}\u0000${pass}`).toString('base64');
				await say(`AUTH PLAIN ${plain}`, [235]);
			}
			await say(`MAIL FROM:<${from}>`, [250]);
			await say(`RCPT TO:<${to}>`, [250, 251]);
			await say('DATA', [354]);
			const body = raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
			socket.write(body.endsWith('\r\n') ? body : `${body}\r\n`);
			await say('.', [250]);
			socket.write('QUIT\r\n');
			socket.end();
		})().then(
			() => {
				clearTimeout(timer);
				resolve();
			},
			(e) => {
				clearTimeout(timer);
				fail(e);
			}
		);
	});
}
