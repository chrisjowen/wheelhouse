# @chrisjowen/wheelhouse-plugin-sdk

Types, block builders and the manifest schema for [Wheelhouse](https://github.com/chrisjowen/wheelhouse) plugins installed with `wheelhouse plugin install <org/repo>`.

```js
import { available, definePlugin, text, unavailable } from '@chrisjowen/wheelhouse-plugin-sdk';

export default definePlugin({
	providers: [
		{
			id: 'readme',
			scope: 'project',
			ttlMs: 60_000,
			async fetch(ctx) {
				const readme = await ctx.readFile('README.md', { root: 'project', maxBytes: 8192 });
				if (readme === null) return unavailable('No README in the clone.');
				return available([text(readme.split('\n')[0])], 'the README');
			}
		}
	],
	contributions: [
		{
			slot: 'project.tab',
			id: 'readme',
			title: 'README',
			provider: 'readme',
			render: { blocks: true }
		}
	]
});
```

Wheelhouse imports a plugin's server entry as is, without installing its dependencies, so bundle this package into it. Point your manifest's `$schema` at `plugin.schema.json` for editor checks. The format, the custom-element contract and the CSS variables are in [docs/plugins.md](https://github.com/chrisjowen/wheelhouse/blob/main/docs/plugins.md#installed-plugins).
