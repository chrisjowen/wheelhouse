import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Wheelhouse added to a phone's home screen: the page names its manifest, and every icon is there. */

const root = path.resolve(import.meta.dirname, '..');
const asset = (href: string) =>
	path.join(root, 'static', href.replace(/^(%sveltekit\.assets%)?\//, ''));

/** A PNG's width and height, from its IHDR chunk. */
async function pngSize(file: string): Promise<[number, number]> {
	const b = await readFile(file);
	expect(b.subarray(1, 4).toString()).toBe('PNG');
	return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('the web app manifest', () => {
	it('is linked from the page with a home-screen icon for iOS', async () => {
		const html = await readFile(path.join(root, 'src/app.html'), 'utf8');
		const manifest = html.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
		const touch = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)?.[1];
		expect(manifest).toBeTruthy();
		expect(await pngSize(asset(touch!))).toEqual([180, 180]);
		JSON.parse(await readFile(asset(manifest!), 'utf8'));
	});

	it('opens standalone at the home page, with each icon at the size it says', async () => {
		const m = JSON.parse(await readFile(path.join(root, 'static/manifest.webmanifest'), 'utf8'));
		expect(m).toMatchObject({ name: 'Wheelhouse', start_url: '/', display: 'standalone' });
		expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
		for (const icon of m.icons as { src: string; sizes: string }[]) {
			const [w, h] = icon.sizes.split('x').map(Number);
			expect(await pngSize(asset(icon.src))).toEqual([w, h]);
		}
	});
});
