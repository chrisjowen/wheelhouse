import { generateKeyPairSync, createPrivateKey, randomUUID, X509Certificate } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import { MACHINE_LABEL } from './protocol';
import {
	certificateDnsNames,
	createCertificateRequest,
	embeddedSctCount,
	pemCertificates,
	SERVER_AUTH,
	spkiSha256,
	toPem
} from './x509';

/**
 * The certificate for this machine's own origin (§12.2 of the protocol). The
 * machine makes a new ECDSA P-256 key for each certificate and keeps it; the
 * gateway sees only the signed request and returns the chain, which the
 * machine checks before it uses it, and renews two thirds of the way through.
 * It also keeps the machine label the gateway first handed over (§12.1), and
 * the keys it made for its names, for a Certificate Transparency watch (§12.8).
 */

/** How long it waits for `cert.issued` before asking again (§12.10). */
export const CERT_ANSWER_MS = 10 * 60_000;
const RETRY_MS = 15 * 60_000;
const MAX_RETRY_MS = 24 * 60 * 60_000;
/** How long after a key's last certificate expires the machine still counts the key as its own (§12.8). */
const KEY_MEMORY_MS = 30 * 24 * 60 * 60_000;

export interface OriginCertificateOptions {
	/** Where the key, chain and state are kept; made with mode 0700. */
	dir: string;
	/** The roots a chain must lead to (PEM); Node's bundled public roots when unset. */
	trust?: readonly string[];
	/** Least embedded SCTs a certificate must carry (§12.8): 2. Only a test CA that logs nothing has fewer. */
	minScts?: number;
	log?: (line: string) => void;
	now?: () => number;
}

/** A key this machine made for its names, by its SubjectPublicKeyInfo's SHA-256 (§12.8). */
export interface OwnKey {
	spki: string;
	createdAt: number;
	/** When the last certificate for it expires; unset until one is issued. */
	notAfter?: number;
}

interface State {
	label?: string;
	keys: OwnKey[];
}

/** What it needs from the connector to ask: a signature by its device key over the request, and the socket. */
export interface CertTransport {
	sign(csrDer: Buffer): string;
	send(msg: Record<string, unknown>): void;
}

/**
 * Why a chain can't be used for `names` with `key`, or null when it can
 * (§12.2 step 5): the leaf holds that key, names exactly those names, is for
 * TLS servers and carries enough SCTs; every certificate is valid now; and
 * each is issued by the next, up to one of `trust`.
 */
export function chainProblem(
	chain: string,
	key: KeyObject,
	names: readonly string[],
	o: { now: number; trust: readonly string[]; minScts: number }
): string | null {
	let certs: X509Certificate[];
	try {
		certs = pemCertificates(chain);
	} catch {
		return 'the chain is not PEM certificates';
	}
	const leaf = certs[0];
	if (!leaf) return 'the chain is empty';
	if (spkiSha256(leaf.publicKey) !== spkiSha256(key)) {
		return 'the certificate is not for this machine’s key';
	}
	let leafNames: string[];
	try {
		leafNames = certificateDnsNames(leaf);
	} catch {
		return 'the certificate names something other than DNS names';
	}
	if (leafNames.length !== names.length || !names.every((n) => leafNames.includes(n))) {
		return `the certificate names ${leafNames.join(', ') || 'nothing'}, not ${names.join(', ')}`;
	}
	for (const c of certs) {
		if (!(Date.parse(c.validFrom) <= o.now && o.now < Date.parse(c.validTo))) {
			return 'a certificate in the chain is not valid now';
		}
	}
	if (!leaf.keyUsage?.includes(SERVER_AUTH)) return 'the certificate is not for TLS servers';
	for (let i = 0; i + 1 < certs.length; i++) {
		const [c, issuer] = [certs[i], certs[i + 1]];
		if (!issuer.ca || !c.checkIssued(issuer) || !c.verify(issuer.publicKey)) {
			return 'the chain is broken';
		}
	}
	const last = certs[certs.length - 1];
	const anchored = o.trust.some((pem) => {
		try {
			const root = new X509Certificate(pem);
			return (
				root.fingerprint256 === last.fingerprint256 ||
				(root.ca && last.checkIssued(root) && last.verify(root.publicKey))
			);
		} catch {
			return false;
		}
	});
	if (!anchored) return 'the chain does not lead to a trusted root';
	if (embeddedSctCount(leaf) < o.minScts) {
		return `the certificate carries fewer than ${o.minScts} signed certificate timestamps`;
	}
	return null;
}

export class OriginCertificate {
	private state: State = { keys: [] };
	private held: { key: KeyObject; chain: string; notBefore: number; notAfter: number } | null =
		null;
	private asking: {
		ref: string;
		key: KeyObject;
		names: [string, string];
		timer: ReturnType<typeof setTimeout>;
	} | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private failures = 0;
	private origin: { label: string; domain: string } | null = null;
	private transport: CertTransport | null = null;
	private readonly now: () => number;

	constructor(private readonly o: OriginCertificateOptions) {
		this.now = o.now ?? Date.now;
		mkdirSync(o.dir, { recursive: true, mode: 0o700 });
		try {
			this.state = { keys: [], ...JSON.parse(readFileSync(this.file('state.json'), 'utf8')) };
		} catch {
			// Nothing kept yet.
		}
		try {
			const key = createPrivateKey(readFileSync(this.file('key.pem')));
			const chain = readFileSync(this.file('chain.pem'), 'utf8');
			const leaf = pemCertificates(chain)[0];
			this.held = {
				key,
				chain,
				notBefore: Date.parse(leaf.validFrom),
				notAfter: Date.parse(leaf.validTo)
			};
		} catch {
			// No certificate yet.
		}
	}

	/** The label this machine was first given (§12.1). */
	get label(): string | null {
		return this.state.label ?? null;
	}

	/** The keys it made for its names, for a CT watch (§12.8). */
	get keys(): readonly OwnKey[] {
		return this.state.keys;
	}

	/** The origin it serves, once a gateway handed over the label it keeps (§12.1). */
	serving(): { label: string; domain: string } | null {
		return this.origin && this.state.label === this.origin.label ? { ...this.origin } : null;
	}

	/** Its key and chain while it holds a valid certificate for its names; until then it serves nothing under §12. */
	current(): { key: KeyObject; chain: string; notAfter: number } | null {
		const h = this.held;
		if (!h || !this.serving()) return null;
		return chainProblem(h.chain, h.key, this.names(), this.checks())
			? null
			: { key: h.key, chain: h.chain, notAfter: h.notAfter };
	}

	/**
	 * `ready` carried `sealed-origin` and this origin. Keeps the first label it
	 * is given and refuses any other; then asks for a certificate when it has
	 * none, or once it is due for renewal. Returns why it serves nothing, or
	 * null once it serves this origin.
	 */
	ready(
		origin: { label: string; domain: string },
		gatewayHost: string,
		transport: CertTransport
	): string | null {
		this.disconnected();
		if (!MACHINE_LABEL.test(origin.label) || origin.domain !== `m.${gatewayHost.toLowerCase()}`) {
			return `the gateway gave a malformed machine origin (${origin.label}.${origin.domain})`;
		}
		if (this.state.label && this.state.label !== origin.label) {
			return `the gateway named this machine ${origin.label}, but it is ${this.state.label}; pair it again to take a new name`;
		}
		if (!this.state.label) {
			this.state.label = origin.label;
			this.save();
		}
		this.origin = origin;
		this.transport = transport;
		this.schedule();
		return null;
	}

	/** The socket dropped: an unanswered request is asked again after the next `ready`. */
	disconnected(): void {
		if (this.timer) clearTimeout(this.timer);
		if (this.asking) clearTimeout(this.asking.timer);
		this.timer = null;
		this.asking = null;
		this.transport = null;
	}

	/** A `cert.issued` from the gateway. */
	answer(msg: Record<string, unknown>): void {
		const asking = this.asking;
		if (!asking || msg.ref !== asking.ref) return;
		clearTimeout(asking.timer);
		this.asking = null;
		if (msg.ok !== true || typeof msg.chain !== 'string') {
			const reason = typeof msg.reason === 'string' ? msg.reason.slice(0, 200) : 'refused';
			this.log(`the gateway did not issue this machine’s origin certificate: ${reason}`);
			return this.retry(reason === 'rate_limited' ? MAX_RETRY_MS : 0);
		}
		const problem = chainProblem(msg.chain, asking.key, asking.names, this.checks());
		if (problem) {
			this.log(`refused the origin certificate the gateway returned: ${problem}`);
			return this.retry();
		}
		const leaf = pemCertificates(msg.chain)[0];
		const notAfter = Date.parse(leaf.validTo);
		write(this.file('key.pem'), asking.key.export({ format: 'pem', type: 'pkcs8' }) as string);
		write(this.file('chain.pem'), msg.chain);
		this.held = {
			key: asking.key,
			chain: msg.chain,
			notBefore: Date.parse(leaf.validFrom),
			notAfter
		};
		const spki = spkiSha256(asking.key);
		this.state.keys = this.state.keys.map((k) =>
			k.spki === spki ? { ...k, notAfter: Math.max(k.notAfter ?? 0, notAfter) } : k
		);
		this.save();
		this.failures = 0;
		this.log(
			`this machine’s origin certificate is valid until ${new Date(notAfter).toISOString()}.`
		);
		this.schedule();
	}

	stop(): void {
		this.disconnected();
	}

	/** Asks now when it holds no usable certificate, else at two thirds of its lifetime. */
	private schedule(): void {
		const h = this.held;
		const due =
			this.current() && h ? h.notBefore + ((h.notAfter - h.notBefore) * 2) / 3 : this.now();
		this.wait(due - this.now(), () => this.ask());
	}

	private retry(min = 0): void {
		const delay = Math.max(min, Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** this.failures++));
		this.wait(delay, () => this.ask());
	}

	private wait(ms: number, fn: () => void): void {
		if (this.timer) clearTimeout(this.timer);
		// setTimeout takes at most about 24.8 days; a longer wait is taken in steps.
		const step = Math.min(Math.max(0, ms), 2 ** 31 - 1);
		this.timer = setTimeout(() => (step < ms ? this.wait(ms - step, fn) : fn()), step);
		this.timer.unref?.();
	}

	private ask(): void {
		const t = this.transport;
		if (!t || !this.origin || this.asking) return;
		const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
		const names = this.names();
		const csr = createCertificateRequest(key, names);
		const held = this.held ? spkiSha256(this.held.key) : null;
		this.state.keys = [
			...this.state.keys.filter(
				(k) => this.now() - (k.notAfter ?? k.createdAt) < KEY_MEMORY_MS || k.spki === held
			),
			{ spki: spkiSha256(key), createdAt: this.now() }
		];
		this.save();
		const ref = randomUUID();
		const timer = setTimeout(() => {
			if (this.asking?.ref !== ref) return;
			this.asking = null;
			this.log('the gateway did not answer the origin certificate request; asking again later.');
			this.retry();
		}, CERT_ANSWER_MS);
		timer.unref?.();
		this.asking = { ref, key, names, timer };
		this.log(`asking for this machine’s origin certificate for ${names[0]}.`);
		t.send({ t: 'cert.request', ref, csr: toPem('CERTIFICATE REQUEST', csr), sig: t.sign(csr) });
	}

	private names(): [string, string] {
		const host = `${this.state.label}.${this.origin!.domain}`;
		return [host, `*.${host}`];
	}

	private checks() {
		return {
			now: this.now(),
			trust: this.o.trust ?? rootCertificates,
			minScts: this.o.minScts ?? 2
		};
	}

	private file(name: string): string {
		return path.join(this.o.dir, name);
	}

	private save(): void {
		write(this.file('state.json'), JSON.stringify(this.state, null, 2) + '\n');
	}

	private log(line: string): void {
		this.o.log?.(line);
	}
}

/** Writes a file with mode 0600, replacing it whole. */
function write(file: string, content: string): void {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, content, { mode: 0o600 });
	renameSync(tmp, file);
}
