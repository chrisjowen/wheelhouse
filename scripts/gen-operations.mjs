// Regenerate skills/manage-wheelhouse/references/operations.md from this
// checkout's commands and routes (cli/operations.ts). It runs in prepack, so
// the published package always carries this version's reference; the drift
// test (cli/operations.test.ts) fails when the committed copy is out of date.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Inside the checkout, so the bundle's external packages resolve from its node_modules.
const out = path.join(root, 'node_modules', '.cache', `gen-operations-${process.pid}.mjs`);
await build({
	entryPoints: [path.join(root, 'cli', 'operations-main.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	packages: 'external',
	outfile: out,
	logLevel: 'warning'
});
try {
	process.chdir(root);
	await import(pathToFileURL(out).href);
} finally {
	await rm(out, { force: true });
}
