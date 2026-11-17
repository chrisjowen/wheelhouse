// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- a plain browser script, served as is into the page under review
// @ts-nocheck
/*
 * The live review recorder (see lib/livereview.ts and proxy.ts). This runs in
 * the browser, not on the server: Wheelhouse's proxy serves it into every
 * page of a preview it shows during a live review session, with
 * __WHEELHOUSE_ORIGIN__ replaced by the Wheelhouse page's origin, the only
 * window it talks to.
 *
 * Injected by Wheelhouse into a preview it proxies, so it runs inside the page
 * under review. While a live session records, it reports what the captain does
 * to the Wheelhouse page around it (postMessage to the parent frame): clicks,
 * page changes, typing (masked by default), choices, console errors, failed
 * requests, scrolling and what the pointer is over. It forwards the talk key
 * (Option) so push-to-talk works while the page has focus, takes a screenshot
 * of what is in view when asked, and shows a small recording badge so the
 * captain always knows. It sends nothing anywhere else and does nothing until
 * Wheelhouse tells it a session is recording.
 */
(() => {
	if (window.__whRecorder || window.parent === window) return;
	window.__whRecorder = true;

	const PARENT = '__WHEELHOUSE_ORIGIN__';
	let recording = false;
	let mask = true;
	const send = (type, data = {}) =>
		window.parent.postMessage(
			{ __wh: 1, type, url: location.href, title: document.title, ...data },
			PARENT
		);

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

	/* -------------------------------------------------------------- the badge */

	const host = document.createElement('div');
	host.setAttribute('data-wh-recorder', '');
	host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
	const shadow = host.attachShadow({ mode: 'open' });
	shadow.innerHTML = `<style>
		.badge{position:fixed;left:12px;bottom:12px;display:flex;align-items:center;gap:7px;padding:5px 10px 5px 8px;border-radius:999px;
			background:rgba(11,17,24,.86);color:#eef1f3;font:500 11px/1.2 'DM Sans',system-ui,sans-serif;letter-spacing:.02em;
			box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s}
		.badge.on{opacity:.92;transform:none}
		.txt{max-width:0;overflow:hidden;white-space:nowrap;transition:max-width .35s ease}
		.badge.wide .txt,.badge.talk .txt{max-width:260px}
		.badge:not(.wide):not(.talk){padding:6px}
		.dot{width:8px;height:8px;border-radius:50%;background:#f0644a;box-shadow:0 0 0 0 rgba(240,100,74,.6);animation:p 1.6s infinite}
		.badge.talk .dot{background:#e8b04a;animation-duration:.9s}
		@keyframes p{0%{box-shadow:0 0 0 0 rgba(240,100,74,.55)}70%{box-shadow:0 0 0 7px rgba(240,100,74,0)}100%{box-shadow:0 0 0 0 rgba(240,100,74,0)}}
		.ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #e8b04a;
			animation:r .6s ease-out forwards}
		@keyframes r{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
		.hl{position:fixed;border:2px solid #e8b04a;border-radius:4px;box-shadow:0 0 0 9999px rgba(11,17,24,.0);transition:all .12s;opacity:0}
		.hl.on{opacity:1}
	</style><div class="hl"></div><div class="badge"><span class="dot"></span><span class="txt">Recording for Wheelhouse</span></div>`;
	const badge = shadow.querySelector('.badge');
	const badgeText = shadow.querySelector('.txt');
	const hl = shadow.querySelector('.hl');
	const mount = () => document.body && !host.isConnected && document.body.appendChild(host);
	if (document.body) mount();
	else document.addEventListener('DOMContentLoaded', mount);

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
			if (!recording) return;
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
			const d = described(document.elementFromPoint(e.clientX, e.clientY));
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

	// The talk key works while the page has focus: Option, alone.
	let altDown = false;
	addEventListener(
		'keydown',
		(e) => {
			if (e.key === 'Alt' && !e.repeat && !altDown) {
				altDown = true;
				send('key', { key: 'Alt', down: true });
			} else if (altDown && e.key !== 'Alt') send('key', { key: 'chord' });
			if (e.key === 'Escape') send('key', { key: 'Escape', down: true });
		},
		true
	);
	addEventListener(
		'keyup',
		(e) => {
			if (e.key === 'Alt') {
				altDown = false;
				send('key', { key: 'Alt', down: false });
			}
		},
		true
	);
	addEventListener('blur', () => {
		if (altDown) {
			altDown = false;
			send('key', { key: 'Alt', down: false });
		}
	});

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
			badge.style.visibility = 'hidden';
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
			badge.style.visibility = '';
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
			badge.style.visibility = '';
			send('shot', { id, image: null, error: String(err && err.message) });
		}
	}

	addEventListener('message', (e) => {
		if (e.source !== window.parent || e.origin !== PARENT || !e.data || e.data.__wh !== 1) return;
		const m = e.data;
		if (m.type === 'record') {
			recording = !!m.on;
			mask = m.mask !== false;
			badge.classList.toggle('on', recording);
			if (recording) {
				badge.classList.add('wide');
				clearTimeout(badge._t);
				badge._t = setTimeout(() => badge.classList.remove('wide'), 4000);
			}
			if (!recording) hl.classList.remove('on');
		} else if (m.type === 'talking') {
			badge.classList.toggle('talk', !!m.on);
			badgeText.textContent = m.on
				? 'Listening · recording for Wheelhouse'
				: 'Recording for Wheelhouse';
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
			if (!node) return hl.classList.remove('on');
			node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
			const r = node.getBoundingClientRect();
			Object.assign(hl.style, {
				left: r.left - 3 + 'px',
				top: r.top - 3 + 'px',
				width: r.width + 6 + 'px',
				height: r.height + 6 + 'px'
			});
			hl.classList.add('on');
			clearTimeout(hl._t);
			hl._t = setTimeout(() => hl.classList.remove('on'), 2200);
		}
	});

	send('hello', { ...viewport() });
})();
