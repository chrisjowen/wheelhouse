/**
 * The review page: the prototype in a frame (same origin, so this page can
 * look inside it), and comments anchored to the spot they are about.
 *
 * In comment mode a click on the prototype does not reach it: it opens a
 * comment at that spot instead. A spot is kept as the page's path, a CSS
 * selector for the element, where in the element's box it was (fractions),
 * where on the page it was (a fallback when the element is gone), and the
 * element in plain words, the way Wheelhouse's preview names what the
 * captain points at. A comment can also be about the review as a whole (no
 * spot), carry files and voice notes, and be edited or deleted by whoever
 * wrote it. Every comment is drawn as text, never as HTML.
 */
(() => {
	const body = document.body;
	const rid = body.dataset.rid;
	const api = (p) => `/_review/${rid}/api/${p}`;
	const $ = (id) => document.getElementById(id);
	const frame = $('frame');
	const layer = $('layer');
	const list = $('threads');
	const modeBtn = $('mode');
	const count = $('count');
	const banner = $('banner');
	const hint = $('hint');

	let comments = [];
	let commenting = false;
	let selected = null;
	let composer = null;
	let hoverBox = null;
	let stopped = false;
	const wired = new WeakSet();

	/* ------------------------------------------------------------ helpers */

	const el = (tag, cls, text) => {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text !== undefined) n.textContent = text;
		return n;
	};
	const tidy = (s) =>
		String(s ?? '')
			.replace(/\s+/g, ' ')
			.trim();
	const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
	const clamp = (v) => Math.min(1, Math.max(0, v));

	function when(iso) {
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return '';
		const s = Math.round((Date.now() - t) / 1000);
		if (s < 45) return 'just now';
		if (s < 3600) return `${Math.round(s / 60)} min ago`;
		if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
		return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	}

	/** The frame's window and document, while the frame shows a page of this site. */
	function inside() {
		try {
			const w = frame.contentWindow;
			const d = frame.contentDocument;
			if (!w || !d) return null;
			void w.location.href;
			return { w, d };
		} catch {
			return null;
		}
	}

	const pagePath = () => {
		const f = inside();
		return f ? f.w.location.pathname + f.w.location.search : null;
	};

	function say(text, action) {
		banner.replaceChildren(el('span', '', text));
		if (action) {
			const b = el('button', 'quiet', action.label);
			b.type = 'button';
			b.addEventListener('click', action.run);
			banner.append(' ', b);
		}
		banner.hidden = false;
	}

	/* ------------------------------------------------- where a spot is */

	/** A selector that finds this element again: its id when unique, else its place among its siblings. */
	function cssPath(node) {
		const parts = [];
		for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
			const tag = n.tagName.toLowerCase();
			if (tag === 'html') break;
			if (
				n.id &&
				/^[A-Za-z][\w-]*$/.test(n.id) &&
				n.ownerDocument.querySelectorAll(`#${n.id}`).length === 1
			) {
				parts.unshift(`#${n.id}`);
				break;
			}
			if (tag === 'body') {
				parts.unshift('body');
				break;
			}
			const same = n.parentElement
				? [...n.parentElement.children].filter((c) => c.tagName === n.tagName)
				: [];
			parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
		}
		return parts.join(' > ');
	}

	const NOUN = {
		button: 'button',
		a: 'link',
		input: 'box',
		textarea: 'box',
		select: 'menu',
		img: 'picture',
		h1: 'heading',
		h2: 'heading',
		h3: 'heading',
		h4: 'heading',
		label: 'label',
		li: 'item'
	};

	function placeOf(at) {
		const v = at.y < 1 / 3 ? 'top' : at.y < 2 / 3 ? 'middle' : 'bottom';
		const h = at.x < 1 / 3 ? 'left' : at.x < 2 / 3 ? '' : 'right';
		return v === 'middle' && !h ? 'the middle' : `the ${v}${h ? ` ${h}` : ''}`;
	}

	/** What a field is called, never what someone typed into it. */
	function fieldWords(n) {
		const type = (n.getAttribute('type') ?? '').toLowerCase();
		if (n.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(type)) return n.value;
		return (
			n.getAttribute('aria-label') || n.getAttribute('placeholder') || n.getAttribute('name') || ''
		);
	}

	/** The element in plain words: `the “Pay now” button`, or a spot by where it is. */
	function describe(target, at) {
		const near =
			target.closest(
				'button, a, input, textarea, select, img, h1, h2, h3, h4, label, li, [role="button"]'
			) ?? target;
		if (near && near.tagName !== 'HTML' && near.tagName !== 'BODY') {
			const tag = near.tagName.toLowerCase();
			const noun =
				near.getAttribute('role') === 'button' ? 'button' : (NOUN[tag] ?? 'part of the page');
			const field = ['INPUT', 'TEXTAREA', 'SELECT'].includes(near.tagName);
			const words = cut(
				tidy(
					field
						? fieldWords(near)
						: near.getAttribute('aria-label') || near.getAttribute('alt') || near.textContent
				),
				60
			);
			return words ? `the “${words}” ${noun}` : `a ${noun} near ${placeOf(at)}`;
		}
		return `a spot near ${placeOf(at)} of the page`;
	}

	function anchorFor(target, ev, f) {
		const r = target.getBoundingClientRect();
		const at = { x: clamp(ev.clientX / f.w.innerWidth), y: clamp(ev.clientY / f.w.innerHeight) };
		const field = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
		return {
			path: pagePath(),
			selector: cssPath(target),
			at: {
				x: clamp((ev.clientX - r.left) / Math.max(1, r.width)),
				y: clamp((ev.clientY - r.top) / Math.max(1, r.height))
			},
			doc: { x: Math.round(ev.clientX + f.w.scrollX), y: Math.round(ev.clientY + f.w.scrollY) },
			viewport: { w: f.w.innerWidth, h: f.w.innerHeight },
			label: describe(target, at),
			text: field ? null : cut(tidy(target.textContent), 120) || null
		};
	}

	/** Where an anchor is in the frame now, or null when it is on another page or out of reach. */
	function place(anchor) {
		const f = inside();
		if (!f || anchor.path !== pagePath()) return null;
		let target = null;
		try {
			target = anchor.selector ? f.d.querySelector(anchor.selector) : null;
		} catch {
			target = null;
		}
		if (target && anchor.at) {
			const r = target.getBoundingClientRect();
			if (r.width || r.height)
				return { x: r.left + anchor.at.x * r.width, y: r.top + anchor.at.y * r.height };
		}
		if (anchor.doc) return { x: anchor.doc.x - f.w.scrollX, y: anchor.doc.y - f.w.scrollY };
		return null;
	}

	/* ----------------------------------------------------- the prototype */

	const BLOCKED = [
		'pointerdown',
		'pointerup',
		'mousedown',
		'mouseup',
		'dblclick',
		'auxclick',
		'submit',
		'touchstart'
	];

	function wire() {
		const f = inside();
		if (!f) {
			hideHover();
			say('This page is outside the review, so comments cannot be added to it.', {
				label: 'Back to the prototype',
				run: () => (frame.src = `/_review/${rid}/enter`)
			});
			return;
		}
		if (!banner.dataset.keep) banner.hidden = true;
		if (wired.has(f.d)) return;
		wired.add(f.d);
		const stop = (e) => {
			if (!commenting) return;
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
		};
		for (const type of BLOCKED) f.w.addEventListener(type, stop, true);
		f.w.addEventListener(
			'click',
			(e) => {
				if (!commenting) return;
				stop(e);
				const target = e.target instanceof f.w.Element ? e.target : null;
				if (!target) return;
				openComposer(anchorFor(target, e, f), { x: e.clientX, y: e.clientY });
			},
			true
		);
		f.w.addEventListener(
			'mousemove',
			(e) => {
				if (!commenting || composer) return;
				const t = e.target instanceof f.w.Element ? e.target : null;
				if (t) showHover(t.getBoundingClientRect());
			},
			true
		);
		f.w.addEventListener('scroll', drawPins, { passive: true, capture: true });
		f.w.addEventListener('resize', drawPins);
		f.w.addEventListener('keydown', onKey, true);
	}

	function showHover(r) {
		if (!hoverBox) {
			hoverBox = el('div', 'hover');
			layer.append(hoverBox);
		}
		Object.assign(hoverBox.style, {
			left: `${r.left}px`,
			top: `${r.top}px`,
			width: `${r.width}px`,
			height: `${r.height}px`,
			display: 'block'
		});
	}

	function hideHover() {
		if (hoverBox) hoverBox.style.display = 'none';
	}

	function setMode(on) {
		commenting = on;
		modeBtn.setAttribute('aria-pressed', String(on));
		body.classList.toggle('commenting', on);
		if (!on) {
			hideHover();
			closeComposer();
		}
	}

	/* ------------------------------------------------------------- pins */

	const threads = () => {
		const ids = new Set(comments.map((c) => c.id));
		const top = comments.filter((c) => !c.parent || !ids.has(c.parent));
		return top.map((c, i) => ({ n: i + 1, c, replies: comments.filter((r) => r.parent === c.id) }));
	};

	/** Pins by comment id, kept between draws so a click on one is never lost to a redraw. */
	const pins = new Map();

	function drawPins() {
		const box = layer.getBoundingClientRect();
		const shown = new Set();
		for (const t of threads()) {
			if (!t.c.anchor) continue;
			const at = place(t.c.anchor);
			if (!at || at.x < -8 || at.y < -8 || at.x > box.width + 8 || at.y > box.height + 8) continue;
			let pin = pins.get(t.c.id);
			if (!pin) {
				pin = el('button', 'pin');
				pin.type = 'button';
				pin.addEventListener('click', () => select(t.c.id, true));
				pins.set(t.c.id, pin);
				layer.append(pin);
			}
			// Touch the page only where something changed, so the frame is not redrawn for nothing.
			const set = (o, k, v) => {
				if (o[k] !== v) o[k] = v;
			};
			set(pin, 'textContent', String(t.n));
			set(pin, 'title', `${t.c.author}: ${cut(tidy(t.c.body), 80)}`);
			if (pin.classList.contains('on') !== (selected === t.c.id)) pin.classList.toggle('on');
			set(pin.style, 'left', `${Math.round(at.x)}px`);
			set(pin.style, 'top', `${Math.round(at.y)}px`);
			shown.add(t.c.id);
		}
		for (const [id, pin] of pins) {
			if (shown.has(id)) continue;
			pin.remove();
			pins.delete(id);
		}
	}

	/* ------------------------------------------------------- attachments */

	/** What the server allows; the comments list says so too, and it checks again. */
	let limits = { file: 10 * 1024 * 1024, voice: 5 * 1024 * 1024, perComment: 4, voiceSeconds: 300 };
	const ACCEPT =
		'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,text/markdown,.md,.csv,.txt,application/json,audio/*,video/mp4,video/webm';
	/** Types for files a browser does not name. */
	const BY_EXT = {
		md: 'text/markdown',
		markdown: 'text/markdown',
		csv: 'text/csv',
		txt: 'text/plain',
		json: 'application/json',
		m4a: 'audio/mp4',
		mp3: 'audio/mpeg',
		wav: 'audio/wav',
		ogg: 'audio/ogg'
	};
	const mb = (n) => `${Math.round((n / 1048576) * 10) / 10} MB`;
	const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : mb(n));
	const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	/** Uploads and recordings under way, so the list is not redrawn under them. */
	let working = 0;

	async function upload(blob, name, voice, seconds) {
		const type = blob.type || BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] || '';
		const max = voice ? limits.voice : limits.file;
		if (blob.size > max)
			return { ok: false, error: `${voice ? 'A voice note' : name} is larger than ${mb(max)}.` };
		try {
			const r = await fetch(api('attachments'), {
				method: 'POST',
				headers: {
					'content-type': type || 'application/octet-stream',
					'x-file-name': encodeURIComponent(name),
					...(voice ? { 'x-voice-note': '1', 'x-voice-seconds': String(seconds) } : {})
				},
				body: blob
			});
			const v = await r.json().catch(() => ({}));
			if (!r.ok) return { ok: false, error: v.error ?? `${name} could not be added.` };
			return { ok: true, attachment: v.attachment };
		} catch {
			return { ok: false, error: `${name} could not be added; check your connection.` };
		}
	}

	/**
	 * The attachments of a comment being written: Attach, Record, and what is
	 * added so far. `draft.items` keeps them across redraws; uploads go up as
	 * soon as they are added, and come off the server when removed before posting.
	 */
	function attacher(draft, err) {
		const box = el('div', 'files');
		const chips = el('ul', 'chips');
		const row = el('div', 'tools');
		const pick = el('input');
		pick.type = 'file';
		pick.accept = ACCEPT;
		pick.multiple = true;
		pick.hidden = true;
		const attach = el('button', 'quiet small', 'Attach');
		attach.type = 'button';
		attach.title = `Pictures, PDFs, text, sound or video, up to ${mb(limits.file)} each`;
		attach.addEventListener('click', () => pick.click());
		const fail = (text) => {
			err.textContent = text;
			err.hidden = false;
		};
		const room = () => draft.items.length < limits.perComment;
		const draw = () => {
			chips.replaceChildren(
				...draft.items.map((a) => {
					const li = el('li', 'chip');
					li.append(
						el(
							'span',
							'',
							a.kind === 'voice'
								? `Voice note${a.seconds !== null ? ` ${clock(a.seconds)}` : ''}`
								: `${a.name} · ${size(a.size)}`
						)
					);
					const x = el('button', 'quiet small', '×');
					x.type = 'button';
					x.title = 'Remove';
					x.setAttribute('aria-label', `Remove ${a.kind === 'voice' ? 'the voice note' : a.name}`);
					x.addEventListener('click', () => {
						draft.items = draft.items.filter((b) => b.id !== a.id);
						// Not on a comment yet: take it off the server too.
						if (a.fresh) void fetch(api(`attachments/${a.id}`), { method: 'DELETE' });
						draw();
					});
					li.append(x);
					return li;
				})
			);
			attach.disabled = !room();
			if (recordBtn) recordBtn.disabled = !room() && !recorder;
		};
		const add = async (blob, name, voice, seconds) => {
			working++;
			const r = await upload(blob, name, voice, seconds);
			working--;
			if (!r.ok) return fail(r.error);
			draft.items.push({ ...r.attachment, fresh: true });
			draw();
		};
		pick.addEventListener('change', async () => {
			err.hidden = true;
			for (const f of [...(pick.files ?? [])]) {
				if (!room()) {
					fail(`A comment holds at most ${limits.perComment} attachments.`);
					break;
				}
				await add(f, f.name, false, null);
			}
			pick.value = '';
		});
		let recorder = null;
		let recordBtn = null;
		const canRecord =
			typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
		if (canRecord) {
			recordBtn = el('button', 'quiet small', 'Record');
			recordBtn.type = 'button';
			recordBtn.title = `Record a voice note, up to ${clock(limits.voiceSeconds)}`;
			recordBtn.addEventListener('click', async () => {
				if (recorder) return recorder.stop();
				err.hidden = true;
				let stream;
				try {
					stream = await navigator.mediaDevices.getUserMedia({ audio: true });
				} catch {
					return fail(
						'The microphone is blocked or missing. Allow it for this site, then try again.'
					);
				}
				const type =
					['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) =>
						MediaRecorder.isTypeSupported?.(t)
					) ?? '';
				const rec = new MediaRecorder(stream, type ? { mimeType: type } : {});
				const parts = [];
				const started = Date.now();
				const secs = () => Math.round((Date.now() - started) / 1000);
				const tick = setInterval(() => {
					recordBtn.textContent = `Stop ${clock(secs())}`;
					if (secs() >= limits.voiceSeconds) rec.stop();
				}, 250);
				rec.addEventListener('dataavailable', (e) => e.data.size && parts.push(e.data));
				rec.addEventListener('stop', async () => {
					clearInterval(tick);
					for (const t of stream.getTracks()) t.stop();
					recorder = null;
					working--;
					box.classList.remove('recording');
					recordBtn.textContent = 'Record';
					const blob = new Blob(parts, { type: (rec.mimeType || type).split(';')[0] });
					const ext = blob.type.includes('ogg')
						? 'ogg'
						: blob.type.includes('mp4')
							? 'm4a'
							: 'webm';
					if (blob.size)
						await add(blob, `voice-note.${ext}`, true, Math.min(secs(), limits.voiceSeconds));
					draw();
				});
				recorder = rec;
				working++;
				box.classList.add('recording');
				recordBtn.textContent = 'Stop 0:00';
				rec.start(1000);
			});
		}
		row.append(attach, ...(recordBtn ? [recordBtn] : []), pick);
		box.append(chips, row);
		draw();
		return box;
	}

	/** A comment's attachments as they are shown: pictures, players for sound and video, links for the rest. */
	function media(list) {
		const box = el('div', 'attachments');
		for (const a of list ?? []) {
			const src = api(`attachments/${encodeURIComponent(a.id)}`);
			if (a.kind === 'image') {
				const link = el('a', 'picture');
				link.href = src;
				link.target = '_blank';
				link.rel = 'noopener';
				const img = el('img');
				img.src = src;
				img.alt = a.name;
				img.loading = 'lazy';
				link.append(img);
				box.append(link);
			} else if (a.kind === 'voice' || a.kind === 'audio') {
				const wrap = el('div', 'sound');
				wrap.append(
					el(
						'span',
						'muted',
						a.kind === 'voice'
							? `Voice note${a.seconds !== null ? ` · ${clock(a.seconds)}` : ''}`
							: `${a.name} · ${size(a.size)}`
					)
				);
				const audio = el('audio');
				audio.controls = true;
				audio.preload = 'none';
				audio.src = src;
				wrap.append(audio);
				box.append(wrap);
			} else if (a.kind === 'video') {
				const video = el('video');
				video.controls = true;
				video.preload = 'metadata';
				video.src = src;
				box.append(video);
			} else {
				const link = el('a', 'file', `${a.name} · ${size(a.size)}`);
				link.href = src;
				link.download = a.name;
				box.append(link);
			}
		}
		return box;
	}

	/* ---------------------------------------------------------- composer */

	function closeComposer() {
		composer?.remove();
		composer = null;
	}

	function openComposer(anchor, at) {
		closeComposer();
		hideHover();
		const box = layer.getBoundingClientRect();
		composer = el('form', 'composer');
		composer.style.left = `${Math.min(Math.max(8, at.x), Math.max(8, box.width - 300))}px`;
		composer.style.top = `${Math.min(Math.max(8, at.y + 12), Math.max(8, box.height - 250))}px`;
		const where = el('p', 'where', `On ${anchor.label}`);
		const area = el('textarea');
		area.maxLength = 2000;
		area.rows = 3;
		area.placeholder = 'What should change here?';
		area.setAttribute('aria-label', 'Your comment');
		const err = el('p', 'error');
		err.hidden = true;
		const draft = { items: [] };
		const files = attacher(draft, err);
		const row = el('div', 'row');
		const post = el('button', '', 'Post');
		post.type = 'submit';
		const cancel = el('button', 'quiet', 'Cancel');
		cancel.type = 'button';
		cancel.addEventListener('click', () => {
			discard(draft);
			closeComposer();
		});
		row.append(cancel, post);
		composer.append(where, area, files, err, row);
		const dot = el('span', 'pin draft', '+');
		dot.style.left = `${at.x - Number.parseFloat(composer.style.left)}px`;
		dot.style.top = `${at.y - Number.parseFloat(composer.style.top)}px`;
		composer.append(dot);
		composer.addEventListener('submit', async (e) => {
			e.preventDefault();
			if (working) return;
			post.disabled = true;
			const r = await send({ body: area.value, anchor, attachments: draft.items.map((a) => a.id) });
			post.disabled = false;
			if (r.ok) {
				closeComposer();
				select(r.comment.id, false);
			} else {
				err.textContent = r.error;
				err.hidden = false;
			}
		});
		area.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) composer?.requestSubmit();
			if (e.key === 'Escape') {
				discard(draft);
				closeComposer();
			}
		});
		layer.append(composer);
		area.focus();
	}

	/** Uploads added to a comment that is not going to be posted come off the server. */
	function discard(draft) {
		for (const a of draft.items)
			if (a.fresh) void fetch(api(`attachments/${a.id}`), { method: 'DELETE' });
		draft.items = [];
	}

	async function send(payload) {
		try {
			const r = await fetch(api('comments'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const v = await r.json().catch(() => ({}));
			if (!r.ok) return { ok: false, error: v.error ?? 'It could not be posted.' };
			comments.push(v.comment);
			render();
			return { ok: true, comment: v.comment };
		} catch {
			return { ok: false, error: 'It could not be posted; check your connection.' };
		}
	}

	async function change(method, id, payload) {
		try {
			const r = await fetch(api(`comments/${encodeURIComponent(id)}`), {
				method,
				headers: payload ? { 'content-type': 'application/json' } : {},
				body: payload ? JSON.stringify(payload) : undefined
			});
			const v = await r.json().catch(() => ({}));
			if (!r.ok) return { ok: false, error: v.error ?? 'That did not work.' };
			return { ok: true, ...v };
		} catch {
			return { ok: false, error: 'That did not work; check your connection.' };
		}
	}

	/* --------------------------------------------- the whole-review thread */

	const general = { form: $('general'), text: $('general-text'), draft: { items: [] } };
	{
		const err = $('general-error');
		$('general-files').replaceWith(attacher(general.draft, err));
		general.form.addEventListener('submit', async (e) => {
			e.preventDefault();
			if (working) return;
			const post = $('general-post');
			post.disabled = true;
			err.hidden = true;
			const r = await send({
				body: general.text.value,
				general: true,
				attachments: general.draft.items.map((a) => a.id)
			});
			post.disabled = false;
			if (r.ok) {
				general.text.value = '';
				general.draft.items = [];
				general.form.querySelector('.files')?.replaceWith(attacher(general.draft, err));
				select(r.comment.id, true);
			} else {
				err.textContent = r.error;
				err.hidden = false;
			}
		});
		general.text.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) general.form.requestSubmit();
		});
	}

	/* ---------------------------------------------------------- the list */

	/** The comment being edited, and the reply being written, kept across redraws. */
	let editing = null;
	const replies = new Map();

	function select(id, scroll) {
		selected = id;
		render();
		if (scroll)
			list
				.querySelector(`[data-id="${CSS.escape(id)}"]`)
				?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	function goTo(path) {
		const f = inside();
		if (f) f.w.location.assign(path);
	}

	/** Edit and Delete, on the reader's own comments. */
	function ownTools(c) {
		const box = el('span', 'own');
		if (!c.mine) return box;
		const edit = el('button', 'link', 'Edit');
		edit.type = 'button';
		edit.addEventListener('click', () => {
			editing = {
				id: c.id,
				text: c.body,
				draft: { items: c.attachments.map((a) => ({ ...a })) },
				error: null
			};
			render();
		});
		const del = el('button', 'link danger', 'Delete');
		del.type = 'button';
		del.addEventListener('click', async () => {
			if (!confirm(c.parent ? 'Delete your reply?' : 'Delete your comment, with its attachments?'))
				return;
			const r = await change('DELETE', c.id);
			if (!r.ok) return say(r.error);
			comments = comments.filter((x) => !r.removed.includes(x.id));
			if (selected && r.removed.includes(selected)) selected = null;
			render();
		});
		box.append(edit, del);
		return box;
	}

	/** A comment's words and attachments, or the form that edits them. */
	function content(c) {
		if (editing?.id !== c.id) {
			const out = [];
			if (c.body) out.push(el('p', 'body', c.body));
			if (c.attachments.length) out.push(media(c.attachments));
			if (c.editedAt) out.push(el('p', 'edited muted', 'edited'));
			return out;
		}
		const form = el('form', 'edit-form');
		const area = el('textarea');
		area.rows = 3;
		area.maxLength = 2000;
		area.value = editing.text;
		area.setAttribute('aria-label', 'Your comment');
		area.addEventListener('input', () => editing && (editing.text = area.value));
		const err = el('p', 'error');
		err.hidden = !editing.error;
		err.textContent = editing.error ?? '';
		const row = el('div', 'row');
		const cancel = el('button', 'quiet', 'Cancel');
		cancel.type = 'button';
		cancel.addEventListener('click', () => {
			discard({ items: editing.draft.items.filter((a) => a.fresh) });
			editing = null;
			render();
		});
		const save = el('button', '', 'Save');
		save.type = 'submit';
		row.append(cancel, save);
		form.append(area, attacher(editing.draft, err), err, row);
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			if (working || !editing) return;
			save.disabled = true;
			const r = await change('PATCH', c.id, {
				body: editing.text,
				attachments: editing.draft.items.map((a) => a.id)
			});
			save.disabled = false;
			if (!r.ok) {
				editing.error = r.error;
				err.textContent = r.error;
				err.hidden = false;
				return;
			}
			comments = comments.map((x) => (x.id === c.id ? r.comment : x));
			editing = null;
			render();
		});
		queueMicrotask(() => area.focus());
		return [form];
	}

	function render() {
		const ts = threads();
		count.textContent = String(comments.length);
		hint.hidden = comments.length > 0;
		const here = pagePath();
		const items = ts.map((t) => {
			const li = el(
				'li',
				`thread${selected === t.c.id ? ' on' : ''}${t.c.general ? ' general' : ''}`
			);
			li.dataset.id = t.c.id;
			const head = el('div', 'head');
			const n = el('button', 'num', String(t.n));
			n.type = 'button';
			if (t.c.general) {
				n.title = 'About the whole review';
				n.addEventListener('click', () => select(t.c.id, false));
			} else {
				n.title = 'Show it on the page';
				n.addEventListener('click', () => {
					if (t.c.anchor.path !== pagePath()) goTo(t.c.anchor.path);
					select(t.c.id, false);
				});
			}
			head.append(
				n,
				el('strong', '', t.c.author),
				el('span', 'muted', when(t.c.at)),
				ownTools(t.c)
			);
			li.append(head, ...content(t.c));
			const meta = el('p', 'meta', t.c.general ? 'On the whole review' : `On ${t.c.anchor.label}`);
			if (!t.c.general && t.c.anchor.path !== here) {
				meta.append(` · ${t.c.anchor.path} `);
				const go = el('button', 'link', 'Go there');
				go.type = 'button';
				go.addEventListener('click', () => {
					goTo(t.c.anchor.path);
					select(t.c.id, false);
				});
				meta.append(go);
			}
			li.append(meta);
			for (const r of t.replies) {
				const reply = el('div', 'reply');
				reply.dataset.id = r.id;
				const rh = el('div', 'head');
				rh.append(el('strong', '', r.author), el('span', 'muted', when(r.at)), ownTools(r));
				reply.append(rh, ...content(r));
				li.append(reply);
			}
			if (selected === t.c.id) {
				let draft = replies.get(t.c.id);
				if (!draft) replies.set(t.c.id, (draft = { text: '', items: [] }));
				const form = el('form', 'reply-form');
				const area = el('textarea');
				area.rows = 2;
				area.maxLength = 2000;
				area.placeholder = 'Reply';
				area.value = draft.text;
				area.setAttribute('aria-label', 'Your reply');
				area.addEventListener('input', () => (draft.text = area.value));
				const b = el('button', '', 'Reply');
				b.type = 'submit';
				const err = el('p', 'error');
				err.hidden = true;
				form.append(area, attacher(draft, err), err, b);
				form.addEventListener('submit', async (e) => {
					e.preventDefault();
					if (working) return;
					b.disabled = true;
					const sent = {
						body: draft.text,
						parent: t.c.id,
						attachments: draft.items.map((a) => a.id)
					};
					const r = await send(
						t.c.general ? { ...sent, general: true } : { ...sent, anchor: t.c.anchor }
					);
					b.disabled = false;
					if (!r.ok) {
						err.textContent = r.error;
						err.hidden = false;
					} else {
						replies.delete(t.c.id);
						render();
					}
				});
				li.append(form);
			} else {
				li.addEventListener('click', (e) => {
					if (e.target instanceof HTMLButtonElement || e.target.closest?.('a, audio, video'))
						return;
					select(t.c.id, false);
				});
			}
			return li;
		});
		list.replaceChildren(...items);
		drawPins();
	}

	/* ------------------------------------------------------- keep it fresh */

	async function refresh() {
		if (stopped || document.hidden) return;
		try {
			const r = await fetch(api('comments'), { cache: 'no-store' });
			if (r.status === 401) {
				stopped = true;
				setMode(false);
				banner.dataset.keep = '1';
				say('You are signed out, or this review has closed.', {
					label: 'Reload',
					run: () => location.reload()
				});
				return;
			}
			const v = await r.json();
			if (v.limits) limits = v.limits;
			const seen = (list) => JSON.stringify(list.map((c) => [c.id, c.editedAt]));
			const before = seen(comments);
			comments = v.comments;
			// Not under someone writing, recording or sending an upload.
			if (
				seen(comments) !== before &&
				!working &&
				!editing &&
				!document.activeElement?.closest?.('.reply-form, .edit-form')
			)
				render();
		} catch {
			// try again next time
		}
	}

	async function checkCurrent() {
		if (stopped || document.hidden) return;
		try {
			const r = await fetch(api('me'), { cache: 'no-store' });
			if (!r.ok) return;
			const v = await r.json();
			if (v.current) {
				if (banner.dataset.keep === 'other') {
					delete banner.dataset.keep;
					banner.hidden = true;
				}
				return;
			}
			banner.dataset.keep = 'other';
			say('Another review was opened in this browser, so this frame may show its prototype.', {
				label: 'Show this review here',
				run: async () => {
					await fetch(api('current'), { method: 'POST' });
					delete banner.dataset.keep;
					banner.hidden = true;
					frame.src = `/_review/${rid}/enter`;
				}
			});
		} catch {
			// try again next time
		}
	}

	function onKey(e) {
		const typing =
			e.target instanceof Element &&
			e.target.closest('input, textarea, select, [contenteditable="true"]');
		if (e.key === 'Escape') {
			if (composer) closeComposer();
			else setMode(false);
		} else if (
			!typing &&
			(e.key === 'c' || e.key === 'C') &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey
		) {
			e.preventDefault();
			setMode(!commenting);
		}
	}

	modeBtn.addEventListener('click', () => setMode(!commenting));
	$('toggle-panel').addEventListener('click', (e) => {
		const hidden = body.classList.toggle('no-panel');
		e.currentTarget.setAttribute('aria-expanded', String(!hidden));
		drawPins();
	});
	document.addEventListener('keydown', onKey);
	frame.addEventListener('load', () => {
		wire();
		render();
	});
	window.addEventListener('resize', drawPins);

	// A single-page app changes its path without loading: notice it.
	let lastPath = null;
	setInterval(() => {
		const p = pagePath();
		if (p !== lastPath) {
			lastPath = p;
			wire();
			render();
		} else drawPins();
	}, 600);
	setInterval(refresh, 5000);
	setInterval(checkCurrent, 10_000);
	void refresh().then(render);
})();
