// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- a plain browser script, served as is into the page under review
// @ts-nocheck
/*
 * The live review recorder (see lib/livereview.ts and proxy.ts). This runs in
 * the browser, not on the server: Wheelhouse's proxy serves it into every
 * page of a preview it shows for a live review, with __WHEELHOUSE_ORIGIN__
 * replaced by Wheelhouse's origin, the only origin it talks to, and
 * __WHEELHOUSE_REVIEW__ by the task under review. It exists only in that
 * proxied copy: nothing of it is in the project's files or its build.
 *
 * The captain uses the page itself, full screen. The recorder adds, over it,
 * a small floating button (it can be dragged out of the way) that opens the
 * review's panel: Wheelhouse's own page for the session (/live-review/<task>),
 * framed beside the button, where the captain comments, starts a live
 * discussion with the scribe and ends with Done. While the session records,
 * the recorder reports what the captain does to that panel (postMessage):
 * clicks, page changes, typing (masked by default), choices, console errors,
 * failed requests, scrolling and what the pointer is over. It forwards the
 * talk key (Space held for 2 seconds) so push-to-talk works while the page has focus, lets the
 * captain pick a part of the page to comment on, takes a screenshot of what is
 * in view when asked, and shows on the button whether it is recording. It
 * sends nothing anywhere else and records nothing until the panel says so.
 */
(() => {
	const PARENT = '__WHEELHOUSE_ORIGIN__';
	const REVIEW = '__WHEELHOUSE_REVIEW__';
	// Only the page itself (not a frame inside it), and only a copy made for a review.
	if (window.__whRecorder || window.top !== window || !REVIEW || typeof REVIEW !== 'object') return;
	window.__whRecorder = true;

	let recording = false;
	let mask = true;
	let ready = false;
	let queued = [];
	let panel = null;
	const send = (type, data = {}) => {
		const m = { __wh: 1, type, url: location.href, title: document.title, ...data };
		if (!ready || !panel || !panel.contentWindow) {
			// Before the panel has loaded: only the latest of each kind waits for it.
			queued = queued.filter((q) => q.type !== type || type === 'error').concat(m);
			return;
		}
		panel.contentWindow.postMessage(m, PARENT);
	};

	/* ---------------------------------------------------- naming what was used */

	const tidy = (s) => (s || '').replace(/\s+/g, ' ').trim();
	const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
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
		li: 'item',
		summary: 'toggle',
		td: 'cell',
		th: 'column heading',
		nav: 'menu'
	};
	const NEAR =
		'button, a, input, textarea, select, img, h1, h2, h3, h4, label, li, summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], td, th';

	// The words a person would use for it: the first line of its visible text (a card's title, not all of it).
	function firstLine(el) {
		const lines = (el.innerText || el.textContent || '')
			.split('\n')
			.map((l) => l.replace(/^[^\p{L}\p{N}]+/u, '').trim())
			.filter((l) => /\p{L}/u.test(l));
		return lines[0] || '';
	}

	function described(raw) {
		const el = raw && raw.closest ? raw.closest(NEAR) || raw : raw;
		if (!el || el === document.body || el === document.documentElement) return null;
		const tag = el.tagName.toLowerCase();
		const role = el.getAttribute('role');
		const type = (el.getAttribute('type') || '').toLowerCase();
		let noun =
			role === 'tab'
				? 'tab'
				: role === 'button'
					? 'button'
					: role === 'menuitem'
						? 'menu item'
						: role === 'checkbox' || type === 'checkbox'
							? 'tick box'
							: role === 'switch'
								? 'switch'
								: type === 'radio'
									? 'option'
									: NOUN[tag] || 'part of the page';
		const labelFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
		const secret =
			type === 'password' || /pass|secret|token|card|cvc|ssn/i.test(el.name || el.id || '');
		const words = cut(
			tidy(
				el.getAttribute('aria-label') ||
					(labelFor && labelFor.textContent) ||
					el.getAttribute('placeholder') ||
					el.getAttribute('alt') ||
					el.getAttribute('title') ||
					(tag === 'input' || tag === 'textarea' ? '' : firstLine(el)) ||
					(tag === 'input' && ['button', 'submit'].includes(type) ? el.value : '')
			),
			60
		);
		const r = el.getBoundingClientRect();
		return {
			label: words ? `the “${words}” ${noun}` : `a ${noun}`,
			tag,
			text: words,
			secret,
			selector: selectorOf(el),
			rect: { x: r.left, y: r.top, w: r.width, h: r.height }
		};
	}

	function selectorOf(el) {
		const parts = [];
		for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
			if (n.id && !/\d{3,}/.test(n.id)) {
				parts.unshift(`#${CSS.escape(n.id)}`);
				break;
			}
			const test = n.getAttribute('data-testid');
			if (test) {
				parts.unshift(`[data-testid="${test}"]`);
				break;
			}
			let s = n.tagName.toLowerCase();
			const cls = [...n.classList]
				.filter((c) => !/^(is-|has-|active|open|hover|focus)/.test(c))
				.slice(0, 2);
			if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
			const p = n.parentElement;
			if (p) {
				const same = [...p.children].filter((c) => c.tagName === n.tagName);
				if (same.length > 1) s += `:nth-of-type(${same.indexOf(n) + 1})`;
			}
			parts.unshift(s);
		}
		return parts.join(' > ');
	}

	const viewport = () => ({ vw: innerWidth, vh: innerHeight });

	/* ------------------------------------------- the floating button and panel */

	const store = {
		get(k) {
			try {
				return JSON.parse(sessionStorage.getItem('wh-live-review:' + k) || 'null');
			} catch {
				return null;
			}
		},
		set(k, v) {
			try {
				sessionStorage.setItem('wh-live-review:' + k, JSON.stringify(v));
			} catch {
				// storage refused: it is only where the button sits and whether the panel is open
			}
		}
	};

	const host = document.createElement('div');
	host.setAttribute('data-wh-recorder', '');
	host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
	const shadow = host.attachShadow({ mode: 'open' });
	// Wheelhouse's own look (its design tokens: ink, ivory, brass; DM Sans), calm over any page.
	shadow.innerHTML = `<style>
		*{box-sizing:border-box}
		:host{--ink:#121a23;--ink2:#1b2633;--ivory:#f6f4ee;--line:rgba(246,244,238,.14);--soft:#a7b0ba;
			--brass:#e8b04a;--brass-ink:#a87412;font-family:'DM Sans Variable','DM Sans',ui-sans-serif,system-ui,sans-serif}
		[hidden]{display:none!important}
		.btn,.tip,.tl,.area span{font-family:'DM Sans Variable','DM Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
			-webkit-font-smoothing:antialiased}
		button{all:unset;box-sizing:border-box;cursor:pointer;font:inherit}
		button:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
		.btn{position:fixed;display:flex;align-items:center;gap:4px;padding:4px;border-radius:12px;pointer-events:auto;
			background:var(--ink);color:var(--ivory);font-size:13px;font-weight:500;line-height:1;
			box-shadow:0 10px 30px rgba(18,26,35,.28),0 0 0 1px var(--line);touch-action:none;user-select:none;-webkit-user-select:none}
		.btn button{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px 0 10px;border-radius:9px}
		.btn button:hover{background:var(--ink2)}
		.btn.drag{cursor:grabbing}
		.dot{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--brass);display:grid;place-items:center;flex:none}
		.dot i{width:6px;height:6px;border-radius:50%;background:var(--brass)}
		.rec .dot i,.talk .dot i{animation:p 1.6s infinite}
		.talk .dot i{animation-duration:.8s}
		.paused .dot i{background:var(--soft);animation:none}
		@keyframes p{0%{box-shadow:0 0 0 0 rgba(232,176,74,.55)}70%{box-shadow:0 0 0 7px rgba(232,176,74,0)}100%{box-shadow:0 0 0 0 rgba(232,176,74,0)}}
		.clock{font:500 12px/1 'JetBrains Mono Variable',ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--soft);font-variant-numeric:tabular-nums}
		.done{background:var(--ivory)!important;color:var(--ink);font-weight:600;padding:0 12px!important}
		.done:hover{background:#fff!important}
		.done b{width:9px;height:9px;border-radius:2px;background:var(--ink)}
		.quick{background:var(--ivory)!important;color:var(--ink);font-weight:600;font-size:15px;height:44px!important;padding:0 18px 0 14px!important}
		.quick b{width:12px;height:12px;border-radius:50%;background:var(--brass-ink)}
		.quick.on b{border-radius:3px;background:var(--ink)}
		.phone .open{height:44px;width:44px;padding:0!important;justify-content:center}
		.phone .open .lbl,.phone .open .clock{display:none}
		.panel{position:fixed;border-radius:14px;overflow:hidden;pointer-events:auto;background:var(--ink);
			box-shadow:0 18px 60px rgba(18,26,35,.32),0 0 0 1px rgba(18,26,35,.14);transition:opacity .18s ease,transform .18s ease}
		.panel.shut{opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;visibility:hidden}
		.panel iframe{display:block;width:100%;height:100%;border:0;background:transparent}
		.tip{position:fixed;left:50%;top:16px;transform:translateX(-50%);max-width:calc(100vw - 24px);display:flex;align-items:center;gap:14px;
			padding:10px 12px 10px 16px;border-radius:12px;pointer-events:auto;background:var(--ink);color:var(--ivory);font-size:14px;line-height:1.3;
			box-shadow:0 10px 30px rgba(18,26,35,.28)}
		.tip button{color:var(--brass);font-weight:600;white-space:nowrap;padding:4px 6px;border-radius:6px}
		.ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid var(--brass);animation:r .6s ease-out forwards}
		@keyframes r{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
		.hl{position:fixed;border:2px solid var(--brass);border-radius:4px;transition:all .12s;opacity:0;pointer-events:none}
		.hl.on{opacity:1}
		.hl.pick{background:rgba(232,176,74,.12)}
		.layer{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;background:rgba(18,26,35,.32);touch-action:none}
		.layer.drawing{background:transparent}
		.area{position:fixed;border:2px solid var(--brass);border-radius:6px;background:rgba(232,176,74,.08);pointer-events:none}
		.area.live{box-shadow:0 0 0 100vmax rgba(18,26,35,.38)}
		.area span{position:absolute;top:-11px;left:-11px;width:22px;height:22px;border-radius:50%;background:var(--brass);color:var(--ink);
			font-size:12px;font-weight:700;line-height:22px;text-align:center}
		.tl{position:fixed;left:16px;right:16px;bottom:14px;height:40px;display:flex;align-items:center;gap:12px;padding:0 14px;border-radius:10px;
			pointer-events:none;background:rgba(18,26,35,.9);color:var(--ivory);box-shadow:0 8px 24px rgba(18,26,35,.22);
			transition:opacity .2s ease,transform .2s ease}
		.tl.away{opacity:0;transform:translateY(10px)}
		.tl b{font:600 10.5px/1 'JetBrains Mono Variable',ui-monospace,Menlo,monospace;letter-spacing:.14em;color:var(--soft)}
		.tl .t{font:500 12px/1 'JetBrains Mono Variable',ui-monospace,Menlo,monospace;color:var(--soft);font-variant-numeric:tabular-nums}
		.track{position:relative;flex:1;height:18px}
		.track::before{content:'';position:absolute;left:0;right:0;top:50%;height:1px;background:var(--line)}
		.track i{position:absolute;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:var(--soft)}
		.track i.said{width:4px;height:14px;margin:-7px 0 0 -2px;border-radius:2px;background:var(--brass)}
		.track i.mark{border-radius:1px;background:transparent;border:1.5px solid var(--brass)}
		.track i.error{background:#f08a6c}
		.track i.now{width:2px;height:18px;margin:-9px 0 0 -1px;border-radius:1px;background:var(--ivory)}
	</style><div class="hl"></div>
	<div class="areas"></div>
	<div class="layer" hidden></div>
	<div class="tl" hidden aria-hidden="true"><b>TIMELINE</b><span class="track"></span><span class="t"></span></div>
	<div class="tip pick-tip" hidden>Click the part of the page your comment is about<button type="button">Cancel</button></div>
	<div class="tip mark-tip" hidden>Drag over the part of the page you mean<button type="button">Done marking</button></div>
	<div class="panel shut" role="dialog" aria-label="Live review"></div>
	<div class="btn" data-wh-review-button><button type="button" class="quick" hidden><b></b><span class="qlbl">Record</span></button><button type="button" class="open" aria-expanded="false" aria-label="Review"><span class="dot"><i></i></span><span class="lbl">Review</span><span class="clock" hidden></span></button><button type="button" class="done" hidden><b></b>Done</button></div>`;
	const hl = shadow.querySelector('.hl');
	const tip = shadow.querySelector('.pick-tip');
	const markTip = shadow.querySelector('.mark-tip');
	const layer = shadow.querySelector('.layer');
	const areasBox = shadow.querySelector('.areas');
	const tl = shadow.querySelector('.tl');
	const box = shadow.querySelector('.panel');
	const btn = shadow.querySelector('.btn');
	const openBtn = shadow.querySelector('.open');
	const doneBtn = shadow.querySelector('.done');
	const quick = shadow.querySelector('.quick');
	const lbl = shadow.querySelector('.lbl');
	const clock = shadow.querySelector('.clock');
	// On a phone: one control, Record then Stop (no holding), and the panel as a sheet for comments.
	const phone = matchMedia('(max-width: 640px), (pointer: coarse)').matches;
	btn.classList.toggle('phone', phone);
	quick.hidden = !phone;

	panel = document.createElement('iframe');
	panel.title = 'Live review';
	panel.allow = 'microphone; autoplay';
	panel.src =
		`${PARENT}/live-review/${encodeURIComponent(REVIEW.task)}?` +
		new URLSearchParams({
			from: location.origin,
			title: REVIEW.title,
			preview: REVIEW.preview,
			back: REVIEW.back
		});
	box.appendChild(panel);

	// Where the button sits (it can be dragged anywhere), and the panel beside it.
	let pos = store.get('pos') || { right: 16, bottom: 16 };
	let open = !!store.get('open');
	let large = false;
	const clamp = (v, max) => Math.max(8, Math.min(v, max));
	function place() {
		const w = btn.offsetWidth || 120;
		const h = btn.offsetHeight || 44;
		pos = {
			right: clamp(pos.right, innerWidth - w - 8),
			bottom: clamp(pos.bottom, innerHeight - h - 8)
		};
		btn.style.right = pos.right + 'px';
		btn.style.bottom = pos.bottom + 'px';
		if (phone) {
			// What is on the screen (a page wider than the phone still shows this much): the control
			// sits at its foot, in the middle, and the panel rises over it as a sheet.
			const vv = window.visualViewport;
			const vw = vv ? vv.width : innerWidth;
			const vh = vv ? vv.height : innerHeight;
			const ox = vv ? vv.offsetLeft : 0;
			const oy = vv ? vv.offsetTop : 0;
			Object.assign(btn.style, {
				right: 'auto',
				bottom: 'auto',
				left: ox + (vw - w) / 2 + 'px',
				top: oy + vh - h - 16 + 'px'
			});
			const height = large ? vh - 24 : Math.min(vh * 0.78, 640);
			Object.assign(box.style, {
				left: ox + 'px',
				right: 'auto',
				bottom: 'auto',
				top: oy + vh - height + 'px',
				width: vw + 'px',
				height: height + 'px',
				borderRadius: '16px 16px 0 0'
			});
			return;
		}
		if (large) {
			Object.assign(box.style, {
				top: '16px',
				bottom: '16px',
				right: '16px',
				left: 'auto',
				width: 'min(44rem, calc(100vw - 32px))',
				height: 'auto'
			});
			return;
		}
		const width = Math.min(400, innerWidth - 16);
		const height = Math.min(640, innerHeight - h - 40);
		const left = innerWidth - pos.right - w;
		const fromRight = left + w / 2 > innerWidth / 2;
		// The button low on the screen: the panel opens above it, else below it.
		const above = innerHeight - pos.bottom - h > innerHeight / 2;
		Object.assign(box.style, {
			width: width + 'px',
			height: height + 'px',
			left: fromRight ? 'auto' : clamp(left, innerWidth - width - 8) + 'px',
			right: fromRight ? clamp(pos.right, innerWidth - width - 8) + 'px' : 'auto',
			top: above ? 'auto' : clamp(innerHeight - pos.bottom + 10, innerHeight - height - 8) + 'px',
			bottom: above ? clamp(pos.bottom + h + 10, innerHeight - height - 8) + 'px' : 'auto'
		});
	}
	function setOpen(v) {
		open = v;
		store.set('open', v);
		box.classList.toggle('shut', !open);
		openBtn.setAttribute('aria-expanded', String(open));
		// On a phone the sheet has its own Done and minimise; the control steps aside for it.
		btn.style.visibility = phone && open ? 'hidden' : '';
		place();
	}
	addEventListener('resize', place);
	if (phone && window.visualViewport) {
		visualViewport.addEventListener('resize', place);
		visualViewport.addEventListener('scroll', place);
	}

	// A press on the button opens or closes the panel; a press that moves drags it.
	let drag = null;
	openBtn.addEventListener('pointerdown', (e) => {
		if (e.button !== 0) return;
		drag = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom, moved: false };
		try {
			openBtn.setPointerCapture(e.pointerId);
		} catch {
			// a pointer the browser will not capture: the drag still works while it stays over
		}
	});
	openBtn.addEventListener('pointermove', (e) => {
		// On a phone the control stays at the foot of the screen.
		if (!drag || phone) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) < 5) return;
		drag.moved = true;
		btn.classList.add('drag');
		pos = { right: drag.right - dx, bottom: drag.bottom - dy };
		place();
	});
	openBtn.addEventListener('pointerup', () => {
		if (!drag) return;
		const moved = drag.moved;
		drag = null;
		btn.classList.remove('drag');
		if (moved) store.set('pos', pos);
		else setOpen(!open);
	});
	openBtn.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			setOpen(!open);
		}
	});
	// On a phone, Record starts the discussion with the mic on (no holding), and Stop ends it.
	quick.addEventListener('click', () => send('quick'));
	// Done is always one press away while anything is under way.
	doneBtn.addEventListener('click', () => {
		send('done');
		setOpen(true);
	});

	// What the panel says of the session, shown on the button.
	let since = 0;
	let tick = 0;
	function showState(m) {
		// With the pack open the session is over: the button says so, without a clock.
		if (m.pack) m = { pack: true };
		btn.classList.toggle('rec', !!m.recording && !m.paused && !m.talking);
		btn.classList.toggle('talk', !!m.talking);
		btn.classList.toggle('paused', !!m.recording && !!m.paused);
		lbl.textContent = m.pack
			? 'Feedback pack'
			: m.talking
				? 'Listening'
				: m.recording
					? m.paused
						? 'Paused'
						: 'Recording'
					: m.comments
						? `${m.comments} comment${m.comments === 1 ? '' : 's'}`
						: 'Review';
		doneBtn.hidden = phone || !m.canDone;
		quick.classList.toggle('on', !!m.recording);
		quick.querySelector('.qlbl').textContent = m.recording ? 'Stop' : 'Record';
		quick.hidden = !phone || !!m.pack;
		since = m.recording ? m.started : 0;
		tl.hidden = phone || !m.recording;
		clock.hidden = !since;
		clearInterval(tick);
		if (since) {
			const draw = () => {
				const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
				clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
				drawTimeline();
			};
			draw();
			tick = setInterval(draw, 1000);
		}
		place();
	}

	const mount = () => {
		if (!document.body || host.isConnected) return;
		document.body.appendChild(host);
		setOpen(open);
		drawAreas();
	};
	if (document.body) mount();
	else document.addEventListener('DOMContentLoaded', mount);
	// A page that replaces its body (some apps do as they start) gets the button back.
	new MutationObserver(() => mount()).observe(document.documentElement, { childList: true });

	/* ------------------------------------------------- picking what to comment on */

	let picking = false;
	function outline(node, cls) {
		if (!node) return hl.classList.remove('on');
		const r = node.getBoundingClientRect();
		Object.assign(hl.style, {
			left: r.left - 3 + 'px',
			top: r.top - 3 + 'px',
			width: r.width + 6 + 'px',
			height: r.height + 6 + 'px'
		});
		hl.className = 'hl on ' + (cls || '');
	}
	const pickable = (t) => t && t !== host && !host.contains(t) && t !== document.documentElement;
	function pick(on) {
		picking = on;
		tip.hidden = !on;
		if (on) setOpen(false);
		else hl.className = 'hl';
	}
	tip.querySelector('button').addEventListener('click', () => {
		pick(false);
		send('picked', { el: null });
		setOpen(true);
	});
	const swallow = (e) => {
		if (!picking || !pickable(e.target)) return;
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
	};
	for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart'])
		addEventListener(type, swallow, true);
	addEventListener(
		'pointermove',
		(e) => {
			if (!picking) return;
			const t = document.elementFromPoint(e.clientX, e.clientY);
			if (!pickable(t)) return;
			outline(t.closest(NEAR) || t, 'pick');
		},
		true
	);

	/* --------------------------------------------------------- marking areas */

	// While marking, the page dims and takes no input: a layer over it catches the pointer, and
	// each drag marks a rectangle, highlighted as it is drawn. Marked areas stay on the page they
	// were marked on for the rest of the session.
	let marking = false;
	let areas = store.get('areas') || [];
	const here = () => location.pathname + location.search + location.hash;
	function drawAreas() {
		areasBox.textContent = '';
		for (const a of areas) {
			if (a.page !== here()) continue;
			const d = document.createElement('div');
			d.className = 'area';
			Object.assign(d.style, {
				left: a.x - scrollX + 'px',
				top: a.y - scrollY + 'px',
				width: a.w + 'px',
				height: a.h + 'px'
			});
			const n = document.createElement('span');
			n.textContent = String(a.n);
			d.appendChild(n);
			areasBox.appendChild(d);
		}
	}
	addEventListener('scroll', drawAreas, { passive: true, capture: true });
	addEventListener('resize', drawAreas);
	addEventListener('hashchange', drawAreas);
	addEventListener('popstate', drawAreas);
	function setMarking(on) {
		marking = on;
		layer.hidden = !on;
		markTip.hidden = !on;
		// On a phone the sheet would cover the page being marked.
		if (on && phone) setOpen(false);
		if (on && document.activeElement && document.activeElement !== document.body)
			document.activeElement.blur();
	}
	markTip.querySelector('button').addEventListener('click', () => {
		setMarking(false);
		send('marking', { on: false });
	});
	let live = null;
	layer.addEventListener('pointerdown', (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		try {
			layer.setPointerCapture(e.pointerId);
		} catch {
			// a pointer the browser will not capture: the drag still works while it stays over
		}
		layer.classList.add('drawing');
		live = { x: e.clientX, y: e.clientY, el: document.createElement('div') };
		live.el.className = 'area live';
		areasBox.appendChild(live.el);
	});
	const liveRect = (e) => ({
		x: Math.min(live.x, e.clientX),
		y: Math.min(live.y, e.clientY),
		w: Math.abs(e.clientX - live.x),
		h: Math.abs(e.clientY - live.y)
	});
	layer.addEventListener('pointermove', (e) => {
		if (!live) return;
		const r = liveRect(e);
		Object.assign(live.el.style, {
			left: r.x + 'px',
			top: r.y + 'px',
			width: r.w + 'px',
			height: r.h + 'px'
		});
	});
	const finishDrag = (e) => {
		if (!live) return;
		const r = liveRect(e);
		live.el.remove();
		live = null;
		layer.classList.remove('drawing');
		if (r.w < 8 || r.h < 8) return;
		const n = areas.length + 1;
		areas.push({ n, page: here(), x: r.x + scrollX, y: r.y + scrollY, w: r.w, h: r.h });
		store.set('areas', areas);
		drawAreas();
		send('area', { rect: r, n, ...viewport() });
	};
	layer.addEventListener('pointerup', finishDrag);
	layer.addEventListener('pointercancel', () => {
		if (live) live.el.remove();
		live = null;
		layer.classList.remove('drawing');
	});

	/* ---------------------------------------------------------- the timeline */

	// While recording, the session along the bottom of the page: what was done, said and marked.
	// It is only to look at: it lets the pointer through, and steps aside when the pointer comes
	// near so the page under it can be seen and used.
	let marks = [];
	const track = tl.querySelector('.track');
	const tlTime = tl.querySelector('.t');
	function drawTimeline() {
		if (tl.hidden || !since) return;
		const now = Date.now() - since;
		const span = Math.max(60_000, now * 1.08);
		const pct = (t) => Math.min(100, Math.max(0, (t / span) * 100)) + '%';
		track.textContent = '';
		for (const m of marks) {
			const i = document.createElement('i');
			i.className = m.kind;
			i.style.left = pct(m.t);
			track.appendChild(i);
		}
		const nowMark = document.createElement('i');
		nowMark.className = 'now';
		nowMark.style.left = pct(now);
		track.appendChild(nowMark);
		tlTime.textContent = clock.textContent;
	}
	addEventListener(
		'pointermove',
		(e) => {
			if (tl.hidden) return;
			tl.classList.toggle('away', e.clientY > innerHeight - 90);
		},
		{ passive: true, capture: true }
	);

	/* --------------------------------------------------------------- the chime */

	// The same soft tone as Wheelhouse's push to talk everywhere (lib/voice/spacehold.ts): rising
	// when the mic is live, lower when it closes. The page plays it, as the key was pressed here.
	let audio = null;
	function chime(on) {
		try {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return;
			audio = audio || new AC();
			const t = audio.currentTime;
			const osc = audio.createOscillator();
			const gain = audio.createGain();
			osc.type = 'sine';
			osc.frequency.setValueAtTime(on ? 660 : 520, t);
			osc.frequency.exponentialRampToValueAtTime(on ? 880 : 390, t + 0.12);
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
			osc.connect(gain).connect(audio.destination);
			osc.start(t);
			osc.stop(t + 0.24);
		} catch {
			// no sound here: the button still says Listening
		}
	}

	function ripple(x, y) {
		const r = document.createElement('div');
		r.className = 'ripple';
		r.style.left = x + 'px';
		r.style.top = y + 'px';
		shadow.appendChild(r);
		setTimeout(() => r.remove(), 650);
	}

	/* ------------------------------------------------------------ what happens */

	addEventListener(
		'click',
		(e) => {
			if (picking && pickable(e.target)) {
				// The part the captain's comment is about: taken, not clicked.
				swallow(e);
				const node = e.target.closest(NEAR) || e.target;
				pick(false);
				outline(node);
				clearTimeout(hl._t);
				hl._t = setTimeout(() => (hl.className = 'hl'), 2200);
				send('picked', { el: described(node), at: { x: e.clientX, y: e.clientY }, ...viewport() });
				setOpen(true);
				return;
			}
			if (!recording || !pickable(e.target)) return;
			const d = described(e.target);
			ripple(e.clientX, e.clientY);
			send('click', { el: d, at: { x: e.clientX, y: e.clientY }, ...viewport() });
		},
		true
	);

	const typing = new WeakMap();
	addEventListener(
		'input',
		(e) => {
			if (!recording) return;
			const el = e.target;
			if (!(
				el instanceof HTMLInputElement ||
				el instanceof HTMLTextAreaElement ||
				el.isContentEditable
			))
				return;
			if (
				el instanceof HTMLInputElement &&
				['checkbox', 'radio', 'range', 'color'].includes(el.type)
			)
				return;
			clearTimeout(typing.get(el));
			typing.set(
				el,
				setTimeout(() => {
					const d = described(el);
					const value = el.isContentEditable ? el.textContent : el.value;
					const hidden = mask || (d && d.secret);
					send('input', {
						el: d,
						length: (value || '').length,
						value: hidden ? null : cut(tidy(value), 80)
					});
				}, 900)
			);
		},
		true
	);

	addEventListener(
		'change',
		(e) => {
			if (!recording) return;
			const el = e.target;
			let value = null;
			if (el instanceof HTMLSelectElement) value = tidy(el.selectedOptions[0]?.textContent);
			else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))
				value = el.checked ? 'on' : 'off';
			else return;
			send('choose', { el: described(el), value });
		},
		true
	);

	let scrollTimer = 0;
	addEventListener(
		'scroll',
		(e) => {
			if (!recording) return;
			clearTimeout(scrollTimer);
			scrollTimer = setTimeout(() => {
				const t = e.target === document ? document.scrollingElement : e.target;
				if (!t || !t.scrollHeight) return;
				const max = t.scrollHeight - t.clientHeight;
				if (max < 40) return;
				send('scroll', { pct: Math.round((t.scrollTop / max) * 100) });
			}, 700);
		},
		true
	);

	let lastHover = null;
	let hoverAt = 0;
	addEventListener(
		'pointermove',
		(e) => {
			if (!recording) return;
			const now = performance.now();
			if (now - hoverAt < 180) return;
			hoverAt = now;
			const under = document.elementFromPoint(e.clientX, e.clientY);
			const d = pickable(under) ? described(under) : null;
			const key = d ? d.selector : null;
			if (key === lastHover) return;
			lastHover = key;
			send('hover', { el: d, ...viewport() });
		},
		true
	);

	// Page changes: full loads, and single-page apps moving with history or the hash.
	let lastUrl = location.href;
	const moved = (how) => {
		if (location.href === lastUrl) return;
		lastUrl = location.href;
		if (recording) send('nav', { how });
	};
	for (const name of ['pushState', 'replaceState']) {
		const orig = history[name];
		history[name] = function (...args) {
			const out = orig.apply(this, args);
			setTimeout(() => moved(name === 'pushState' ? 'link' : 'replace'));
			return out;
		};
	}
	addEventListener('popstate', () => moved('back'));
	addEventListener('hashchange', () => moved('link'));

	// Trouble on the page: errors, rejected promises, console errors and failed requests
	// (watchTrouble, from lib/trouble.js, which proxy.ts places in front of this script).
	watchTrouble(
		(kind, message, extra = {}) =>
			recording && send('error', { kind, message: cut(tidy(String(message)), 300), ...extra })
	);

	// The talk key, as everywhere in Wheelhouse (lib/voice/spacehold.ts): hold Space for 2 seconds
	// to talk, and let go to stop; a shorter press is an ordinary Space. In a text box the press
	// types its space as usual, and when the hold turns into talking that space comes out again.
	const HOLD_MS = 2000;
	let spaceTimer = 0;
	let spaceWaiting = false;
	let spaceTalking = false;
	const typingIn = (t) =>
		!!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
	function untypeSpace(el) {
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			const at = el.selectionStart ?? 0;
			if (at === 0 || at !== el.selectionEnd || !/[ \u00a0]/.test(el.value[at - 1])) return;
			el.setRangeText('', at - 1, at, 'end');
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}
	function spaceWait() {
		clearTimeout(spaceTimer);
		spaceWaiting = false;
	}
	function spaceUp(e) {
		spaceWait();
		if (!spaceTalking) return;
		spaceTalking = false;
		// The press was for talking, not for the button or link that has focus.
		if (e) e.preventDefault();
		chime(false);
		send('key', { key: 'talk', down: false });
	}
	addEventListener(
		'keydown',
		(e) => {
			const space = e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
			if (space && e.repeat) {
				// Held Space neither types a row of spaces nor scrolls while it waits.
				if (spaceWaiting || spaceTalking) e.preventDefault();
			} else if (space && !spaceTalking && !picking && recording) {
				const typedIn = typingIn(e.target) ? e.target : null;
				spaceWait();
				spaceWaiting = true;
				spaceTimer = setTimeout(() => {
					spaceWaiting = false;
					spaceTalking = true;
					if (typedIn) untypeSpace(typedIn);
					chime(true);
					send('key', { key: 'talk', down: true });
				}, HOLD_MS);
			} else if (!space && spaceWaiting) {
				// Another key while Space is still down is fast typing, not a hold.
				spaceWait();
			}
			if (e.key === 'Escape' && picking) {
				pick(false);
				send('picked', { el: null });
				setOpen(true);
			} else if (e.key === 'Escape' && marking) {
				setMarking(false);
				send('marking', { on: false });
			} else if (e.key === 'Escape') send('key', { key: 'Escape', down: true });
			else if (
				(e.key === 'm' || e.key === 'M') &&
				!e.repeat &&
				!e.metaKey &&
				!e.ctrlKey &&
				!e.altKey &&
				recording &&
				!typingIn(e.target)
			)
				// M: mark an area (and M again, or Esc, to stop).
				send('key', { key: 'mark' });
			// While marking, the page takes no keys either.
			if (marking) {
				e.stopPropagation();
				e.preventDefault();
			}
		},
		true
	);
	addEventListener(
		'keyup',
		(e) => {
			if (e.code === 'Space') spaceUp(e);
			if (marking) {
				e.stopPropagation();
				e.preventDefault();
			}
		},
		true
	);
	addEventListener('blur', () => spaceUp(null));

	/* ------------------------------------------------------- Wheelhouse asking */

	let shooter = null;
	function loadShooter() {
		if (shooter) return shooter;
		shooter = new Promise((ok, fail) => {
			const s = document.createElement('script');
			s.src = '/__wheelhouse/live-review/screenshot.js';
			s.onload = () => ok(window.modernScreenshot);
			s.onerror = fail;
			(document.head || document.documentElement).appendChild(s);
		});
		return shooter;
	}

	async function shoot(id, selector, text) {
		try {
			const ms = await loadShooter();
			hl.classList.remove('on');
			const root = document.documentElement;
			const sx = scrollX,
				sy = scrollY,
				vw = innerWidth,
				vh = innerHeight;
			const scale = Math.min(1, 1100 / vw);
			const canvas = await ms.domToCanvas(root, {
				width: vw,
				height: vh,
				scale,
				backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
				style: { transform: `translate(${-sx}px, ${-sy}px)` },
				filter: (n) => !(n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-wh-recorder')),
				timeout: 4000
			});
			let el = null;
			if (selector) {
				try {
					const node = document.querySelector(selector);
					const d = node && described(node);
					if (d && (!text || d.text === text)) el = d;
				} catch {
					// a selector the page cannot read: no outline
				}
			}
			send('shot', { id, image: canvas.toDataURL('image/jpeg', 0.82), vw, vh, el });
		} catch (err) {
			send('shot', { id, image: null, error: String(err && err.message) });
		}
	}

	addEventListener('message', (e) => {
		if (!panel || e.source !== panel.contentWindow || e.origin !== PARENT) return;
		const m = e.data;
		if (!m || m.__wh !== 1) return;
		if (m.type === 'ready') {
			// The panel has loaded (again, after the page changed): what waited goes to it now.
			ready = true;
			const waiting = queued;
			queued = [];
			for (const q of waiting) panel.contentWindow.postMessage(q, PARENT);
			send('hello', { ...viewport() });
		} else if (m.type === 'record') {
			recording = !!m.on;
			mask = m.mask !== false;
			if (!recording) {
				hl.className = 'hl';
				if (marking) setMarking(false);
			}
		} else if (m.type === 'state') {
			showState(m);
		} else if (m.type === 'panel') {
			if (typeof m.large === 'boolean') large = m.large;
			if (typeof m.open === 'boolean') setOpen(m.open);
			else place();
		} else if (m.type === 'mark') {
			setMarking(!!m.on);
		} else if (m.type === 'timeline') {
			marks = Array.isArray(m.items) ? m.items : [];
			drawTimeline();
		} else if (m.type === 'areas' && m.clear) {
			areas = [];
			store.set('areas', areas);
			drawAreas();
		} else if (m.type === 'pick') {
			pick(!!m.on);
		} else if (m.type === 'gettext') {
			// What the page says right now, for the scribe to answer questions about it (never typed values).
			const text = (document.body ? document.body.innerText : '')
				.replace(/\n{3,}/g, '\n\n')
				.slice(0, 6000);
			send('text', { text });
		} else if (m.type === 'shoot') {
			shoot(m.id, m.selector, m.text);
		} else if (m.type === 'highlight') {
			let node = null;
			try {
				node = m.selector && document.querySelector(m.selector);
			} catch {
				// a selector the page cannot read: nothing to highlight
			}
			if (!node) return (hl.className = 'hl');
			node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			outline(node);
			clearTimeout(hl._t);
			hl._t = setTimeout(() => (hl.className = 'hl'), 2200);
		}
	});
})();
