import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { data: {} } }));

const { default: MenuCard } = await import('./MenuCard.svelte');

let app: ReturnType<typeof mount> | null;
let fetchMock: ReturnType<typeof vi.fn>;
let onterminal: ReturnType<typeof vi.fn<() => void>>;

const button = (name: string) =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name) ?? null;
const posted = () => fetchMock.mock.calls.map(([path]) => path);

beforeEach(() => {
	app = null;
	fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
	onterminal = vi.fn<() => void>();
	vi.stubGlobal('fetch', fetchMock);
	document.body.innerHTML = '';
});

afterEach(() => {
	if (app) unmount(app);
	vi.unstubAllGlobals();
});

describe('a Claude Code menu the chat cannot use', () => {
	const show = (title: string | null) => {
		app = mount(MenuCard, {
			target: document.body,
			props: { menu: { title }, token: 't', onterminal }
		});
		flushSync();
	};

	it('names the menu and closes it from the chat', async () => {
		show('Manage MCP servers');
		expect(document.body.textContent).toMatch(
			/Manage MCP servers\s+is open in Firstmate’s session/
		);
		button('Close menu')!.click();
		await vi.waitFor(() => expect(posted()).toEqual(['/api/firstmate/dismiss']));
	});

	it('opens the terminal to use the menu there instead', () => {
		show(null);
		expect(document.body.textContent).toMatch(/A menu\s+is open/);
		button('Use it in the terminal')!.click();
		expect(onterminal).toHaveBeenCalledOnce();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('says why when the menu would not close', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ message: 'The menu is still open.' }), { status: 409 })
		);
		show('Select model');
		button('Close menu')!.click();
		await vi.waitFor(() =>
			expect(document.querySelector('[role="alert"]')?.textContent).toBe('The menu is still open.')
		);
	});
});
