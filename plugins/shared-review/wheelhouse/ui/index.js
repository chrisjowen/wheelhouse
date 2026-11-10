/**
 * Shared review's elements: <shared-review-page> (the Reviews page) and
 * <shared-review-task> (the Shared review section on a task). Wheelhouse
 * sets `host`, `entry` and `data` (the provider's value: the desk's address
 * and key, the settings, the reviews). The buttons talk to the review desk on
 * this computer with that key; closing a review sends its comments to
 * Firstmate with `host.sendFeedback`, called first thing in the click, so it
 * is the captain's own click that sends them.
 *
 * Every value from a review (titles, names, comments, links) is set as text,
 * never as HTML, and only http(s) links are made clickable.
 */

const STYLE = `
:host { display: block; color: var(--foreground); font-family: var(--font-sans, inherit); font-size: 0.875rem; }
* { box-sizing: border-box; }
h2 { font-family: var(--font-display, inherit); font-size: 1.05rem; font-weight: 600; margin: 0 0 0.25rem; }
h3 { font-size: 0.95rem; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
p { margin: 0.25rem 0; }
a { color: var(--sea); text-decoration: none; overflow-wrap: anywhere; }
a:hover { text-decoration: underline; }
code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.8rem; background: var(--muted); padding: 0.1rem 0.3rem; border-radius: 4px; overflow-wrap: anywhere; }
.muted { color: var(--muted-foreground); }
.stack { display: grid; gap: 0.75rem; }
.card { border: 1px solid var(--border); background: var(--card); color: var(--card-foreground, inherit); border-radius: var(--radius, 10px); padding: 0.85rem 1rem; display: grid; gap: 0.5rem; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.75rem; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 0.75rem; }
.chip { display: inline-block; border-radius: 999px; padding: 0.05rem 0.55rem; font-size: 0.75rem; border: 1px solid var(--border); color: var(--muted-foreground); white-space: nowrap; }
.chip.local { color: var(--sea); border-color: color-mix(in srgb, var(--sea) 45%, transparent); }
.chip.live { color: var(--success, #1b7a43); border-color: color-mix(in srgb, var(--success, #1b7a43) 45%, transparent); }
.chip.warn { color: var(--warning, #a15c00); border-color: color-mix(in srgb, var(--warning, #a15c00) 45%, transparent); }
button { font: inherit; font-size: 0.8rem; border-radius: 999px; padding: 0.3rem 0.8rem; border: 1px solid var(--border); background: transparent; color: var(--foreground); cursor: pointer; }
button.primary { background: var(--primary); color: var(--primary-foreground); border-color: var(--primary); }
button.danger { color: var(--danger, #b42318); border-color: color-mix(in srgb, var(--danger, #b42318) 50%, transparent); }
button:disabled { opacity: 0.55; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--ring, var(--sea)); outline-offset: 2px; }
input[type=text] { font: inherit; width: 100%; padding: 0.35rem 0.55rem; border-radius: 6px; border: 1px solid var(--input, var(--border)); background: var(--background); color: var(--foreground); }
label { display: grid; gap: 0.25rem; }
label.inline { display: flex; align-items: center; gap: 0.4rem; }
.secret { font-family: var(--font-mono, ui-monospace, monospace); letter-spacing: 0.04em; }
.comments { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; max-height: 22rem; overflow: auto; }
.comments li { border-left: 2px solid var(--border); padding: 0.1rem 0 0.1rem 0.6rem; }
.comments li.reply { margin-left: 1rem; }
.comments .body { white-space: pre-wrap; overflow-wrap: anywhere; }
.note { border-radius: 8px; padding: 0.5rem 0.7rem; background: var(--muted); }
.error { color: var(--danger, #b42318); }
.ok { color: var(--success, #1b7a43); }
.picks { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.3rem; max-height: 22rem; overflow: auto; }
.picks label { display: flex; align-items: flex-start; gap: 0.5rem; cursor: pointer; }
.picks input { margin-top: 0.2rem; flex: none; }
.picks .what { display: grid; gap: 0.1rem; min-width: 0; }
.picks .body { overflow-wrap: anywhere; }
details summary { cursor: pointer; color: var(--muted-foreground); }
details[open] summary { margin-bottom: 0.4rem; }
`;

/** Only http(s) links are made clickable. */
const safe = (href) => {
	try {
		const u = new URL(href);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
	} catch {
		return null;
	}
};

/** An element with a class and text. */
function h(tag, cls, text) {
	const n = document.createElement(tag);
	if (cls) n.className = cls;
	if (text !== undefined && text !== null) n.textContent = String(text);
	return n;
}

function button(label, cls, onClick) {
	const b = h('button', cls, label);
	b.type = 'button';
	b.addEventListener('click', onClick);
	return b;
}

function link(href, text) {
	const url = safe(href);
	if (!url) return h('span', '', text);
	const a = h('a', '', text);
	a.href = url;
	a.target = '_blank';
	a.rel = 'noreferrer';
	return a;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hostOf = (u) => {
	try {
		return new URL(u).host;
	} catch {
		return u;
	}
};

function when(iso) {
	const t = Date.parse(iso ?? '');
	if (Number.isNaN(t)) return '';
	const s = Math.round((Date.now() - t) / 1000);
	if (s < 45) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
	return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const POLL_MS = 5_000;

class ReviewElement extends HTMLElement {
	#data = null;
	/** Reviews as the desk last said, when the element asked it itself, and when. */
	#fresh = null;
	#freshAt = 0;
	#timer = null;
	/** Per review: what the captain is asked to confirm, and what happened. */
	ui = new Map();
	busy = new Set();
	launching = null;
	/** The thread selection whose note the desk is making (see prepare). */
	preparing = null;

	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
	}

	set data(v) {
		// Wheelhouse may hand over a cached value older than what this element just asked the desk.
		const remote = this.#data?.desk?.remote;
		this.#data = v;
		if (this.#fresh && !(typeof v?.readAt === 'number' && v.readAt > this.#freshAt)) {
			if (v?.desk && remote) v.desk.remote = remote;
		} else this.#fresh = null;
		this.render();
		this.poll();
	}

	get data() {
		return this.#data;
	}

	connectedCallback() {
		this.render();
		this.poll();
	}

	disconnectedCallback() {
		clearTimeout(this.#timer);
		this.#timer = null;
	}

	get reviews() {
		return this.#fresh ?? this.#data?.reviews ?? [];
	}

	/** Ask the desk for the reviews every few seconds while the element is on screen. */
	poll() {
		clearTimeout(this.#timer);
		if (!this.isConnected || !this.#data?.desk) return;
		this.#timer = setTimeout(async () => {
			if (!document.hidden) {
				try {
					const task = this.taskId;
					const v = await this.desk(
						'GET',
						`state${task ? `?task=${encodeURIComponent(task)}` : ''}`
					);
					const before = JSON.stringify(this.reviews);
					this.#fresh = v.reviews;
					this.#freshAt = Date.now();
					if (this.#data?.desk) this.#data.desk.remote = v.remote;
					if (JSON.stringify(v.reviews) !== before && !this.typing()) this.render();
				} catch {
					// The provider says when the desk is gone.
				}
			}
			this.poll();
		}, POLL_MS);
	}

	typing() {
		const a = this.shadowRoot?.activeElement;
		return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
	}

	get taskId() {
		return null;
	}

	async desk(method, p, body) {
		const d = this.#data?.desk;
		if (!d) throw new Error('The review desk is not running.');
		let r;
		try {
			r = await fetch(`${d.url}/_review/desk/${p}`, {
				method,
				headers: {
					'x-review-desk-key': d.key,
					...(body ? { 'content-type': 'application/json' } : {})
				},
				body: body ? JSON.stringify(body) : undefined
			});
		} catch {
			throw new Error('The review desk did not answer. Launch it again.');
		}
		const v = await r.json().catch(() => ({}));
		if (!r.ok) throw new Error(v.error ?? `The review desk answered ${r.status}.`);
		return v;
	}

	/** Ask the desk again now, after a change. */
	async reload() {
		try {
			const task = this.taskId;
			const v = await this.desk('GET', `state${task ? `?task=${encodeURIComponent(task)}` : ''}`);
			this.#fresh = v.reviews;
			this.#freshAt = Date.now();
			if (this.#data?.desk) this.#data.desk.remote = v.remote;
		} catch {
			// keep what we have
		}
		this.render();
	}

	setUi(id, v) {
		if (v === null) this.ui.delete(id);
		else this.ui.set(id, v);
		this.render();
	}

	/* ------------------------------------------------------------ desk */

	deskCard() {
		const d = this.#data;
		if (d?.desk) return null;
		const card = h('div', 'card');
		card.append(h('h3', '', 'The review desk is not running'));
		card.append(
			h(
				'p',
				'muted',
				'It runs on this computer: it holds local previews, connects live apps and reaches your review server. Wheelhouse starts it only when you click.'
			)
		);
		if (d?.deskProblem) card.append(h('p', 'error', d.deskProblem));
		const row = h('div', 'row');
		const status = h('span', 'muted');
		const launch = button('Launch the review desk', 'primary', async () => {
			launch.disabled = true;
			status.textContent = 'Starting…';
			try {
				const v = await this.host?.launch('desk');
				if (!v) status.textContent = 'This Wheelhouse cannot start it.';
				else if (v.state === 'running')
					status.textContent = 'Started. Reviews show here in a few seconds.';
				else {
					status.textContent = v.reason ?? `It did not start (${v.state}).`;
					if (v.hint) status.append(' Start it by hand: ', h('code', '', v.hint));
					launch.disabled = false;
				}
			} catch (e) {
				status.textContent = e instanceof Error ? e.message : String(e);
				launch.disabled = false;
			}
		});
		row.append(launch, status);
		card.append(row);
		return card;
	}

	/* ---------------------------------------------------------- reviews */

	reviewCard(rv, o = {}) {
		const card = h('div', 'card');
		const head = h('div', 'head');
		const title = h('h3', '', rv.title);
		const chips = h('div', 'row');
		const remote = this.#data?.desk?.remote;
		if (rv.state === 'open') {
			chips.append(
				rv.where === 'local'
					? h('span', 'chip local', 'Local preview')
					: h('span', 'chip live', `Live on ${hostOf(rv.server)}`)
			);
		} else {
			chips.append(h('span', 'chip', rv.sent ? 'Closed, sent to Firstmate' : 'Closed'));
		}
		head.append(title, chips);
		card.append(head);

		if (o.showTask && rv.task) {
			const known = this.#data?.tasks?.[rv.task];
			const p = h('p', 'muted', 'Task ');
			const a = h('a', '', known ? `${rv.task} · ${known}` : rv.task);
			a.href = `/tasks/${encodeURIComponent(rv.task)}`;
			p.append(a);
			card.append(p);
		}

		if (rv.state === 'open' && rv.link) {
			const row = h('div', 'row');
			row.append(link(rv.link, rv.link), this.copy('Copy link', rv.link));
			card.append(row);
			if (rv.passcode) {
				const shown = this.ui.get(`pass:${rv.id}`);
				const pr = h('div', 'row');
				pr.append(
					h('span', 'muted', 'Passcode'),
					h('span', 'secret', shown ? rv.passcode : '••••-••••-••••')
				);
				pr.append(
					button(shown ? 'Hide' : 'Show', '', () =>
						this.setUi(`pass:${rv.id}`, shown ? null : true)
					)
				);
				pr.append(this.copy('Copy passcode', rv.passcode));
				card.append(pr);
			}
			const how =
				rv.where === 'local'
					? 'Only this computer can open it. Reviewers sign in with the passcode.'
					: rv.share.signIn.includes('email') && rv.share.signIn.includes('passcode')
						? `Reviewers sign in with the passcode, or by an emailed link if invited (${plural(rv.share.invitees.length, 'invite')}).`
						: rv.share.signIn.includes('email')
							? `Reviewers sign in by an emailed link (${plural(rv.share.invitees.length, 'invite')}).`
							: 'Reviewers sign in with the passcode you hand out.';
			card.append(h('p', 'muted', how));
		}
		if (rv.source.kind === 'live' && rv.state === 'open') {
			const words = {
				connected: 'connected',
				retrying: 'reconnecting…',
				starting: 'connecting…',
				gone: 'stopped',
				'no-token': 'not connected (no owner token)'
			};
			card.append(h('p', 'muted', `Live app ${rv.source.url}: ${words[rv.tunnel] ?? rv.tunnel}`));
		}
		if (rv.problem) card.append(h('p', 'error', rv.problem));

		const n = rv.comments.length;
		card.append(
			h(
				'p',
				'',
				n
					? `${plural(n, 'comment')} from ${rv.people.join(', ')}`
					: rv.state === 'open'
						? 'No comments yet.'
						: 'No comments.'
			)
		);
		if (n) card.append(this.commentList(rv, o.allComments ? rv.comments : rv.comments.slice(-3)));
		if (!o.allComments && n > 3) card.append(h('p', 'muted', `and ${n - 3} earlier`));

		const actions = this.actions(rv, remote);
		if (actions) card.append(actions);
		return card;
	}

	commentList(rv, list) {
		const ul = h('ul', 'comments');
		for (const c of list) {
			const li = h('li', c.parent ? 'reply' : '');
			const top = h('p', 'muted');
			top.append(h('strong', '', c.author), ` ${c.parent ? 'replied' : `on ${c.anchor.label}`}`);
			if (!c.parent && c.anchor.path !== '/') top.append(` (${c.anchor.path})`);
			top.append(` · ${when(c.at)}`);
			li.append(top, h('p', 'body', c.body));
			ul.append(li);
		}
		return ul;
	}

	copy(label, value) {
		const b = button(label, '', async () => {
			try {
				await navigator.clipboard.writeText(value);
				b.textContent = 'Copied';
			} catch {
				b.textContent = 'Copy failed';
			}
			setTimeout(() => (b.textContent = label), 1500);
		});
		return b;
	}

	/** What the captain can do with a review, with any confirmation it needs. */
	actions(rv, remote) {
		const state = this.ui.get(rv.id) ?? null;
		const box = h('div', 'stack');
		const row = h('div', 'row');
		const busy = this.busy.has(rv.id);
		if (state?.message) box.append(h('p', state.error ? 'error' : 'ok', state.message));

		if (rv.state === 'open') {
			if (state?.confirm === 'live') {
				box.append(
					h(
						'p',
						'note',
						`This puts “${rv.title}” on ${hostOf(remote?.url ?? '')}, with its comments so far. Anyone with the link who can sign in can open it from anywhere, until you close it.`
					)
				);
				row.append(
					button('Go live', 'primary', () => this.goLive(rv)),
					button('Cancel', '', () => this.setUi(rv.id, null))
				);
			} else if (state?.confirm === 'close') {
				const list = rv.feedback;
				const pick = list && rv.task ? this.picked(rv) : null;
				const n = pick?.on.length ?? 0;
				box.append(
					h(
						'p',
						'note',
						!rv.task
							? 'This review is not about a task, so its comments stay in its bundle on this computer. The link goes down.'
							: !pick
								? 'This takes the link down. There are no comments to send.'
								: n === 0
									? 'No threads are selected, so nothing would go to Firstmate. Close without sending takes the link down and keeps every comment in its bundle on this computer, marked unsent.'
									: `This takes the link down and sends ${n < pick.all.length ? `${n} of ${plural(pick.all.length, 'thread')}` : plural(n, 'thread')} to Firstmate, as one note about ${rv.task}, for its worker.${n < pick.all.length ? ' The others stay in its bundle on this computer, marked unsent.' : ''}`
					)
				);
				if (pick) box.append(this.pickList(rv, pick));
				const send = button(
					pick ? `Close and send ${plural(n, 'thread')} to Firstmate` : 'Close the review',
					'primary',
					() => this.close(rv, true)
				);
				if (pick && (n === 0 || !pick.list)) send.disabled = true;
				row.append(send);
				// For a task Wheelhouse no longer knows, or comments the captain does not want sent.
				if (pick) row.append(button('Close without sending', '', () => this.close(rv, false)));
				row.append(button('Cancel', '', () => this.setUi(rv.id, null)));
			} else {
				if (rv.where === 'local' && remote?.state === 'ready') {
					row.append(
						button(`Go live on ${hostOf(remote.url)}…`, '', () =>
							this.setUi(rv.id, { confirm: 'live' })
						)
					);
				}
				row.append(button('Close…', 'danger', () => this.setUi(rv.id, { confirm: 'close' })));
			}
		} else if (rv.state === 'closed') {
			const list = rv.feedback;
			if (list && rv.task) {
				box.append(
					h(
						'p',
						'note',
						rv.sent
							? `${plural(list.ids.length, 'comment')} came in after the others were sent.`
							: 'The review is closed, but its comments have not reached Firstmate yet.'
					)
				);
				row.append(
					button(rv.sent ? 'Send them to Firstmate' : 'Send to Firstmate', 'primary', () =>
						this.sendRest(rv, list)
					),
					button('Take its comments off without sending', '', () => this.purge(rv))
				);
			} else {
				box.append(
					h(
						'p',
						'note',
						'The review is closed, but its comments and reviewers’ email addresses are still on the review server.'
					)
				);
				row.append(
					button('Take its comments off the review server', 'primary', () => this.purge(rv))
				);
			}
			if (rv.bundleFile) box.append(h('p', 'muted', `Bundle: ${rv.bundleFile}`));
		} else if (rv.bundleFile) {
			box.append(h('p', 'muted', `Bundle: ${rv.bundleFile}`));
		}
		if (busy) for (const b of row.querySelectorAll('button')) b.disabled = true;
		if (row.childElementCount) box.append(row);
		return box.childElementCount ? box : null;
	}

	/**
	 * The threads Close… offers (each with something not yet sent), which are
	 * ticked (all, unless the captain unticked some), and the feedback list for
	 * exactly those: the desk's own for all of them, else the one it made for
	 * this selection (null while it is being made).
	 */
	picked(rv) {
		const state = this.ui.get(rv.id) ?? {};
		const all = (rv.threads ?? []).filter((t) => t.unsent > 0);
		const off = new Set(state.off ?? []);
		const on = all.filter((t) => !off.has(t.id)).map((t) => t.id);
		const key = on.join(',');
		const ready = state.pick?.key === key && state.pick.review === rv.feedback?.ids.join(',');
		if (on.length && on.length < all.length && !ready) this.prepare(rv, on, key);
		const list = on.length === all.length ? rv.feedback : ready ? state.pick.list : null;
		return { all, on, held: all.filter((t) => off.has(t.id)).map((t) => t.id), list };
	}

	/** Ask the desk for the feedback list of just the ticked threads. */
	async prepare(rv, on, key) {
		const tag = `${rv.id}:${key}:${rv.feedback?.ids.join(',')}`;
		if (this.preparing === tag) return;
		this.preparing = tag;
		try {
			const v = await this.desk('POST', `reviews/${rv.id}/feedback`, { threads: on });
			const state = this.ui.get(rv.id);
			if (state?.confirm === 'close')
				this.setUi(rv.id, {
					...state,
					pick: { key, review: rv.feedback?.ids.join(','), list: v.feedback }
				});
			if (this.preparing === tag) this.preparing = null;
		} catch (e) {
			// Left as `preparing`, so the same selection is not asked again until it changes.
			const state = this.ui.get(rv.id);
			if (state?.confirm === 'close')
				this.setUi(rv.id, {
					...state,
					message: `Could not make the note for these threads: ${e.message}`,
					error: true
				});
		}
	}

	/** One checkbox per thread (who, where, its first line), with Select all and Select none. */
	pickList(rv, pick) {
		const box = h('div', 'stack');
		const state = () => this.ui.get(rv.id) ?? { confirm: 'close' };
		const setOff = (off) => {
			const rest = { ...state() };
			delete rest.message;
			delete rest.error;
			this.setUi(rv.id, { ...rest, off });
		};
		const head = h('div', 'row');
		head.append(
			h('span', 'muted', `${pick.on.length} of ${plural(pick.all.length, 'thread')} selected`),
			button('Select all', '', () => setOff([])),
			button('Select none', '', () => setOff(pick.all.map((t) => t.id)))
		);
		const ul = h('ul', 'picks');
		for (const t of pick.all) {
			const li = h('li');
			const label = h('label');
			const tick = h('input');
			tick.type = 'checkbox';
			tick.checked = pick.on.includes(t.id);
			tick.dataset.thread = t.id;
			tick.addEventListener('change', () => {
				const off = new Set(state().off ?? []);
				if (tick.checked) off.delete(t.id);
				else off.add(t.id);
				setOff([...off]);
			});
			const what = h('span', 'what');
			const who = h('span', 'muted');
			who.append(h('strong', '', t.author), ` on ${t.anchor.label}`);
			if (t.anchor.path !== '/') who.append(` (${t.anchor.path})`);
			if (t.replies) who.append(` · ${plural(t.replies, 'reply', 'replies')}`);
			what.append(who, h('span', 'body', t.first));
			label.append(tick, what);
			li.append(label);
			ul.append(li);
		}
		box.append(head, ul);
		return box;
	}

	async goLive(rv) {
		this.busy.add(rv.id);
		this.render();
		try {
			await this.desk('POST', `reviews/${rv.id}/live`, {});
			this.ui.set(rv.id, { message: 'It is live. Share the new link and passcode.' });
		} catch (e) {
			this.ui.set(rv.id, { message: e.message, error: true });
		}
		this.busy.delete(rv.id);
		await this.reload();
	}

	/**
	 * Close: send the comments first (this click is the captain's, so the send
	 * is too), then take the link down. The desk keeps which comments were
	 * sent; any that arrive in between are offered with one more click.
	 */
	async close(rv, send) {
		const toFirstmate = send && !!rv.task;
		const pick = toFirstmate && rv.feedback ? this.picked(rv) : null;
		// Only the ticked threads go; with none ticked (or no list for them yet), nothing does.
		if (pick && (!pick.on.length || !pick.list)) return;
		const list = pick ? pick.list : null;
		let sent = null;
		if (list) {
			const r = await this.host.sendFeedback({
				task: rv.task,
				subject: list.subject,
				items: list.items
			});
			if (!r.ok) {
				this.setUi(rv.id, {
					...(this.ui.get(rv.id) ?? {}),
					confirm: 'close',
					message: `Nothing was sent or closed: ${r.error}`,
					error: true
				});
				return;
			}
			sent = list.ids;
		} else if (toFirstmate) sent = [];
		this.busy.add(rv.id);
		this.render();
		try {
			// With `sent`, the desk hands back any comment that came in after the list was made.
			const v = await this.desk(
				'POST',
				`reviews/${rv.id}/close`,
				sent ? { sent, ...(pick?.held.length ? { held: pick.held } : {}) } : {}
			);
			if (v.late && toFirstmate) {
				this.ui.set(rv.id, {
					message: list ? 'Sent to Firstmate, and the link is down.' : 'The link is down.'
				});
			} else {
				await this.desk('POST', `reviews/${rv.id}/delivered`, {});
				this.ui.set(rv.id, {
					message: list
						? `Sent to Firstmate, and the link is down.${pick?.held.length ? ` ${plural(pick.held.length, 'thread')} not sent ${pick.held.length === 1 ? 'is' : 'are'} kept in its bundle on this computer.` : ''}`
						: `Closed: the link is down.${rv.comments.length ? ' Its comments are kept in its bundle on this computer.' : ''}`
				});
			}
		} catch (e) {
			this.ui.set(rv.id, {
				message: `${sent ? 'The comments reached Firstmate, but the' : 'The'} link could not be taken down: ${e.message}`,
				error: true
			});
		}
		this.busy.delete(rv.id);
		await this.reload();
	}

	async sendRest(rv, list) {
		const r = await this.host.sendFeedback({
			task: rv.task,
			subject: list.subject,
			items: list.items
		});
		if (!r.ok) {
			this.setUi(rv.id, {
				...(this.ui.get(rv.id) ?? {}),
				message: `Not sent: ${r.error}`,
				error: true
			});
			return;
		}
		try {
			await this.desk('POST', `reviews/${rv.id}/delivered`, { sent: list.ids });
			this.ui.set(rv.id, { message: 'Sent to Firstmate.' });
		} catch (e) {
			this.ui.set(rv.id, {
				message: `Sent to Firstmate, but the desk did not hear it: ${e.message}`,
				error: true
			});
		}
		await this.reload();
	}

	async purge(rv) {
		this.busy.add(rv.id);
		this.render();
		try {
			await this.desk('POST', `reviews/${rv.id}/delivered`, {});
			this.ui.set(rv.id, { message: 'Its comments are off the review server.' });
		} catch (e) {
			this.ui.set(rv.id, { message: e.message, error: true });
		}
		this.busy.delete(rv.id);
		await this.reload();
	}

	render() {}

	paint(...nodes) {
		if (!this.shadowRoot) return;
		const style = h('style');
		style.textContent = STYLE;
		this.shadowRoot.replaceChildren(style, ...nodes.filter(Boolean));
	}
}

/** The Reviews page: every review, where reviews go live, and how to deploy a review server. */
class ReviewsPage extends ReviewElement {
	render() {
		const d = this.data;
		if (!d) return;
		const root = h('div', 'stack');
		root.append(
			h(
				'p',
				'muted',
				'Prototypes and live apps shared for comments. Each starts as a local preview on this computer; going live puts it on your review server behind sign-in; closing it takes the link down and sends the comment threads you choose to Firstmate.'
			)
		);
		root.append(...[this.deskCard(), this.remoteCard()].filter(Boolean));
		for (const p of d.settings.problems) root.append(h('p', 'error', p));
		const list = this.reviews;
		if (d.desk && !list.length) {
			root.append(
				h(
					'p',
					'muted',
					'No reviews yet. Start one from a task’s Shared review section, or have Firstmate or a worker run:'
				),
				h('code', '', `node ${d.cli} start --task <task> --live <preview address>`)
			);
		}
		const open = list.filter((r) => r.state === 'open');
		const done = list.filter((r) => r.state !== 'open');
		for (const rv of open) root.append(this.reviewCard(rv, { showTask: true }));
		if (done.length) {
			const det = h('details');
			det.append(h('summary', '', `Closed (${done.length})`));
			const inner = h('div', 'stack');
			for (const rv of done.slice(0, 20)) inner.append(this.reviewCard(rv, { showTask: true }));
			det.append(inner);
			if (this.ui.get('closed-open')) det.open = true;
			det.addEventListener('toggle', () => this.ui.set('closed-open', det.open || null));
			root.append(det);
		}
		root.append(this.howCard());
		this.paint(root);
	}

	remoteCard() {
		const d = this.data;
		const card = h('div', 'card');
		const remote = d.desk?.remote;
		card.append(h('h3', '', 'Going live'));
		if (!d.settings.reviewServer) {
			card.append(
				h(
					'p',
					'muted',
					'No review server is set, so reviews stay on this computer. Set one in Settings → Plugins → Shared review once you have deployed it (see below).'
				)
			);
			return card;
		}
		const row = h('div', 'row');
		row.append(
			h('span', '', 'Reviews go live on '),
			link(d.settings.reviewServer, d.settings.reviewServer)
		);
		if (remote) {
			const tone = remote.state === 'ready' ? 'chip live' : 'chip warn';
			const words = {
				ready: 'ready',
				'no-token': 'no owner token',
				unreachable: 'not reachable',
				refused: 'token refused',
				off: 'off'
			};
			row.append(h('span', tone, words[remote.state] ?? remote.state));
		}
		card.append(row);
		if (remote?.reason) card.append(h('p', 'muted', remote.reason));
		if (remote?.state === 'ready') {
			card.append(h('p', 'muted', `Sign-in offered there: ${remote.signIn.join(' or ')}.`));
		}
		return card;
	}

	howCard() {
		const d = this.data;
		const det = h('details', 'card');
		det.append(h('summary', '', 'Start reviews from a terminal, and deploy a review server'));
		const body = h('div', 'stack');
		body.append(
			h('p', '', 'Firstmate or a worker starts a review (a local preview) with one command:'),
			h('code', '', `node ${d.cli} start --task <task> --live http://127.0.0.1:5173`),
			h('code', '', `node ${d.cli} start --task <task> --static ./dist --spa`),
			h('p', 'muted', 'Then list, go-live <id> (once you agree), close <id> and show <id>.'),
			h('p', '', 'Deploy the review server to the host in the settings, over SSH with Docker:'),
			h('code', '', d.deploy.ssh),
			h('p', 'muted', 'Or apply the Kubernetes manifest with your own values:'),
			h('code', '', d.deploy.kubernetes),
			h('p', 'muted', `Every setting and step: ${d.deploy.readme}`)
		);
		det.append(body);
		if (this.ui.get('how-open')) det.open = true;
		det.addEventListener('toggle', () => this.ui.set('how-open', det.open || null));
		return det;
	}
}

/** A task's Shared review section: its reviews, and starting one of its preview or a folder. */
class TaskReviews extends ReviewElement {
	get taskId() {
		return this.data?.task?.id ?? this.entry?.taskId ?? null;
	}

	render() {
		const d = this.data;
		if (!d?.task) return;
		const root = h('div', 'stack');
		const desk = this.deskCard();
		if (desk) root.append(desk);
		for (const p of d.settings.problems) root.append(h('p', 'error', p));
		const list = this.reviews;
		const open = list.filter((r) => r.state === 'open');
		for (const rv of open) root.append(this.reviewCard(rv, { allComments: true }));
		if (d.desk) root.append(this.startCard(open.length > 0));
		const done = list.filter((r) => r.state !== 'open');
		for (const rv of done.slice(0, 5)) root.append(this.reviewCard(rv, { allComments: false }));
		this.paint(root);
	}

	startCard(collapsed) {
		const d = this.data;
		const t = d.task;
		const wrap = collapsed ? h('details', 'card') : h('div', 'card');
		const heading = collapsed
			? h('summary', '', 'Start another review')
			: h('h3', '', 'Share it for review');
		wrap.append(heading);
		if (collapsed && this.ui.get('start-open')) wrap.open = true;
		if (collapsed)
			wrap.addEventListener('toggle', () => this.ui.set('start-open', wrap.open || null));
		const form = h('form', 'stack');
		let s = this.ui.get('start');
		if (!s) {
			s = { title: t.title, kind: t.preview ? 'live' : 'static', folder: 'dist', spa: false };
			this.ui.set('start', s);
		}
		const keep = () => this.render();

		const title = h('input');
		title.type = 'text';
		title.value = s.title;
		title.maxLength = 120;
		title.addEventListener('input', () => (s.title = title.value));
		const tl = h('label', '', 'Title');
		tl.append(title);
		form.append(tl);

		const choice = (kind, text, enabled) => {
			const l = h('label', 'inline');
			const r = h('input');
			r.type = 'radio';
			r.name = 'kind';
			r.checked = s.kind === kind;
			r.disabled = !enabled;
			r.addEventListener('change', () => {
				s.kind = kind;
				keep();
			});
			l.append(r, h('span', '', text));
			return l;
		};
		form.append(
			choice(
				'live',
				t.preview ? `Its preview, ${t.preview}` : 'Its preview (it has none)',
				!!t.preview
			)
		);
		form.append(
			choice(
				'static',
				t.worktree
					? 'A folder of static files in its worktree'
					: 'A folder of static files (its worktree is not known)',
				!!t.worktree
			)
		);
		if (s.kind === 'static' && t.worktree) {
			const folder = h('input');
			folder.type = 'text';
			folder.value = s.folder;
			folder.addEventListener('input', () => (s.folder = folder.value));
			const fl = h('label', '', `Folder, inside ${t.worktree}`);
			fl.append(folder);
			const spa = h('input');
			spa.type = 'checkbox';
			spa.checked = s.spa;
			spa.addEventListener('change', () => (s.spa = spa.checked));
			const sl = h('label', 'inline');
			sl.append(spa, h('span', '', 'A single-page app (unknown paths show its index.html)'));
			form.append(fl, sl);
		}
		const how = d.settings.signIn.includes('email')
			? `Once live, reviewers sign in ${d.settings.signIn.length > 1 ? 'with a passcode or ' : ''}by an emailed link (${plural(d.settings.invite.length, 'invite')} in the settings).`
			: 'Reviewers sign in with a passcode you hand out.';
		form.append(h('p', 'muted', `It starts as a local preview, on this computer only. ${how}`));
		const err = h('p', 'error');
		err.hidden = true;
		const go = h('button', 'primary', 'Start a local preview');
		go.type = 'submit';
		form.append(err, go);
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			go.disabled = true;
			err.hidden = true;
			try {
				await this.desk('POST', 'reviews', {
					task: t.id,
					project: t.project,
					title: s.title,
					source:
						s.kind === 'live'
							? { kind: 'live', url: t.preview }
							: { kind: 'static', root: t.worktree, dir: s.folder, spa: s.spa },
					signIn: d.settings.signIn,
					invitees: d.settings.invite
				});
				this.ui.delete('start');
				this.ui.delete('start-open');
				await this.reload();
			} catch (x) {
				err.textContent = x.message;
				err.hidden = false;
				go.disabled = false;
			}
		});
		wrap.append(form);
		const cmd = h('p', 'muted', 'Firstmate or the worker can start one too: ');
		cmd.append(
			h(
				'code',
				'',
				`node ${d.cli} start --task ${t.id} ${t.preview ? `--live ${t.preview}` : '--static <folder>'}`
			)
		);
		wrap.append(cmd);
		return wrap;
	}
}

if (!customElements.get('shared-review-page'))
	customElements.define('shared-review-page', ReviewsPage);
if (!customElements.get('shared-review-task'))
	customElements.define('shared-review-task', TaskReviews);
