/**
 * Temporary, for choosing a chat style in the preview: the chat's look, remembered in
 * this browser. Styled in app.css under `[data-chat-style]`.
 */
export const CHAT_STYLES = [
	{ id: 'bubbles', label: 'A · Bubbles', title: 'Two-tone bubbles: yours on the right' },
	{ id: 'flat', label: 'B · Thread', title: 'A flat thread with names, no bubbles' },
	{ id: 'cards', label: 'C · Cards', title: 'Soft cards with generous spacing' }
] as const;

export type ChatStyle = (typeof CHAT_STYLES)[number]['id'];

const KEY = 'wheelhouse-chat-style';

class ChatStyleChoice {
	value = $state<ChatStyle>('bubbles');

	/** Read the saved choice; called once mounted, so the server's first paint matches. */
	load() {
		try {
			const saved = localStorage.getItem(KEY);
			if (CHAT_STYLES.some((s) => s.id === saved)) this.value = saved as ChatStyle;
		} catch {
			// storage unavailable; the default stands
		}
	}

	set(v: ChatStyle) {
		this.value = v;
		try {
			localStorage.setItem(KEY, v);
		} catch {
			// storage unavailable; the choice lasts for this page only
		}
	}
}

export const chatStyle = new ChatStyleChoice();
