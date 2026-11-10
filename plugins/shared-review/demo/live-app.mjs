/**
 * A stand-in for a worker's dev server: a small app on loopback with
 * absolute asset paths and an API it calls from the page, the shapes a real
 * dev server has. `node live-app.mjs [port]` prints its address.
 */

import http from 'node:http';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tide tables</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header><h1>Tide tables</h1><p id="place">Loading…</p></header>
<main>
<table id="tides"><thead><tr><th>Time</th><th>Tide</th><th>Height</th></tr></thead><tbody></tbody></table>
<button id="refresh" type="button">Refresh</button>
</main>
<script src="/assets/app.js"></script>
</body>
</html>`;

const CSS = `body { margin: 0; font-family: system-ui, sans-serif; background: #eef5f8; color: #12303d; }
header { padding: 1.25rem 1.5rem; background: #12303d; color: #eef5f8; }
header h1 { margin: 0; font-size: 1.4rem; }
main { max-width: 32rem; margin: 1.5rem auto; padding: 1rem; background: #fff; border-radius: 10px; }
table { width: 100%; border-collapse: collapse; }
td, th { text-align: left; padding: 0.45rem; border-bottom: 1px solid #dde8ed; }
button { margin-top: 1rem; padding: 0.5rem 1rem; border: 0; border-radius: 6px; background: #1f6f8b; color: #fff; }`;

const JS = `async function load() {
	const r = await fetch('/api/tides');
	const v = await r.json();
	document.getElementById('place').textContent = v.place + ' · served live at ' + v.at;
	const body = document.querySelector('#tides tbody');
	body.replaceChildren(...v.tides.map((t) => {
		const tr = document.createElement('tr');
		for (const x of [t.time, t.kind, t.height]) { const td = document.createElement('td'); td.textContent = x; tr.append(td); }
		return tr;
	}));
}
document.getElementById('refresh').addEventListener('click', load);
load();`;

export function startLiveApp(port = 0) {
	const server = http.createServer((req, res) => {
		const send = (type, body) => {
			res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
			res.end(body);
		};
		if (req.url === '/' || req.url?.startsWith('/?')) return send('text/html; charset=utf-8', PAGE);
		if (req.url === '/assets/app.css') return send('text/css', CSS);
		if (req.url === '/assets/app.js') return send('text/javascript', JS);
		if (req.url === '/api/tides') {
			return send(
				'application/json',
				JSON.stringify({
					place: 'Harbour mouth',
					at: new Date().toLocaleTimeString('en-GB'),
					tides: [
						{ time: '04:12', kind: 'High', height: '4.6 m' },
						{ time: '10:31', kind: 'Low', height: '0.9 m' },
						{ time: '16:40', kind: 'High', height: '4.4 m' },
						{ time: '22:55', kind: 'Low', height: '1.1 m' }
					]
				})
			);
		}
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('Not found');
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const s = await startLiveApp(Number(process.argv[2] ?? 0));
	console.log(`http://127.0.0.1:${s.address().port}/`);
}
