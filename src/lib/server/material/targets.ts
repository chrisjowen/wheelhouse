import { homedir } from 'node:os';
import path from 'node:path';
import type { Harness } from '../../harness';

/**
 * Where each harness finds user skills. Claude Code reads its own config's
 * `skills/` (`$CLAUDE_CONFIG_DIR`, else `~/.claude`); Codex, Pi and OpenCode
 * all read the shared `~/.agents/skills`. Claude's folder always gets the
 * skills, as it has since Wheelhouse first shipped one (crew often run on
 * Claude whatever Firstmate runs on); the shared folder is added when
 * Firstmate runs on another harness.
 */
export type SkillRoot = 'claude' | 'agents';

export const SKILL_ROOTS: readonly SkillRoot[] = ['claude', 'agents'];

export function skillRootDir(root: SkillRoot, env: NodeJS.ProcessEnv): string {
	const home = env.HOME || homedir();
	return root === 'claude'
		? path.resolve(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'skills')
		: path.resolve(home, '.agents', 'skills');
}

export const rootsFor = (harness: Harness): SkillRoot[] =>
	harness === 'claude' ? ['claude'] : ['claude', 'agents'];
