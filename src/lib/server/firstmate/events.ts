/** Setup-only extension commands. Dispatch has no reference to this class or to the Messenger. */
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { runBounded } from './exec';
import { scriptEnv } from './scriptenv';
import type { FirstmateInstall } from './install';
interface Connection {
	token: string | null;
	version: string;
	bindingDigest: string;
}
export class EventsConnection {
	private busy = false;
	constructor(
		private install: FirstmateInstall,
		private dir: string,
		private packageDir: string,
		private env: NodeJS.ProcessEnv
	) {}
	private async run(script: string, args: string[]) {
		const r = await runBounded(path.join(this.install.firstmateDir, 'bin', script), args, {
			env: { ...scriptEnv(this.env), FM_HOME: this.install.homeDir },
			cwd: this.install.firstmateDir,
			timeoutMs: 120000,
			maxOutputBytes: 65536
		});
		if (!r.ok) throw new Error(`${script}: ${r.stderr.trim() || r.message}`);
		return r.stdout;
	}
	private get file() {
		return path.join(this.dir, 'connection.json');
	}
	private async record(): Promise<Connection | null> {
		try {
			const c = JSON.parse(await readFile(this.file, 'utf8'));
			if (
				(c.token !== null && !/^sha256:[a-f0-9]{64}$/.test(c.token)) ||
				!/^sha256:[a-f0-9]{64}$/.test(c.bindingDigest)
			)
				throw new Error('Invalid connection record.');
			return c;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
			throw e;
		}
	}
	async view() {
		const record = await this.record();
		if (!record) return { connected: false, bound: false, pending: null, connectionProblem: null };
		try {
			const list = await this.run('fm-procevent.sh', ['list']);
			const row = /^wh-events\s+wheelhouse-events\s+\S+\s+(\d+)$/m.exec(list);
			return {
				connected: !!row,
				bound: true,
				pending: row ? Number(row[1]) : null,
				connectionProblem: null
			};
		} catch (e) {
			return {
				connected: false,
				bound: true,
				pending: null,
				connectionProblem: (e as Error).message
			};
		}
	}
	async connect(outbox: string) {
		if (this.busy) throw new Error('Events connection setup is already running.');
		this.busy = true;
		try {
			const existing = await this.record();
			if (existing)
				throw new Error(
					'Disconnect the existing source and retire its binding before rebinding an upgrade.'
				);
			const manifest = JSON.parse(
				await readFile(path.join(this.packageDir, 'firstmate-extension.json'), 'utf8')
			);
			const code = await readFile(path.join(this.packageDir, 'bin', 'wheelhouse-events.mjs'));
			const node = await realpath(process.execPath);
			const digest = createHash('sha256').update(code).update(node).digest('hex');
			// Firstmate refuses Git-local packages. Copy npm's exact code to a private, versioned install outside the project.
			const prepared = path.join(
				this.dir,
				'packages',
				`${manifest.version}-${digest}-${randomUUID()}`
			);
			await mkdir(path.dirname(prepared), { recursive: true, mode: 0o700 });
			await cp(this.packageDir, prepared, { recursive: true, dereference: false });
			const quote = (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
			await writeFile(
				path.join(prepared, 'bin', 'wheelhouse-events'),
				`#!/bin/sh\nexec ${quote(node)} "$(dirname "$0")/wheelhouse-events.mjs" "$@"\n`,
				{ mode: 0o755 }
			);
			manifest.entrypoint = 'bin/wheelhouse-events';
			await writeFile(path.join(prepared, 'firstmate-extension.json'), JSON.stringify(manifest), {
				mode: 0o600
			});
			const bound = await this.run('fm-extension.sh', [
				'bind',
				prepared,
				'--adapter',
				'wheelhouse-events',
				'--trust-same-user-code',
				'--consent',
				'artifact-references'
			]);
			const bindingDigest = /^binding-digest: (sha256:[a-f0-9]{64})$/m.exec(bound)?.[1];
			if (!bindingDigest) throw new Error('Firstmate did not return a binding digest.');
			await mkdir(this.dir, { recursive: true, mode: 0o700 });
			await writeFile(
				this.file,
				JSON.stringify({ token: null, version: manifest.version, bindingDigest }),
				{ mode: 0o600 }
			);
			const output = await this.run('fm-procevent.sh', [
				'register-extension',
				'wheelhouse-events',
				'wh-events',
				'--config-ref',
				outbox
			]);
			const token = /^owner-token: (sha256:[a-f0-9]{64})$/m.exec(output)?.[1];
			if (!token)
				throw new Error(
					'Firstmate did not return a retirement token. Inspect its source registration before retrying.'
				);
			await mkdir(this.dir, { recursive: true, mode: 0o700 });
			const tmp = this.file + '.tmp';
			await writeFile(tmp, JSON.stringify({ token, version: manifest.version, bindingDigest }), {
				mode: 0o600
			});
			await rename(tmp, this.file);
		} finally {
			this.busy = false;
		}
	}
	async disconnect() {
		if (this.busy) throw new Error('Events connection setup is already running.');
		this.busy = true;
		try {
			const record = await this.record();
			if (!record) return;
			if (record.token)
				await this.run('fm-procevent.sh', ['retire', 'wh-events', '--if-owner', record.token]);
			// Firstmate refuses binding retirement until all captured evidence is handled; preserve the record for retry.
			await this.run('fm-extension.sh', [
				'retire-binding',
				'io.wheelhouse.events',
				'--if-binding-digest',
				record.bindingDigest
			]);
			const { rm } = await import('node:fs/promises');
			await rm(this.file);
		} finally {
			this.busy = false;
		}
	}
}
