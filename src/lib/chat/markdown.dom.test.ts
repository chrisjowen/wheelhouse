import { describe, expect, it } from 'vitest';
import { docHref } from '$lib/docpath';
import { linkDocPaths, markdown, renderDoc } from './markdown';

const parse = (html: string) => {
	const t = document.createElement('template');
	t.innerHTML = html;
	return t.content;
};
const hrefs = (html: string) =>
	[...parse(html).querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('markdown with doc links', () => {
	it('links Markdown file paths in a reply to the reader', () => {
		const html = markdown(
			'The design is in data/wh-gateway-design/report.md and `data/wh-x/plan.md`; see [notes](data/wh-x/notes.md).',
			{ docLinks: true }
		);
		expect(hrefs(html)).toEqual([
			docHref('data/wh-gateway-design/report.md'),
			docHref('data/wh-x/plan.md'),
			docHref('data/wh-x/notes.md')
		]);
		const code = parse(html).querySelector('a > code');
		expect(code?.textContent).toBe('data/wh-x/plan.md');
	});

	it('leaves code blocks, web links and text without paths alone', () => {
		const md =
			'```\ncat data/a/report.md\n```\n\n[guide](https://example.com/docs/guide.md) and nothing else';
		const html = markdown(md, { docLinks: true });
		expect(hrefs(html)).toEqual(['https://example.com/docs/guide.md']);
		expect(markdown('just data/a/report.md')).not.toContain('/files?');
	});

	it('keeps paths it links as text, never as markup', () => {
		const html = linkDocPaths('<p>see data/a/&lt;b&gt;.md</p>');
		expect(parse(html).querySelector('b')).toBe(null);
	});
});

describe('renderDoc', () => {
	const file = '/home/fm/data/x/report.md';

	it('never runs raw HTML from the document', () => {
		const html = renderDoc(
			'# Title\n\n<script>alert(1)</script><img src="x.png" onerror="alert(1)"><style>body{display:none}</style><p style="position:fixed">x</p><form action="/api/x"><button>go</button></form>\n\n[click](javascript:alert(1))',
			file
		);
		const doc = parse(html);
		expect(doc.querySelector('script, style, form, button')).toBe(null);
		expect(doc.querySelector('[onerror], [style]')).toBe(null);
		expect(html).not.toContain('javascript:');
		expect(doc.querySelector('img')?.getAttribute('src')).toBe(
			'/api/files?path=%2Fhome%2Ffm%2Fdata%2Fx%2Fx.png'
		);
	});

	it('keeps plain document markup, and task boxes read-only', () => {
		const html = renderDoc(
			'- [x] done\n- [ ] todo\n\n<details><summary>More</summary>Hidden <object data="/x"></object><span href="/x" class="evil">ok</span></details>\n\n```ts\nconst a = 1;\n```',
			file
		);
		const doc = parse(html);
		expect(doc.querySelector('details summary')?.textContent).toBe('More');
		expect(doc.querySelector('object')).toBe(null);
		expect(doc.querySelector('span')?.getAttributeNames()).toEqual([]);
		expect(doc.querySelector('code')?.getAttribute('class')).toBe('language-ts');
		const boxes = [...doc.querySelectorAll('input')];
		expect(boxes.map((b) => [b.type, b.hasAttribute('disabled')])).toEqual([
			['checkbox', true],
			['checkbox', true]
		]);
	});

	it('resolves relative links and images against the document', () => {
		const html = renderDoc(
			'[plan](plan.md#risks) [other](../y/report.md) [web](https://example.com) [here](#top)\n\n![shot](shots/a.png)',
			file
		);
		expect(hrefs(html)).toEqual([
			`${docHref('/home/fm/data/x/plan.md')}#risks`,
			docHref('/home/fm/data/y/report.md'),
			'https://example.com',
			'#top'
		]);
		const doc = parse(html);
		expect(doc.querySelector('a[href^="https"]')?.getAttribute('target')).toBe('_blank');
		expect(doc.querySelector('a[href^="/files"]')?.getAttribute('target')).toBe(null);
		expect(doc.querySelector('img')?.getAttribute('src')).toBe(
			'/api/files?path=%2Fhome%2Ffm%2Fdata%2Fx%2Fshots%2Fa.png'
		);
	});
});
