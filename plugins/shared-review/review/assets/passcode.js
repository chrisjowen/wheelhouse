/**
 * A share link can carry the review's passcode in its fragment
 * (`/_review/<id>#p=<passcode>`), which browsers never send to a server or in
 * a Referer. This runs first on the review's pages: it takes the passcode out
 * of the address bar before anything else happens, keeps it only in this
 * page's memory, and puts it in the sign-in form, so the reviewer adds only
 * their name. It is posted, and checked, exactly as a typed one is. Without
 * it in the link, the reviewer types it as before.
 */
(() => {
	const fragment = new URLSearchParams(location.hash.slice(1));
	const passcode = fragment.get('p');
	if (!fragment.has('p')) return;
	history.replaceState(null, '', location.pathname + location.search);
	if (!passcode) return;
	const fill = () => {
		const input = document.getElementById('passcode');
		if (!input) return;
		input.value = passcode;
		const field = document.getElementById('passcode-field');
		if (field) field.hidden = true;
		const note = document.getElementById('passcode-from-link');
		if (note) note.hidden = false;
		const form = document.getElementById('passcode-form');
		const name = form?.querySelector('input[name="name"]');
		if (name && !name.value) name.focus();
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill);
	else fill();
})();
