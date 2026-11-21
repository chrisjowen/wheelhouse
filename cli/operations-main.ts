import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { version } from '../package.json';
import { OPERATIONS_FILE, operationsReference } from './operations';

/**
 * Write the operations reference (cli/operations.ts) from the commands and
 * routes of this checkout. Run by scripts/gen-operations.mjs, which bundles
 * this file first: `npm run gen:operations`.
 */

const root = process.cwd();
await writeFile(path.join(root, OPERATIONS_FILE), await operationsReference(root, version));
console.log(`Wrote ${OPERATIONS_FILE} for Wheelhouse ${version}.`);
