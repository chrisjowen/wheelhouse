#!/usr/bin/env node
import { CommanderError } from 'commander';
import { EXIT } from './agent';
import { program } from './index';

/**
 * The `wheelhouse` command (bundled to dist/cli.js). Its commands are built by
 * program() in index.ts, which runs nothing on import, so the operations
 * reference (cli/operations.ts) can read the same commands' help.
 */

try {
	await program().parseAsync(process.argv);
} catch (e) {
	// The agent commands' usage errors (cli/agent.ts usageExits): commander has printed why.
	if (!(e instanceof CommanderError)) throw e;
	process.exit(e.exitCode === 0 ? EXIT.ok : EXIT.usage);
}
