#!/usr/bin/env node
/**
 * Shared review: the review server, the desk and the commands Firstmate and
 * workers use. One file to run, no dependencies (Node 22 or later).
 *
 *   node main.mjs serve                         the review server (configured by REVIEW_* variables; see the README)
 *   node main.mjs desk --port <n>               the review desk on this computer (Wheelhouse launches it)
 *   node main.mjs start --live <url> | --static <dir> [--task <id>] [--title <t>] [--spa] [--start </path>]
 *                       [--email <addresses>]   start a review as a local preview; prints its link and passcode
 *   node main.mjs list [--task <id>]            reviews, with their state and comments
 *   node main.mjs go-live <id>                  move a local preview to the review server (only once the captain agrees)
 *   node main.mjs close <id>                    close a review: the link goes down, and its comments print as the bundle
 *   node main.mjs show <id>                     a review's comments, or its bundle once closed
 *   node main.mjs status [--task <id>] --json   what Wheelhouse's plugin reads
 *
 * Every command but `serve` finds the desk through desk.json in the state
 * folder (--state, $WH_REVIEW_STATE, else Wheelhouse's state folder's
 * plugins/shared-review). Add --json for machine-readable output.
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Desk, deskRecord, stateDir } from './desk.mjs';
import { VERSION } from './lib.mjs';
import { outboxSender, smtpSender } from './mail.mjs';
import { ReviewServer } from './server.mjs';

const FLAGS = new Set(['json', 'spa', 'help']);

/** `--name value` and `--flag` options, and the rest in order. */
export function parseArgs(argv) {
	const opts = {};
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) {
			rest.push(a);
			continue;
		}
		const eq = a.indexOf('=');
		const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
		if (eq > 0) opts[name] = a.slice(eq + 1);
		else if (FLAGS.has(name)) opts[name] = true;
		else {
			if (i + 1 >= argv.length) throw new Error(`--${name} needs a value`);
			opts[name] = argv[++i];
		}
	}
	return { opts, rest };
}

class Usage extends Error {}

async function deskCall(dir, method, p, body) {
	const d = deskRecord(dir);
	if (!d) {
		throw new Usage(
			'The review desk is not running. Launch it from Wheelhouse (the Reviews page, or a task’s Shared review section), or run `node main.mjs desk --port <port>`.'
		);
	}
	let r;
	try {
		r = await fetch(`${d.url}/_review/desk/${p}`, {
			method,
			headers: {
				'x-review-desk-key': d.key,
				...(body ? { 'content-type': 'application/json' } : {})
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(120_000)
		});
	} catch {
		throw new Usage(`The review desk at ${d.url} did not answer; launch it again from Wheelhouse.`);
	}
	const v = await r.json().catch(() => ({}));
	if (!r.ok) throw new Usage(v.error ?? `The desk answered ${r.status}.`);
	return v;
}

const print = (s = '') => process.stdout.write(`${s}\n`);

function describe(rv) {
	const where =
		rv.where === 'local' ? 'local preview (this computer only)' : `live on ${rv.server}`;
	const lines = [
		`${rv.id}  ${rv.title}`,
		`  ${rv.state === 'open' ? where : rv.state}${rv.task ? `  task ${rv.task}` : ''}`
	];
	if (rv.link) lines.push(`  link: ${rv.link}`);
	if (rv.passcode) lines.push(`  passcode: ${rv.passcode}`);
	if (rv.shareLink && rv.shareLink !== rv.link)
		lines.push(`  link with the passcode, to share: ${rv.shareLink}`);
	if (rv.tunnel) lines.push(`  live app ${rv.source.url}: ${rv.tunnel}`);
	lines.push(
		`  ${rv.comments.length} comment${rv.comments.length === 1 ? '' : 's'}${rv.people.length ? ` from ${rv.people.join(', ')}` : ''}`
	);
	if (rv.problem) lines.push(`  problem: ${rv.problem}`);
	return lines.join('\n');
}

/** The closing note, as Firstmate gets it from Wheelhouse. */
function noteText(rv, list) {
	return [
		`Comments from ${list.subject}:`,
		...list.items.flatMap((it, i) => [
			`${i + 1}. ${it.text}`,
			...(it.points ? [`   Points at: ${it.points}`] : [])
		]),
		...(rv.bundleFile ? ['', `Full bundle: ${rv.bundleFile}`] : [])
	].join('\n');
}

async function serve(env) {
	const need = (k) => {
		if (!env[k]) throw new Usage(`Set ${k}.`);
		return env[k];
	};
	const publicUrl = need('REVIEW_PUBLIC_URL');
	const ownerToken = need('REVIEW_OWNER_TOKEN');
	const [host, port] = (env.REVIEW_LISTEN ?? '127.0.0.1:8080').split(/:(?=\d+$)/);
	let mailer = null;
	if (env.REVIEW_SMTP_URL) mailer = smtpSender(env.REVIEW_SMTP_URL);
	else if (env.REVIEW_OUTBOX_DIR) mailer = outboxSender(path.resolve(env.REVIEW_OUTBOX_DIR));
	if (mailer && !env.REVIEW_EMAIL_FROM)
		throw new Usage('Set REVIEW_EMAIL_FROM to send sign-in links.');
	const server = new ReviewServer({
		dataDir: path.resolve(env.REVIEW_DATA_DIR ?? 'review-data'),
		publicUrl,
		ownerToken,
		sessionSecret: env.REVIEW_SESSION_SECRET,
		mailer,
		emailFrom: env.REVIEW_EMAIL_FROM ?? null,
		trustProxy: env.REVIEW_TRUST_PROXY === '1'
	});
	const s = http.createServer((req, res) => void server.handle(req, res));
	s.requestTimeout = 120_000;
	await new Promise((r) => s.listen(Number(port), host, r));
	const at = s.address();
	console.log(
		`shared review ${VERSION} at ${publicUrl} (listening on ${at.address}:${at.port}; sign-in by ${server.methods().join(' or ')})`
	);
	const stop = () => s.close(() => process.exit(0));
	process.on('SIGTERM', stop);
	process.on('SIGINT', stop);
}

export async function main(argv, env = process.env) {
	const [cmd, ...args] = argv;
	const { opts, rest } = parseArgs(args);
	const dir = opts.state ? path.resolve(opts.state) : stateDir(env);
	const json = opts.json === true;
	switch (cmd) {
		case 'serve':
			return serve(env);
		case 'desk': {
			const remoteUrl = opts.remote ?? env.REVIEW_REMOTE_URL ?? null;
			const tokenName = opts['token-env'] ?? 'SHARED_REVIEW_OWNER_TOKEN';
			const desk = await new Desk({
				dir,
				port: Number(opts.port ?? 0),
				remote: remoteUrl ? { url: remoteUrl, token: env[tokenName] || null, tokenName } : null
			}).start();
			const stop = () => desk.stop().then(() => process.exit(0));
			process.on('SIGTERM', stop);
			process.on('SIGINT', stop);
			return;
		}
		case 'start': {
			if (!opts.live === !opts.static)
				throw new Usage('Start a review with --live <address> or --static <folder>.');
			const body = {
				task: opts.task ?? env.FM_TASK_ID ?? null,
				project: opts.project ?? null,
				title: opts.title ?? null,
				start: opts.start,
				source: opts.live
					? { kind: 'live', url: opts.live }
					: { kind: 'static', dir: path.resolve(opts.static), spa: opts.spa === true },
				signIn: opts.email ? ['email'] : ['passcode'],
				invitees: opts.email
					? String(opts.email)
							.split(/[\s,]+/)
							.filter(Boolean)
					: []
			};
			const { review } = await deskCall(dir, 'POST', 'reviews', body);
			if (json) return print(JSON.stringify(review, null, '\t'));
			print(describe(review));
			print('');
			print('This is a local preview: only this computer can open it.');
			print(
				`Once the captain agrees to share it, put it live with: node ${process.argv[1] ?? 'main.mjs'} go-live ${review.id}`
			);
			return;
		}
		case 'list':
		case 'status': {
			if (cmd === 'status') {
				const d = deskRecord(dir);
				if (!d)
					return print(JSON.stringify({ desk: null, problem: 'not running', cwd: process.cwd() }));
				try {
					const v = await deskCall(
						dir,
						'GET',
						`state${opts.task ? `?task=${encodeURIComponent(opts.task)}` : ''}`
					);
					return print(
						JSON.stringify({
							desk: {
								url: d.url,
								key: d.key,
								version: v.version,
								remote: v.remote,
								cwd: process.cwd()
							},
							reviews: v.reviews
						})
					);
				} catch (e) {
					return print(JSON.stringify({ desk: null, problem: e.message, cwd: process.cwd() }));
				}
			}
			const v = await deskCall(
				dir,
				'GET',
				`state${opts.task ? `?task=${encodeURIComponent(opts.task)}` : ''}`
			);
			if (json) return print(JSON.stringify(v, null, '\t'));
			if (!v.reviews.length) print('No reviews yet.');
			for (const rv of v.reviews) print(`${describe(rv)}\n`);
			print(
				v.remote.state === 'ready' ? `Going live puts reviews on ${v.remote.url}.` : v.remote.reason
			);
			return;
		}
		case 'go-live': {
			if (!rest[0]) throw new Usage('Name the review: go-live <id>.');
			const { review } = await deskCall(dir, 'POST', `reviews/${rest[0]}/live`, {});
			return print(json ? JSON.stringify(review, null, '\t') : describe(review));
		}
		case 'close': {
			if (!rest[0]) throw new Usage('Name the review: close <id>.');
			const v = await deskCall(dir, 'POST', `reviews/${rest[0]}/close`, {});
			await deskCall(dir, 'POST', `reviews/${rest[0]}/delivered`, {});
			if (json) return print(JSON.stringify(v.bundle, null, '\t'));
			print(`Closed ${v.review.id}: the link is down.`);
			print('');
			print(noteText(v.review, v.feedback));
			return;
		}
		case 'show': {
			if (!rest[0]) throw new Usage('Name the review: show <id>.');
			const v = await deskCall(dir, 'GET', 'state');
			const rv = v.reviews.find((r) => r.id === rest[0]);
			if (!rv) throw new Usage(`There is no review ${rest[0]}.`);
			if (rv.state !== 'open') {
				const b = await deskCall(dir, 'GET', `reviews/${rv.id}/bundle`);
				return print(JSON.stringify(b, null, '\t'));
			}
			if (json) return print(JSON.stringify(rv, null, '\t'));
			print(describe(rv));
			for (const c of rv.comments)
				print(
					`\n- ${c.author}${c.parent ? ' (reply)' : ''}, on ${c.anchor.label} (${c.anchor.path}):\n  ${c.body.replace(/\n/g, '\n  ')}`
				);
			return;
		}
		default:
			print(
				'Usage: node main.mjs serve | desk | start | list | go-live | close | show | status (see the header of main.mjs)'
			);
			if (cmd && cmd !== 'help' && !opts.help) process.exitCode = 2;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).catch((e) => {
		process.stderr.write(`${e instanceof Usage ? '' : 'shared review: '}${e.message}\n`);
		process.exit(e instanceof Usage ? 2 : 1);
	});
}
