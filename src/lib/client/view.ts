/** Remember a page's layout for a year, in the cookie its server load reads back (see VIEW_COOKIE). */
export function rememberView(cookie: string, value: string): void {
	try {
		document.cookie = `${cookie}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
	} catch {
		// Cookies blocked: the layout still changes, it is just not remembered.
	}
}
