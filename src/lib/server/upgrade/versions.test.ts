import { describe, expect, it } from 'vitest';
import { compareVersions, newerTag, parseLsRemote, parseVersion } from './versions';

describe('compareVersions', () => {
	it('orders by major, minor, then patch, with or without a leading v', () => {
		expect(compareVersions('0.1.1', '0.1.2')).toBeLessThan(0);
		expect(compareVersions('v0.2.0', '0.1.9')).toBeGreaterThan(0);
		expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0);
		expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
		expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
	});

	it('puts a release after its pre-releases, and orders pre-releases by their parts', () => {
		expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
		expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
		expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
		expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0);
		expect(compareVersions('1.0.0-rc', '1.0.0-rc.1')).toBeLessThan(0);
	});

	it('ignores build metadata and refuses what is not a version', () => {
		expect(compareVersions('1.0.0+abc', '1.0.0')).toBe(0);
		expect(compareVersions('main', '1.0.0')).toBeNull();
		expect(compareVersions('1.0', '1.0.0')).toBeNull();
		expect(parseVersion('release-1')).toBeNull();
	});
});

describe('newerTag', () => {
	it('is the newest release tag newer than the current one', () => {
		expect(newerTag('v0.1.0', ['v0.1.0', 'v0.2.0', 'v0.1.5', 'latest'])).toBe('v0.2.0');
		expect(newerTag('v0.2.0', ['v0.1.0', 'v0.2.0'])).toBeNull();
	});

	it('skips pre-releases unless the current tag is one', () => {
		expect(newerTag('v1.0.0', ['v1.1.0-rc.1'])).toBeNull();
		expect(newerTag('v1.1.0-rc.1', ['v1.1.0-rc.2', 'v1.1.0'])).toBe('v1.1.0');
	});

	it('is null when the current ref is not a version', () => {
		expect(newerTag('stable', ['v9.0.0'])).toBeNull();
	});
});

describe('parseLsRemote', () => {
	const a = 'a'.repeat(40);
	const b = 'b'.repeat(40);
	const c = 'c'.repeat(40);
	it('splits HEAD, branches and tags, preferring the commit an annotated tag names', () => {
		const refs = parseLsRemote(
			[
				`${a}\tHEAD`,
				`${a}\trefs/heads/main`,
				`${b}\trefs/heads/next`,
				`${c}\trefs/tags/v0.1.0`,
				`${b}\trefs/tags/v0.1.0^{}`,
				`${a}\trefs/tags/v0.2.0`,
				`${a}\trefs/pull/1/head`,
				'garbage'
			].join('\n')
		);
		expect(refs.head).toBe(a);
		expect([...refs.heads]).toEqual([
			['main', a],
			['next', b]
		]);
		expect(refs.tags.get('v0.1.0')).toBe(b);
		expect(refs.tags.get('v0.2.0')).toBe(a);
	});
});
