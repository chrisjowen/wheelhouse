import { describe, expect, it } from 'vitest';
import { bindAddress } from './index';

describe('the address Wheelhouse listens on (WHEELHOUSE_HOST, --host)', () => {
	it('is 127.0.0.1 by default, as before', () => {
		expect(bindAddress({})).toBe('127.0.0.1');
		expect(bindAddress({ WHEELHOUSE_HOST: '' })).toBe('127.0.0.1');
		expect(bindAddress({ WHEELHOUSE_HOST: '  ' })).toBe('127.0.0.1');
	});

	it('may be every interface, for a cloud IDE’s forward, or IPv6 loopback', () => {
		expect(bindAddress({ WHEELHOUSE_HOST: '0.0.0.0' })).toBe('0.0.0.0');
		expect(bindAddress({ WHEELHOUSE_HOST: '::' })).toBe('::');
		expect(bindAddress({ WHEELHOUSE_HOST: '[::1]' })).toBe('::1');
	});

	it('refuses anything else', () => {
		for (const v of ['localhost', '10.0.0.5', '192.168.1.2', 'example.dev', '0.0.0.0:4310']) {
			expect(() => bindAddress({ WHEELHOUSE_HOST: v }), v).toThrow(/127\.0\.0\.1/);
		}
	});
});
