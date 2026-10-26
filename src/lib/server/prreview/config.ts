import { EFFORTS, MODEL } from './agent';
import type { ReviewAgentConfig } from './service';

/**
 * The review agent's settings, from the environment (the CLI sets them from
 * --review-model and --review-effort):
 *   WHEELHOUSE_REVIEW_CLAUDE   the claude binary (default `claude` on PATH)
 *   WHEELHOUSE_REVIEW_MODEL    model alias or name (default sonnet, a mid model)
 *   WHEELHOUSE_REVIEW_EFFORT   low | medium | high | xhigh | max (default low)
 *   WHEELHOUSE_REVIEW_MAX_USD  the most one run may spend (default 1)
 *   WHEELHOUSE_REVIEW_AGENT=0  turns the agent off (the diff still shows)
 */
export const DEFAULT_MODEL = 'sonnet';
export const DEFAULT_EFFORT = 'low';

export function reviewAgentConfig(env: NodeJS.ProcessEnv): ReviewAgentConfig {
	const model = env.WHEELHOUSE_REVIEW_MODEL?.trim() || DEFAULT_MODEL;
	const effort = env.WHEELHOUSE_REVIEW_EFFORT?.trim() || DEFAULT_EFFORT;
	const usd = Number(env.WHEELHOUSE_REVIEW_MAX_USD);
	return {
		bin: env.WHEELHOUSE_REVIEW_CLAUDE?.trim() || 'claude',
		model: MODEL.test(model) ? model : DEFAULT_MODEL,
		effort: EFFORTS.includes(effort) ? effort : DEFAULT_EFFORT,
		maxBudgetUsd: Number.isFinite(usd) && usd > 0 ? usd : 1,
		timeoutMs: 5 * 60_000,
		off:
			env.WHEELHOUSE_REVIEW_AGENT === '0'
				? 'The review agent is turned off (WHEELHOUSE_REVIEW_AGENT=0).'
				: null
	};
}
