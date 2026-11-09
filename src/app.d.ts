// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface PageState {
			/** A task opened in the side panel from this page (`?task=`), so Back closes it. */
			taskSheet?: boolean;
		}
	}
}

export {};
