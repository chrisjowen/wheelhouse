/**
 * The browser URL for a git remote, without credentials: GitHub-style SSH and
 * HTTPS remotes only. Anything else (a local path, another scheme) is null.
 */
export function webUrl(remote: string): string | null {
	const s = remote.trim();
	const scp = /^[\w.-]+@([\w.-]+):([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(s);
	if (scp) return `https://${scp[1]}/${scp[2]}`;
	let u: URL;
	try {
		u = new URL(s);
	} catch {
		return null;
	}
	if (!['https:', 'http:', 'ssh:', 'git:'].includes(u.protocol)) return null;
	const repo = /^\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(u.pathname);
	if (!repo || !/^[\w.-]+$/.test(u.hostname)) return null;
	return `https://${u.hostname}/${repo[1]}`;
}
