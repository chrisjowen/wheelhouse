import type { ReadStream } from 'node:tty';

/**
 * Reading a secret's value without it ever reaching a command line, a file or
 * the screen: from the terminal with echo off, or from stdin when it is piped.
 */

/** A line typed at the terminal, not echoed; null on Ctrl-C, or Ctrl-D with nothing typed. */
export function readHidden(
	prompt: string,
	input: ReadStream = process.stdin as ReadStream,
	output: NodeJS.WritableStream = process.stderr
): Promise<string | null> {
	return new Promise((resolve) => {
		output.write(prompt);
		const wasRaw = input.isRaw;
		input.setRawMode(true);
		input.resume();
		let value = '';
		const finish = (v: string | null) => {
			input.off('data', onData);
			input.setRawMode(wasRaw);
			input.pause();
			output.write('\n');
			resolve(v);
		};
		const onData = (chunk: Buffer) => {
			// Arrow and function keys arrive as escape sequences; they are not part of a value.
			// eslint-disable-next-line no-control-regex
			const text = chunk.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, '');
			for (const ch of text) {
				if (ch === '\r' || ch === '\n') return finish(value);
				if (ch === '\u0003') return finish(null);
				if (ch === '\u0004') return finish(value || null);
				if (ch === '\u007f' || ch === '\b') value = [...value].slice(0, -1).join('');
				else if (ch === '\u0015') value = '';
				else if (ch >= ' ' || ch === '\t') value += ch;
			}
		};
		input.on('data', onData);
	});
}

/** All of stdin, without one trailing newline. */
export async function readStdin(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const c of input) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
	return Buffer.concat(chunks)
		.toString('utf8')
		.replace(/\r?\n$/, '');
}
