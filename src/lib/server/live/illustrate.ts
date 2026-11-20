import { tmpdir } from 'node:os';
import { runBounded } from '../firstmate/exec';

/**
 * The illustrator the discussion crew calls on for a picture: a one-off
 * Claude Code run, with no tools, that draws a self-contained SVG in
 * Wheelhouse's palette. The page shows it as an image, where no script can
 * run; scripts, event handlers and embedded HTML are stripped anyway.
 */

const SYSTEM = `You are an illustrator for a calm, classic product UI (night-watch navy: background #0d141c, panels #111b26 and #16212c, hairlines #1f2b38, ink #eef1f3 and #8e9aa6, accents gold #e8b04a, teal #3cc6a8, blue #5b9bff, coral #f08a6c). Draw the requested picture as ONE self-contained SVG: viewBox="0 0 960 540", a full-bleed background rect, a refined flat illustration with gentle gradients, clean geometry and generous spacing. Any text is short, sentence case, font-family "DM Sans, Helvetica, sans-serif", never smaller than 16px. No scripts, external images, font links or foreignObject. Output ONLY the <svg>…</svg> markup.`;

/** Only the SVG, with anything that could run removed. Pure. */
export function cleanSvg(out: string): string | null {
	const m = /<svg[\s\S]*<\/svg>/i.exec(out);
	if (!m) return null;
	return m[0]
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
		.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
		.replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#');
}

export async function illustrate(
	claude: string,
	prompt: string,
	model = 'sonnet'
): Promise<string | null> {
	const r = await runBounded(
		claude,
		[
			'-p',
			'--model',
			model,
			'--setting-sources',
			'',
			'--strict-mcp-config',
			'--no-session-persistence',
			'--tools',
			'',
			'--system-prompt',
			SYSTEM
		],
		{
			input: prompt,
			cwd: tmpdir(),
			timeoutMs: 150_000,
			maxOutputBytes: 1024 * 1024,
			env: { ...process.env, MAX_THINKING_TOKENS: '0' }
		}
	);
	return cleanSvg(r.stdout);
}
