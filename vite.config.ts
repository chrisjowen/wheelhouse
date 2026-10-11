import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: { host: '127.0.0.1' },
	preview: { host: '127.0.0.1' },
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts', 'cli/**/*.test.ts']
				}
			},
			{
				extends: true,
				test: {
					name: 'smoke',
					environment: 'node',
					include: ['tests/smoke/**/*.test.ts'],
					testTimeout: 60_000,
					hookTimeout: 60_000
				}
			}
		]
	}
});
