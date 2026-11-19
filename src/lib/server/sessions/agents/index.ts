import type { Harness } from '../../../harness';
import { claude } from './claude';
import { codex } from './codex';
import { grok } from './grok';
import { openCode } from './opencode';
import { pi } from './pi';
import type { PrimaryAgent } from './types';

export type {
	AgentChat,
	AgentContext,
	AgentIO,
	AgentLaunch,
	OnScreen,
	PrimaryAgent,
	SendResult
} from './types';

/** Every primary agent Wheelhouse can run as Firstmate's session, by harness. */
export const AGENTS: Record<Harness, PrimaryAgent> = {
	claude,
	codex,
	opencode: openCode,
	pi,
	grok
};
