import { build } from 'esbuild';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
const version = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8')
).version;
const root = new URL('../firstmate-extension/', import.meta.url);
await mkdir(new URL('bin/', root), { recursive: true });
await build({
	entryPoints: [new URL('events-extension.ts', import.meta.url).pathname],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	outfile: new URL('bin/wheelhouse-events.mjs', root).pathname
});
await chmod(new URL('bin/wheelhouse-events.mjs', root), 0o755);
await writeFile(
	new URL('firstmate-extension.json', root),
	JSON.stringify(
		{
			schema: 'firstmate.extension-manifest.v1',
			id: 'io.wheelhouse.events',
			version,
			host_protocols: [1],
			entrypoint: 'bin/wheelhouse-events.mjs',
			capabilities: [
				{ name: 'process-event-adapter', versions: [1], adapter_names: ['wheelhouse-events'] }
			],
			required_consents: ['artifact-references']
		},
		null,
		2
	) + '\n'
);
