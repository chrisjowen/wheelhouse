import type { CodexScreen } from '../codex-screen';
import { readSignIn } from '../waiting';
import type { AgentIO, OnScreen } from './types';

/**
 * A dialog the chat cannot drive: a menu it cannot close, which counts as
 * waiting in the terminal once it has stayed.
 */
export function blocked(io: AgentIO, title: string): OnScreen {
	return {
		picker: null,
		menu: { title, canDismiss: false },
		busy: false,
		terminal: io.unread() ? { excerpt: title } : null
	};
}

/**
 * The screen of an agent whose composer and numbered dialogs are recognised
 * positively (`read`): its sign-in, a choice, its prompt, or anything else as
 * a dialog the chat cannot drive. A blank or unreadable screen is never shown
 * as waiting in the terminal, yet nothing is typed into it.
 */
export async function nativeScreen(
	io: AgentIO,
	read: (text: string | null) => CodexScreen
): Promise<OnScreen> {
	const text = await io.screen().catch(() => null);
	const signIn = readSignIn(text)?.signIn ?? null;
	if (signIn) {
		io.read();
		return { picker: null, menu: null, busy: false, signIn };
	}
	const shown = read(text);
	if (shown.kind === 'blocked' && text?.trim()) return blocked(io, shown.title);
	io.read();
	return {
		picker: shown.kind === 'picker' ? shown.picker : null,
		menu: shown.kind === 'blocked' ? { title: shown.title, canDismiss: false } : null,
		busy: shown.kind === 'prompt' && shown.busy
	};
}
