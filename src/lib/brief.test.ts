import { describe, expect, it } from 'vitest';
import { briefSize, parseBrief } from './brief';

const BRIEF = `You are a crewmate: an autonomous worker agent managed by firstmate.

# Task
## Captain's intent
let people save their search filters

## Firstmate spec
- Reuse the filter model.
- Add tests.

# Setup
1. Create your branch.

## Captain intent authorized for --intent
let people save their search filters
`;

describe('parseBrief', () => {
	it('takes out the captain’s intent and Firstmate’s spec, keeping the rest as written', () => {
		const b = parseBrief(BRIEF);
		expect(b.intent).toBe('let people save their search filters');
		expect(b.spec).toBe('- Reuse the filter model.\n- Add tests.');
		expect(b.rest).toContain('You are a crewmate');
		expect(b.rest).toContain('# Setup\n1. Create your branch.');
		// "# Task" has nothing left under it, so it goes too.
		expect(b.rest).not.toMatch(/^# Task$/m);
		// Only the first heading naming the intent counts; a later one stays in the rest.
		expect(b.rest).toContain('## Captain intent authorized for --intent');
	});

	it('ends a section at the next heading of its level or higher, not at a subheading', () => {
		const b = parseBrief('## Firstmate spec\nDo it.\n### Detail\nMore.\n## Next\nAfter.');
		expect(b.spec).toBe('Do it.\n### Detail\nMore.');
		expect(b.rest).toBe('## Next\nAfter.');
	});

	it('ignores headings inside code fences', () => {
		const b = parseBrief("## Firstmate spec\n```\n## Captain's intent\n```\nok");
		expect(b.intent).toBeNull();
		expect(b.spec).toBe("```\n## Captain's intent\n```\nok");
	});

	it('keeps a brief with neither section whole in the rest', () => {
		const b = parseBrief('# Task\n[captain] fix the login page\n');
		expect(b).toEqual({ intent: null, spec: null, rest: '# Task\n[captain] fix the login page' });
	});

	it('accepts curly apostrophes and an empty section', () => {
		const b = parseBrief('## Captain’s intent\n\n## Firstmate’s spec\nx');
		expect(b.intent).toBeNull();
		expect(b.spec).toBe('x');
	});
});

describe('briefSize', () => {
	it('says bytes under a kilobyte, else whole kilobytes', () => {
		expect(briefSize(900)).toBe('900 bytes');
		expect(briefSize(18_248)).toBe('18 KB');
	});
});
