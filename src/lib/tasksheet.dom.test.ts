import { afterEach, describe, expect, it } from 'vitest';
import { clickedTask, sheetTaskFor } from './tasksheet';

const here = new URL('http://127.0.0.1:4317/harbour?view=completed');

describe('which links open a task in the side panel', () => {
	it('opens a plain link to a task page, by its id', () => {
		expect(sheetTaskFor('/tasks/lumen-search', here)).toBe('lumen-search');
		expect(sheetTaskFor('/tasks/a%2Fb', here)).toBe('a/b');
		expect(sheetTaskFor('http://127.0.0.1:4317/tasks/x/', here)).toBe('x');
	});

	it('leaves tabs, documents, other sites and other pages to go where they say', () => {
		expect(sheetTaskFor('/tasks/x?tab=talk', here)).toBeNull();
		expect(sheetTaskFor('/tasks/x#stages', here)).toBeNull();
		expect(sheetTaskFor('/tasks/x/doc?path=a.md', here)).toBeNull();
		expect(sheetTaskFor('https://github.com/tasks/x', here)).toBeNull();
		expect(sheetTaskFor('/harbour', here)).toBeNull();
		expect(sheetTaskFor('/tasks/%E0%A4%A', here)).toBeNull();
	});

	it('follows a link to the task whose page is already open', () => {
		expect(sheetTaskFor('/tasks/x', new URL('http://127.0.0.1:4317/tasks/x'))).toBeNull();
		expect(sheetTaskFor('/tasks/y', new URL('http://127.0.0.1:4317/tasks/x'))).toBe('y');
	});
});

describe('a click on a task link', () => {
	afterEach(() => (document.body.innerHTML = ''));

	const click = (html: string, o: Partial<MouseEvent> = {}) => {
		document.body.innerHTML = html;
		const target = document.querySelector('[data-t]') ?? document.body.firstElementChild;
		return clickedTask(
			{
				defaultPrevented: false,
				button: 0,
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				target,
				...o
			} as MouseEvent,
			here
		);
	};

	it('opens the side panel from the link or anything inside it', () => {
		expect(click('<a href="/tasks/x">Search</a>')).toBe('x');
		expect(click('<a href="/tasks/x"><span data-t>Search</span></a>')).toBe('x');
	});

	it('lets the browser have modified, middle and handled clicks', () => {
		expect(click('<a href="/tasks/x">x</a>', { metaKey: true })).toBeNull();
		expect(click('<a href="/tasks/x">x</a>', { ctrlKey: true })).toBeNull();
		expect(click('<a href="/tasks/x">x</a>', { shiftKey: true })).toBeNull();
		expect(click('<a href="/tasks/x">x</a>', { button: 1 })).toBeNull();
		expect(click('<a href="/tasks/x">x</a>', { defaultPrevented: true })).toBeNull();
	});

	it('follows links to a new window, downloads and the panel’s own Open full page', () => {
		expect(click('<a href="/tasks/x" target="_blank">x</a>')).toBeNull();
		expect(click('<a href="/tasks/x" download>x</a>')).toBeNull();
		expect(click('<a href="/tasks/x" data-full-page>Open full page</a>')).toBeNull();
		expect(click('<div data-full-page><a href="/tasks/x" data-t>x</a></div>')).toBeNull();
		expect(click('<button data-t>x</button>')).toBeNull();
	});
});
