// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface PageState {
			/** The phone's menu drawer is open (lib/client/navdrawer.svelte.ts). */
			navDrawer?: boolean;
		}
	}
}

export {};
