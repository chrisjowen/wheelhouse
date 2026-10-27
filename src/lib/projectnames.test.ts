import { describe, expect, it } from 'vitest';
import { HUES, monogram, parseAliases, projectGroups, projectLabels, runs } from './projectnames';

const named = (...names: string[]) => names.map((name) => ({ id: name, name }));

describe('projectGroups', () => {
	it('groups projects by the longest leading segments they share', () => {
		const g = projectGroups(
			named(
				'ai-innovations-chat-agent',
				'ai-innovations-workflow',
				'ai-innovations-evals',
				'platform-api',
				'platform_web',
				'lumen'
			)
		);
		expect(g.get('ai-innovations-chat-agent')).toBe('ai-innovations');
		expect(g.get('ai-innovations-workflow')).toBe('ai-innovations');
		expect(g.get('platform-api')).toBe('platform');
		expect(g.get('platform_web')).toBe('platform');
		expect(g.has('lumen')).toBe(false);
	});

	it('leaves a project ungrouped when no other shares its prefix, or the prefix is its whole name', () => {
		const g = projectGroups(named('ai-chat', 'ai', 'docs/site', 'tidepool'));
		expect(g.has('ai')).toBe(false);
		expect(g.has('ai-chat')).toBe(false);
		expect(g.has('docs/site')).toBe(false);
	});

	it('drops a shorter prefix that only one project is left with', () => {
		const g = projectGroups(named('ai-ml-train', 'ai-ml-serve', 'ai-docs'));
		expect(g.get('ai-ml-train')).toBe('ai-ml');
		expect(g.get('ai-ml-serve')).toBe('ai-ml');
		expect(g.has('ai-docs')).toBe(false);
	});
});

describe('projectLabels', () => {
	const projects = named('ai-innovations-chat-agent', 'ai-innovations-workflow', 'lumen');

	it('shows the part after the group, a two-letter monogram, and keeps the full name', () => {
		const l = projectLabels(projects);
		expect(l.get('ai-innovations-chat-agent')).toMatchObject({
			group: 'ai-innovations',
			label: 'chat-agent',
			full: 'ai-innovations-chat-agent',
			monogram: 'CA'
		});
		expect(l.get('ai-innovations-workflow')).toMatchObject({ label: 'workflow', monogram: 'WO' });
		expect(l.get('lumen')).toMatchObject({ group: null, label: 'lumen', monogram: 'LU' });
	});

	it('lets a friendly name override the label and its monogram', () => {
		const l = projectLabels(projects, { 'ai-innovations-workflow': 'Flow builder' });
		expect(l.get('ai-innovations-workflow')).toMatchObject({
			group: 'ai-innovations',
			label: 'Flow builder',
			monogram: 'FB'
		});
	});

	it('picks one of a fixed set of hues, the same each time', () => {
		const a = projectLabels(projects).get('lumen')!.hue;
		expect(a).toBeGreaterThanOrEqual(0);
		expect(a).toBeLessThan(HUES);
		expect(projectLabels(projects).get('lumen')!.hue).toBe(a);
	});
});

describe('monogram', () => {
	it('takes two initials, else two letters', () => {
		expect(monogram('chat-agent')).toBe('CA');
		expect(monogram('Family photos')).toBe('FP');
		expect(monogram('evals')).toBe('EV');
		expect(monogram('  ')).toBe('?');
	});
});

describe('runs', () => {
	it('gathers siblings under their group where they first appear, and leaves a lone one plain', () => {
		const projects = named('ai-x-one', 'lumen', 'ai-x-two', 'platform-api', 'platform-web');
		const labels = projectLabels(projects);
		const list = named('ai-x-one', 'lumen', 'ai-x-two', 'platform-api');
		expect(runs(list, labels).map((r) => [r.group, r.items.map((i) => i.id)])).toEqual([
			['ai-x', ['ai-x-one', 'ai-x-two']],
			[null, ['lumen']],
			[null, ['platform-api']]
		]);
	});
});

describe('parseAliases', () => {
	it('keeps non-blank string names and drops anything malformed', () => {
		expect(parseAliases('{"a":"Alpha","b":"  ","c":3}')).toEqual({ a: 'Alpha' });
		expect(parseAliases('["a"]')).toEqual({});
		expect(parseAliases('{oops')).toEqual({});
		expect(parseAliases(null)).toEqual({});
	});
});
