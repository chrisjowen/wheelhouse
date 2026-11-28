import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * A certificate authority for tests of a machine's own origin (§12.2 of the
 * wheelhouse-cloud protocol): it signs the machine's request the way a public
 * CA would, for the names asked, for TLS servers, with embedded signed
 * certificate timestamps (placeholders, as no log is involved). It uses the
 * `openssl` command, as Node signs no certificates.
 */

const run = promisify(execFile);

/** A TLS-encoded SignedCertificateTimestampList of `n` placeholder SCTs, as an OCTET STRING (RFC 6962 §3.3). */
function sctListDer(n: number): Buffer {
	const entries = Array.from({ length: n }, (_, i) => {
		const sct = Buffer.alloc(47, i + 1);
		const len = Buffer.alloc(2);
		len.writeUInt16BE(sct.length);
		return Buffer.concat([len, sct]);
	});
	const body = Buffer.concat(entries);
	const total = Buffer.alloc(2);
	total.writeUInt16BE(body.length);
	const list = Buffer.concat([total, body]);
	const head = list.length < 0x80 ? [0x04, list.length] : [0x04, 0x81, list.length];
	return Buffer.concat([Buffer.from(head), list]);
}

export interface LocalCa {
	/** The root, PEM, for the machine and the browser to trust. */
	root: string;
	/** Signs a request for `names` (PEM); the leaf, PEM. */
	sign(
		csrPem: string,
		names: string[],
		o?: { scts?: number; serverAuth?: boolean }
	): Promise<string>;
	close(): Promise<void>;
}

export async function localCa(): Promise<LocalCa> {
	const dir = await mkdtemp(path.join(tmpdir(), 'wh-origin-ca-'));
	const openssl = (args: string[]) => run('openssl', args, { cwd: dir });
	await openssl([
		'req',
		'-x509',
		'-newkey',
		'ec',
		'-pkeyopt',
		'ec_paramgen_curve:P-256',
		'-nodes',
		'-keyout',
		'ca.key',
		'-out',
		'ca.crt',
		'-days',
		'30',
		'-subj',
		'/CN=Origin Test Root',
		'-addext',
		'basicConstraints=critical,CA:TRUE',
		'-addext',
		'keyUsage=critical,keyCertSign,cRLSign'
	]);
	const root = await readFile(path.join(dir, 'ca.crt'), 'utf8');
	let n = 0;
	return {
		root,
		async sign(csrPem, names, o = {}) {
			const id = n++;
			await writeFile(path.join(dir, `${id}.csr`), csrPem);
			const scts = o.scts ?? 2;
			const ext = [
				'basicConstraints=critical,CA:FALSE',
				`subjectAltName=${names.map((d) => `DNS:${d}`).join(',')}`,
				`extendedKeyUsage=${o.serverAuth === false ? 'clientAuth' : 'serverAuth'}`,
				...(scts > 0 ? [`1.3.6.1.4.1.11129.2.4.2=DER:${sctListDer(scts).toString('hex')}`] : [])
			];
			await writeFile(path.join(dir, `${id}.ext`), ext.join('\n') + '\n');
			await openssl([
				'x509',
				'-req',
				'-in',
				`${id}.csr`,
				'-CA',
				'ca.crt',
				'-CAkey',
				'ca.key',
				'-set_serial',
				`0x${randomBytes(12).toString('hex')}`,
				'-days',
				'7',
				'-extfile',
				`${id}.ext`,
				'-out',
				`${id}.crt`
			]);
			return readFile(path.join(dir, `${id}.crt`), 'utf8');
		},
		close: () => rm(dir, { recursive: true, force: true })
	};
}
