import type { ClipboardSelectionType } from '@xterm/addon-clipboard';
import { describe, expect, it, vi } from 'vitest';
import { copyOnlyClipboard } from './terminalclipboard';

const SYSTEM = 'c' as ClipboardSelectionType;
const PRIMARY = 'p' as ClipboardSelectionType;

describe('the terminals’ clipboard', () => {
	it('lets a program copy to the system clipboard, and never read it', async () => {
		const write = vi.fn(async () => {});
		const clipboard = copyOnlyClipboard(write);
		await clipboard.writeText(SYSTEM, 'https://claude.com/x');
		await clipboard.writeText(PRIMARY, 'ignored');
		expect(write).toHaveBeenCalledExactlyOnceWith('https://claude.com/x');
		expect(await clipboard.readText(SYSTEM)).toBe('');
	});

	it('drops a copy the browser refuses', async () => {
		const clipboard = copyOnlyClipboard(async () => {
			throw new Error('Document is not focused.');
		});
		await expect(clipboard.writeText(SYSTEM, 'x')).resolves.toBeUndefined();
	});
});
