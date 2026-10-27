/**
 * Project links' Harbour card as a custom element. Wheelhouse imports this
 * bundle, then sets the provider's value on the element as `data` (and the
 * slot entry as `entry`) each time it changes. It styles itself with
 * Wheelhouse's CSS variables, so it follows the page's light and dark themes.
 *
 * @typedef {{ repoUrl: string | null; readme: { title: string; url: string | null } | null;
 *   pulls: { title: string; url: string; number: number | null; landed: boolean }[] }} ProjectSummary
 */

const STYLE = `
	:host { display: block; font: inherit; color: var(--foreground); }
	.row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 1.25rem; font-size: 0.875rem; }
	a { color: var(--sea); text-decoration: none; }
	a:hover { text-decoration: underline; }
	.muted { color: var(--muted-foreground); }
`;

/** Only http(s) links, as Wheelhouse's own blocks allow. */
const safe = (href) => {
	try {
		const u = new URL(href);
		return u.protocol === 'https:' || u.protocol === 'http:' ? href : null;
	} catch {
		return null;
	}
};

class ProjectLinksSummary extends HTMLElement {
	#data = null;

	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
	}

	/** @param {ProjectSummary} value */
	set data(value) {
		this.#data = value;
		this.render();
	}

	get data() {
		return this.#data;
	}

	connectedCallback() {
		this.render();
	}

	render() {
		const s = this.#data;
		if (!s || !this.shadowRoot) return;
		const row = document.createElement('div');
		row.className = 'row';
		const repo = s.repoUrl && safe(s.repoUrl);
		if (repo) row.append(link(repo, repo.replace(/^https:\/\//, '')));
		else row.append(span('No repository link', 'muted'));
		const readme = s.readme?.url && safe(s.readme.url);
		if (readme) row.append(link(readme, s.readme.title));
		const open = s.pulls.filter((p) => !p.landed).length;
		row.append(span(`${open} open ${open === 1 ? 'pull request' : 'pull requests'}`, 'muted'));
		const style = document.createElement('style');
		style.textContent = STYLE;
		this.shadowRoot.replaceChildren(style, row);
	}
}

function link(href, text) {
	const a = document.createElement('a');
	a.href = href;
	a.target = '_blank';
	a.rel = 'noreferrer';
	a.textContent = text;
	return a;
}

function span(text, className) {
	const s = document.createElement('span');
	s.className = className;
	s.textContent = text;
	return s;
}

if (!customElements.get('project-links-summary')) {
	customElements.define('project-links-summary', ProjectLinksSummary);
}
