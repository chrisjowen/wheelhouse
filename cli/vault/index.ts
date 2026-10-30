#!/usr/bin/env node
import type { ReadStream } from 'node:tty';
import { KeychainBackend } from './keychain';
import { vaultProgram } from './program';
import { readHidden, readStdin } from './prompt';

/**
 * The `wh-vault` command (bundled to dist/wh-vault.js). See program.ts for the
 * commands and docs/vault.md for how to use it and what it does not protect.
 */

await vaultProgram({
	backend: new KeychainBackend(),
	env: process.env,
	cwd: process.cwd(),
	stdout: process.stdout,
	stderr: process.stderr,
	readValue: async (prompt) => {
		if ((process.stdin as ReadStream).isTTY) return readHidden(prompt);
		const value = await readStdin();
		return value || null;
	},
	forwardSignals: true
}).parseAsync(process.argv);
