#!/usr/bin/env node
import type { ReadStream } from 'node:tty';
import { vaultProgram } from './program';
import { readHidden, readStdin } from './prompt';
import { platformBackends } from './select';

/**
 * The `wh-vault` command (bundled to dist/wh-vault.js). See program.ts for the
 * commands and docs/vault.md for how to use it and what it does not protect.
 */

await vaultProgram({
	backend: platformBackends(),
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
