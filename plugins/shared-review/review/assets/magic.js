/**
 * The emailed link's landing page: the sign-in token travels in the address's
 * fragment, which browsers never send to a server or in a Referer, so it is
 * never in a log. It is posted only when the reviewer clicks Continue, so a
 * mail scanner that opens the link does not use it up.
 */
(() => {
	const token = new URLSearchParams(location.hash.slice(1)).get('t');
	const input = document.getElementById('token');
	const form = document.getElementById('magic');
	history.replaceState(null, '', location.pathname);
	if (token && input) {
		input.value = token;
		return;
	}
	if (form) {
		const p = document.createElement('p');
		p.className = 'error';
		p.textContent = 'This link is incomplete. Open the review link to ask for a new one.';
		form.replaceChildren(p);
	}
})();
