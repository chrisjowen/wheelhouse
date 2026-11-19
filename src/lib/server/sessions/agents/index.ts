import type { Harness } from '../../../harness';
import { claude } from './claude';
import type { PrimaryAgent } from './types';

export type {
	AgentContext,
	AgentIO,
	AgentLaunch,
	OnScreen,
	PrimaryAgent,
	SendResult
} from './types';

/**
 * Every primary agent Wheelhouse can run as Firstmate's session, by harness.
 * An agent not here yet is still handled by FirstmateSession's own branches,
 * while the agents move here one at a time.
 */
export const AGENTS: Partial<Record<Harness, PrimaryAgent>> = { claude };
