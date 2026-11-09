// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface PageState {
			/**
			 * The task open in the side panel (`?task=` in the address), or null once it was
			 * closed; unset, the address the page loaded with says.
			 */
			taskSheet?: string | null;
			/** The panel was opened from this page, as a history entry of its own: Back closes it. */
			taskSheetPushed?: boolean;
		}
	}
}

export {};
