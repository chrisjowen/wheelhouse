import { createHash } from 'node:crypto';
import type { Picker } from '../../types';

export type CodexScreen =
	| { kind: 'prompt'; busy: boolean }
	| { kind: 'picker'; picker: Picker }
	| { kind: 'blocked'; title: string };

const OPTION = /^\s*(›\s*)?(\d+)\.\s+(.+)$/;
const CONFIRM = /\benter\b.*\b(?:confirm|select|submit|continue)\b/i;

/** Only a positively identified composer or numbered native dialog may receive input. */
export function codexScreen(text: string | null): CodexScreen {
	if (text === null) return { kind: 'blocked', title: 'Codex’s screen could not be read.' };
	const lines = text.replace(/\r/g, '').trimEnd().split('\n');
	const cursor = lines.findLastIndex((line) => /^\s*›(?:\s|$)/.test(line));
	if (cursor < 0) return { kind: 'blocked', title: 'Codex needs attention in its terminal.' };
	if (OPTION.test(lines[cursor])) {
		let start = cursor;
		while (start > 0 && OPTION.test(lines[start - 1])) start--;
		let end = cursor + 1;
		while (end < lines.length && OPTION.test(lines[end])) end++;
		const options: Picker['options'] = [];
		for (const line of lines.slice(start, end)) {
			const m = OPTION.exec(line);
			if (!m) return { kind: 'blocked', title: 'Use the terminal to answer Codex.' };
			options.push({
				n: Number(m[2]),
				label: m[3],
				description: '',
				checked: null,
				freeText: false
			});
		}
		if (
			options.some((option, index) => option.n !== index + 1) ||
			!CONFIRM.test(lines.slice(end).join('\n'))
		) {
			return { kind: 'blocked', title: 'Use the terminal to answer Codex.' };
		}
		return {
			kind: 'picker',
			picker: {
				title: lines.slice(0, start).join('\n').trim(),
				tabs: [],
				options,
				multiSelect: false,
				submitMoves: null,
				navigation: { selected: cursor - start + 1 },
				// Include the command and every visible option, not only the repeated Yes/No labels.
				signature: createHash('sha256').update(text).digest('hex').slice(0, 16)
			}
		};
	}
	const input = lines[cursor].replace(/^\s*›\s*/, '').trim();
	if (
		input &&
		!/^(?:Ask Codex to do anything|Ask for changes|Use \/skills to list available skills|Find and fix a bug in @filename|Explain this codebase|Summarize recent commits|Write tests for @filename|Improve documentation in @filename|Implement \{feature\})$/.test(
			input
		)
	) {
		return {
			kind: 'blocked',
			title: 'Codex has unsent input. Send or clear it in the terminal first.'
		};
	}
	if (cursor < lines.length - 7 || CONFIRM.test(lines.slice(cursor + 1).join('\n'))) {
		return { kind: 'blocked', title: 'Codex needs attention in its terminal.' };
	}
	return { kind: 'prompt', busy: /\besc to interrupt\b/i.test(text) };
}
