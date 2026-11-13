import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addressRewrites, rewriteLinks } from './addresses.svelte';

/** Links on the page with and without an address rewrite, from a page served at localhost:4310. */

let stop: () => void;
beforeEach(() => {
	(window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
		'http://localhost:4310/tasks/a'
	);
	document.body.innerHTML = '';
	stop = rewriteLinks(document);
});
afterEach(() => {
	stop();
	addressRewrites.to = null;
	addressRewrites.hosted = null;
	addressRewrites.remote = null;
});

/**
 * Click on `target` as the captain would, and say where its link now leads;
 * the navigation itself is stopped once the event has passed.
 */
function follow(target: Element, type = 'click'): string {
	const e = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true });
	document.addEventListener(type, (ev) => ev.preventDefault(), { once: true });
	target.dispatchEvent(e);
	return (target.closest('a') as HTMLAnchorElement).href;
}

function link(href: string, text = href): HTMLAnchorElement {
	const a = document.createElement('a');
	a.href = href;
	a.textContent = text;
	const p = document.createElement('p');
	p.append(a);
	document.body.append(p);
	return a;
}

describe('links to Wheelhouse’s computer', () => {
	it('open at the rewrite’s host while one is on, keeping the text the crew wrote', () => {
		addressRewrites.to = '{port}.localhost';
		const a = link('http://localhost:5173/app?x=1');
		expect(follow(a)).toBe('http://5173.localhost:4310/app?x=1');
		expect(a.textContent).toBe('http://localhost:5173/app?x=1');
		expect(follow(link('http://127.0.0.1:3000/'), 'auxclick')).toBe('http://3000.localhost:4310/');
		expect(follow(link('http://127.0.0.1:8080/'), 'contextmenu')).toBe(
			'http://8080.localhost:4310/'
		);
	});

	it('are followed from inside a link’s children and a plugin element’s shadow root', () => {
		addressRewrites.to = '{port}.localhost';
		const a = link('http://localhost:5173/');
		a.innerHTML = '<span><b>Open preview</b></span>';
		expect(follow(a.querySelector('b')!)).toBe('http://5173.localhost:4310/');

		const host = document.createElement('div');
		document.body.append(host);
		const shadow = host.attachShadow({ mode: 'open' });
		shadow.innerHTML = '<a href="http://localhost:6006/">Storybook</a>';
		expect(follow(shadow.querySelector('a')!)).toBe('http://6006.localhost:4310/');
	});

	it('are left alone with no rewrite on, as are links anywhere else', () => {
		expect(follow(link('http://localhost:5173/'))).toBe('http://localhost:5173/');
		addressRewrites.to = '{port}.localhost';
		expect(follow(link('https://github.com/o/r/pull/1'))).toBe('https://github.com/o/r/pull/1');
		expect(follow(link('/tasks/b'))).toBe('http://localhost:4310/tasks/b');
		expect(follow(link('http://localhost:4310/inbox'))).toBe('http://localhost:4310/inbox');
	});

	it('stop being rewritten once the page lets go', () => {
		addressRewrites.to = '{port}.localhost';
		stop();
		expect(follow(link('http://localhost:5173/'))).toBe('http://localhost:5173/');
		stop = () => {};
	});
});

describe('links in a hosted dev environment', () => {
	const gitpod = {
		pattern: 'https://{port}-abc.ws-eu45.gitpod.io',
		source: 'gitpod' as const,
		reserved: [4310]
	};

	it('open at the environment’s URL for their port, before a plugin’s rewrite', () => {
		addressRewrites.hosted = gitpod;
		addressRewrites.to = '{port}.localhost';
		const a = link('http://localhost:5173/app?x=1');
		expect(follow(a)).toBe('https://5173-abc.ws-eu45.gitpod.io/app?x=1');
		expect(a.textContent).toBe('http://localhost:5173/app?x=1');
		expect(follow(link('http://0.0.0.0:3000/'), 'auxclick')).toBe(
			'https://3000-abc.ws-eu45.gitpod.io/'
		);
	});

	it('leave Wheelhouse’s own ports and other addresses alone', () => {
		addressRewrites.hosted = gitpod;
		addressRewrites.to = '{port}.localhost';
		expect(follow(link('http://localhost:4310/inbox'))).toBe('http://localhost:4310/inbox');
		expect(follow(link('https://github.com/o/r/pull/1'))).toBe('https://github.com/o/r/pull/1');
	});

	it('give way to Wheelhouse Cloud for a page that came through it', () => {
		addressRewrites.hosted = gitpod;
		addressRewrites.remote = { preview: 'https://p{port}.relay.example', appPort: 4310 };
		expect(follow(link('http://localhost:5173/a'))).toBe('https://p5173.relay.example/a');
	});

	it('fall back to a plugin’s rewrite outside one', () => {
		addressRewrites.to = '{port}.localhost';
		expect(addressRewrites.view('http://localhost:5173/')).toBe('http://5173.localhost:4310/');
	});
});

describe('an MCP app’s sandbox', () => {
	const SANDBOX = 'http://127.0.0.1:5999/sandbox.html?csp=%7B%7D&sig=s';

	it('is framed where it is on this computer, whatever plugin rewrite is on', () => {
		addressRewrites.to = '{port}.localhost';
		expect(addressRewrites.sandbox(SANDBOX)).toBe(SANDBOX);
	});

	it('is framed on the relay for a page that came through Wheelhouse Cloud', () => {
		addressRewrites.remote = {
			preview: 'https://abc-p{port}.cloud.example',
			appPort: 4310
		};
		addressRewrites.hosted = {
			pattern: 'https://{port}-abc.ws-eu45.gitpod.io',
			source: 'gitpod',
			reserved: [4310, 5999]
		};
		expect(addressRewrites.sandbox(SANDBOX)).toBe(
			'https://abc-p5999.cloud.example/sandbox.html?csp=%7B%7D&sig=s'
		);
	});

	it('is framed at a hosted environment’s URL for its port, though the port is Wheelhouse’s own', () => {
		addressRewrites.hosted = {
			pattern: 'https://{port}-abc.ws-eu45.gitpod.io',
			source: 'gitpod',
			reserved: [4310, 5999]
		};
		addressRewrites.to = '{port}.localhost';
		expect(addressRewrites.sandbox(SANDBOX)).toBe(
			'https://5999-abc.ws-eu45.gitpod.io/sandbox.html?csp=%7B%7D&sig=s'
		);
		// Links to the port are still left alone.
		expect(addressRewrites.view(SANDBOX)).toBe(SANDBOX);
	});

	it('is left as it is where the environment serves ports under a path, on the page’s origin', () => {
		addressRewrites.hosted = {
			pattern: 'https://code.example.dev/proxy/{port}',
			source: 'configured',
			reserved: [4310, 5999]
		};
		addressRewrites.to = null;
		expect(addressRewrites.sandbox(SANDBOX)).toBe(SANDBOX);
		// Previews there are still rewritten.
		expect(addressRewrites.view('http://127.0.0.1:5173/app')).toBe(
			'https://code.example.dev/proxy/5173/app'
		);
	});
});
