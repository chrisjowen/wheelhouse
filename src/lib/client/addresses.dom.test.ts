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
