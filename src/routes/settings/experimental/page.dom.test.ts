import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({
	page: {
		data: { sessionToken: 'token' },
		url: new URL('http://127.0.0.1:4310/settings/experimental')
	}
}));

const { default: Page } = await import('./+page.svelte');

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const checkbox = (label: string) =>
	document.querySelector<HTMLInputElement>(`input[aria-label="Enable ${label}"]`)!;

async function settle() {
	for (let i = 0; i < 5; i++) await tick();
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('Settings → Experimental features', () => {
	it('puts a refused Remotes change back to its saved value and shows why', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ message: 'Only on this computer.' }, { status: 403 }))
		);
		app = mount(Page, {
			target: document.body,
			props: {
				data: {
					saved: { events: false, remotes: true },
					enabled: { events: false, remotes: true }
				}
			} as never
		});
		const remotes = checkbox('Remote access and second mates');
		expect(remotes.checked).toBe(true);

		remotes.click();
		await settle();

		expect(remotes.checked).toBe(true);
		expect(document.querySelector('[role="alert"]')?.textContent).toBe('Only on this computer.');
	});

	it('keeps a successful change ticked', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({ saved: { events: true, remotes: false }, restartRequired: true })
			)
		);
		app = mount(Page, {
			target: document.body,
			props: {
				data: {
					saved: { events: false, remotes: false },
					enabled: { events: false, remotes: false }
				}
			} as never
		});
		const events = checkbox('Events and reminders');

		events.click();
		await settle();

		expect(events.checked).toBe(true);
		expect(document.querySelector('[role="status"]')?.textContent).toContain('Saved.');
	});
});
