import {
	MATERIAL_GROUPS,
	type MaterialGroup,
	type MaterialRow,
	type MaterialView
} from '../../material';
import { CONTEXT_ID, contextHarness } from './context';
import { materialDir, readOff } from './manifest';
import { planned, sync, uninstall, type Outcome, type SkillsCli } from './ops';
import { BRIEF_ID, type MaterialSync } from './sync';

/**
 * Settings → Agent material: each bundled skill (in every skills folder it
 * goes to), the worker block and the session context, each turned on or off
 * as one. Off is `wheelhouse skills uninstall` (an edited copy is left where it
 * is and reported); on is `wheelhouse skills sync`.
 */

const WORDS: Record<MaterialGroup, { title: string; detail: string }> = {
	'manage-wheelhouse': {
		title: 'Running Wheelhouse',
		detail:
			'A skill that tells Firstmate and its crew how to look after Wheelhouse: health, restarts, upgrades, plugins, secrets by name, the chat’s formats, and which calls are yours.'
	},
	'wheelhouse-preview': {
		title: 'Showing you work',
		detail:
			'A skill for serving, reporting and keeping alive the previews you review here, and for using the review surface you chose.'
	},
	'wheelhouse-passage': {
		title: 'Passages',
		detail:
			'A skill for adding Released, On npm or Deployed to a project’s passage with Wheelhouse’s own commands.'
	},
	brief: {
		title: 'Worker briefs',
		detail:
			'A short block of Wheelhouse rules in Firstmate’s config/brief-include.md, which Firstmate adds to every worker and scout brief: previews, secrets, and never stopping Wheelhouse. Your own text in that file is left as it is.'
	},
	context: {
		title: 'Firstmate session context',
		detail:
			'When Wheelhouse starts Firstmate, it tells it that you read the chat here and which formats Wheelhouse shows. It applies the next time the session starts or is cleared.'
	}
};

/** The item ids a row turns on or off together. */
export function groupIds(c: SkillsCli, group: MaterialGroup): string[] {
	if (group === 'brief') return [BRIEF_ID];
	if (group === 'context') return [CONTEXT_ID];
	return planned(c)
		.filter((p) => p.kind === 'skill-dir' && p.skill.name === group)
		.map((p) => p.id);
}

export async function materialView(c: SkillsCli, synced: MaterialSync): Promise<MaterialView> {
	const last = synced.view();
	const off = await readOff(materialDir(c.ctx.configDir));
	const rows = MATERIAL_GROUPS.map((group): MaterialRow => {
		const ids = groupIds(c, group);
		return {
			group,
			...WORDS[group],
			on: !ids.some((id) => off.has(id)),
			unavailable:
				group === 'context' && !contextHarness(c.inputs.harness, c.ctx.env)
					? `Firstmate runs on ${c.inputs.harness}, which does not take it yet; the skills cover it.`
					: null,
			items: last.items.filter((i) => ids.includes(i.id))
		};
	});
	return { state: last.state, message: last.message, rows, drift: last.drift };
}

/** Turn a row on (install it again) or off (remove Wheelhouse's copies, and stop installing them). */
export async function setGroup(
	c: SkillsCli,
	synced: MaterialSync,
	group: MaterialGroup,
	on: boolean
): Promise<Outcome<string[]>> {
	const ids = groupIds(c, group);
	const done = on
		? await sync(c, ids).then((o): Outcome<string[]> =>
				o.ok ? { ok: true, value: [] } : { ok: false, error: o.error }
			)
		: await uninstall(c, ids);
	await synced.sync(true);
	return done;
}
