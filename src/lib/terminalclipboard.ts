import type { ClipboardSelectionType, IClipboardProvider } from '@xterm/addon-clipboard';

/**
 * The live terminals' clipboard (see components/firstmate/Terminal.svelte), for
 * OSC 52: a program in the terminal may copy text to the browser's clipboard,
 * as Claude Code's "c to copy" does, but never read it. Only the system
 * clipboard (`c`), the one a browser has; a copy the browser refuses is
 * dropped.
 */
export function copyOnlyClipboard(
	write: (text: string) => Promise<void> = (t) => navigator.clipboard.writeText(t)
): IClipboardProvider {
	return {
		readText: () => '',
		writeText: async (selection: ClipboardSelectionType, text: string) => {
			if ((selection as string) !== 'c') return;
			await write(text).catch(() => {});
		}
	};
}
