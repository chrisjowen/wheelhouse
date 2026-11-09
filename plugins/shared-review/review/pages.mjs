/**
 * The pages the review server draws itself: signing in, the email link's
 * landing page, a closed or unknown review, and the review page (the shell
 * that frames the prototype and draws the comments). Every value from a
 * review or a reviewer goes through `esc`; scripts and styles load only from
 * the server's own /_review/assets, under a policy that allows nothing else.
 */

import { esc } from './lib.mjs';

const head = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/_review/assets/review.css">
</head>`;

const card = (title, inner) => `${head(title)}
<body class="plain">
<main class="card">
${inner}
</main>
</body>
</html>`;

/** Signing in to one review: by passcode, by an emailed link, or both. */
export function signInPage({ rid, title, methods, error, notice, name, email }) {
	const pass = methods.includes('passcode');
	const mail = methods.includes('email');
	return card(
		`Sign in · ${title}`,
		`<p class="eyebrow">Prototype review</p>
<h1>${esc(title)}</h1>
<p class="muted">Sign in to see the prototype and leave comments. Others in the review see your name beside your comments.</p>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
${
	pass
		? `<form method="post" action="/_review/${esc(rid)}/signin" class="stack">
<input type="hidden" name="method" value="passcode">
<label>Your name<input name="name" autocomplete="name" maxlength="60" required value="${esc(name)}"></label>
<label>Passcode<input name="passcode" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
<button type="submit">Sign in</button>
</form>`
		: ''
}
${pass && mail ? '<p class="or">or</p>' : ''}
${
	mail
		? `<form method="post" action="/_review/${esc(rid)}/signin" class="stack">
<input type="hidden" name="method" value="email">
<label>Your name<input name="name" autocomplete="name" maxlength="60" required value="${esc(name)}"></label>
<label>Your email<input name="email" type="email" autocomplete="email" maxlength="254" required value="${esc(email)}"></label>
<button type="submit">Email me a sign-in link</button>
</form>`
		: ''
}`
	);
}

/** Where an emailed link lands: the token stays in the fragment until the reviewer clicks. */
export function magicPage({ rid, title, error }) {
	return card(
		`Sign in · ${title}`,
		`<p class="eyebrow">Prototype review</p>
<h1>${esc(title)}</h1>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/_review/${esc(rid)}/magic" class="stack" id="magic">
<input type="hidden" name="token" id="token">
<p class="muted">This link signs you in once, and only for a short while.</p>
<button type="submit">Continue to the review</button>
</form>
<script src="/_review/assets/magic.js"></script>`
	);
}

/** A review that is closed, or never was: the same answer for both. */
export function closedPage() {
	return card(
		'Review closed',
		`<p class="eyebrow">Prototype review</p>
<h1>This review is closed</h1>
<p class="muted">This link is closed or does not exist. Ask the person who shared it for a new one.</p>`
	);
}

/** A page outside any review the browser is signed in to. */
export function nothingPage() {
	return card(
		'Nothing here',
		`<p class="eyebrow">Prototype review</p>
<h1>Nothing here</h1>
<p class="muted">Open the review link you were given to see the prototype.</p>`
	);
}

/** A live app that is not connected right now. */
export function offlinePage(title) {
	return card(
		'Not connected',
		`<p class="eyebrow">Prototype review</p>
<h1>${esc(title)} is not connected right now</h1>
<p class="muted">The app being reviewed runs on its owner's computer, which is not reachable at the moment. Try again shortly.</p>`
	);
}

/** The desk's own address: it holds nothing to show; Wheelhouse is where reviews are managed. */
export function deskPage() {
	return card(
		'Review desk',
		`<p class="eyebrow">Shared review</p>
<h1>The review desk is running</h1>
<p class="muted">It keeps local previews, connects live apps and reaches your review server. Start, share and close reviews from Wheelhouse: the Reviews page, or the Shared review section on a task.</p>`
	);
}

/** The review page: the prototype in a frame, the comments beside it. */
export function shellPage({ rid, title, name, start }) {
	return `${head(title)}
<body class="shell" data-rid="${esc(rid)}" data-name="${esc(name)}" data-start="${esc(start)}" data-title="${esc(title)}">
<header class="bar">
<div class="title"><span class="eyebrow">Review</span> <strong id="review-title">${esc(title)}</strong></div>
<div class="actions">
<span class="muted" id="who">Commenting as ${esc(name)}</span>
<button type="button" id="mode" aria-pressed="false" title="Click a spot on the page to comment on it (C)">Comment</button>
<button type="button" id="toggle-panel" aria-expanded="true">Comments <span id="count">0</span></button>
<form method="post" action="/_review/${esc(rid)}/signout"><button type="submit" class="quiet">Sign out</button></form>
</div>
</header>
<div id="banner" class="banner" hidden></div>
<main class="work">
<div class="stage" id="stage">
<iframe id="frame" title="The prototype" src="/_review/${esc(rid)}/enter"></iframe>
<div id="layer" class="layer"></div>
</div>
<aside id="panel" class="panel" aria-label="Comments">
<p class="hint" id="hint">Turn on <strong>Comment</strong>, then click the spot on the page you want to talk about.</p>
<ol id="threads" class="threads"></ol>
</aside>
</main>
<script src="/_review/assets/shell.js"></script>
</body>
</html>`;
}
