/**
 * The home page chat's threads (lib/chat/topics.ts), as the chat last
 * counted them, for the header's project switcher: how many messages each
 * project has in the chat, and the threads that are not projects (topics
 * Firstmate filed replies under, and Unsorted) to pick from. Empty away from
 * the chat.
 */
export interface ChatThread {
	topic: string;
	name: string;
	hue: number | null;
	/** Messages and cards in it. */
	count: number;
	/** Open decisions in it. */
	needs: number;
	/** A registered project (picked as `?project=`), not a topic (`?thread=`). */
	project: boolean;
}

class ChatThreads {
	rows = $state<ChatThread[]>([]);
}

export const chatThreads = new ChatThreads();
