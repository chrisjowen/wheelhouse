/**
 * Masking for Soundings: command lines and paths are cut short and stripped of
 * anything that looks like a secret before they are kept, shown or sent to the
 * AI that writes the report. It errs on the side of hiding: a long random
 * value is masked whether or not it is a secret.
 */

const MASK = '•••';

/** Option and variable names whose value is a secret. */
const SECRET_NAME =
	/(pass(word|wd|phrase)?|secret|token|api[-_]?key|apikey|auth|credential|cred|private[-_]?key|access[-_]?key|session|cookie|bearer|signature|sig|pwd)/i;

/** Well-known token shapes, masked wherever they appear. */
const TOKEN_SHAPES = [
	/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, // GitHub
	/\b(github_pat_[A-Za-z0-9_]{20,})/g,
	/\b(sk-[A-Za-z0-9_-]{16,})/g, // OpenAI, Anthropic and others
	/\b(xox[abprs]-[A-Za-z0-9-]{10,})/g, // Slack
	/\b(AKIA[0-9A-Z]{16})\b/g, // AWS access key id
	/\b(glpat-[A-Za-z0-9_-]{16,})/g, // GitLab
	/\b(npm_[A-Za-z0-9]{30,})/g,
	/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g // a JWT
];

/** A long run of random-looking characters (hex, base64): masked even without a telling name. */
const LONG_RANDOM = /(?<![\w/.-])([A-Za-z0-9+/_-]{32,}={0,2})(?![\w/.-])/g;

/** Whether a run of characters looks random rather than like a word or a path. */
function randomLooking(s: string): boolean {
	if (/^[a-z]+$/i.test(s)) return false;
	const digits = (s.match(/\d/g) ?? []).length;
	const upper = (s.match(/[A-Z]/g) ?? []).length;
	const lower = (s.match(/[a-z]/g) ?? []).length;
	return digits >= 4 && (upper > 0 || lower > 0);
}

/** A command line with its secrets masked. */
export function maskSecrets(text: string): string {
	let out = text;
	// user:password@ in a URL.
	out = out.replace(/(\b[a-z][\w+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${MASK}@`);
	// ?token=…&key=… in a URL.
	out = out.replace(/([?&])([\w-]+)=([^\s&#]+)/g, (all, sep: string, name: string) =>
		SECRET_NAME.test(name) ? `${sep}${name}=${MASK}` : all
	);
	// --password=…, --api-key …, -p … is left alone (too common for ports).
	out = out.replace(
		/(--?[\w-]+)(=|\s+)("[^"]*"|'[^']*'|\S+)/g,
		(all, flag: string, sep: string, value: string) =>
			SECRET_NAME.test(flag) && !value.startsWith('-') ? `${flag}${sep}${MASK}` : all
	);
	// NAME=value, as in an environment variable given on the command line.
	out = out.replace(/\b([A-Za-z_][\w]*)=("[^"]*"|'[^']*'|[^\s&]+)/g, (all, name: string) =>
		SECRET_NAME.test(name) ? `${name}=${MASK}` : all
	);
	// Authorization headers.
	out = out.replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`);
	for (const shape of TOKEN_SHAPES) out = out.replace(shape, MASK);
	out = out.replace(LONG_RANDOM, (all, run: string) => (randomLooking(run) ? MASK : all));
	return out;
}

/** The home folder shown as ~, so a path does not carry the user's name. */
export function tildePath(p: string, home: string): string {
	if (!home || home === '/') return p;
	return p.split(home).join('~');
}

/** A command line as Soundings keeps it: masked, the home folder as ~, and cut short. */
export function cleanCommand(args: string, home: string, max = 200): string {
	const masked = tildePath(maskSecrets(args.replace(/\s+/g, ' ').trim()), home);
	return masked.length > max ? `${masked.slice(0, max - 1).trimEnd()}…` : masked;
}
