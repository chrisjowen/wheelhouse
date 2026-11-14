import { describe, expect, it } from 'vitest';
import { parsePicker } from './picker';
import { atClaudePrompt, parseSignIn, readSignIn, terminalExcerpt } from './waiting';

// Screens as `tmux capture-pane -p` shows them at 100 columns (Claude Code 2.1.280,
// Codex 0.169.0, Pi 0.80.10), with made-up challenges, states and codes.
const RULE = '─'.repeat(100);
const screen = (...lines: string[]) => [...lines, '', ''].join('\n');
const LOGO = [
	'Welcome to Claude Code v2.1.280',
	'..........................................................',
	'       █████████                                        *',
	'.......█ █   █ █..........................................',
	''
];

// The captain's screen: Claude Code's first run asks how to sign in.
const LOGIN_METHOD = screen(
	...LOGO,
	' Claude Code can be used with your Claude subscription or billed based on API usage through your',
	' Console account.',
	'',
	' Select login method:',
	'',
	' ❯ 1. Claude account with subscription · Pro, Max, Team, or Enterprise',
	'   2. Anthropic Console account · API usage billing',
	'   3. 3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI'
);

// ...and, once one is chosen, the screen the chat could not show.
const CLAUDE_URL =
	'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference&code_challenge=CHALLENGEchallengeCHALLENGEchallenge0123456&code_challenge_method=S256&state=STATEstateSTATEstate';
const wrap = (text: string, width = 100) => text.match(new RegExp(`.{1,${width}}`, 'g')) ?? [];
const claudePaste = (typed = '') =>
	screen(
		...LOGO,
		" Browser didn't open? Use the url below to sign in (c to copy)",
		'',
		...wrap(CLAUDE_URL),
		'',
		'',
		` Paste code here if prompted >${typed ? ` ${typed}` : ''}`
	);

const CLAUDE_OAUTH_ERROR = screen(
	...LOGO,
	' OAuth error: Invalid code. Please make sure the full code was copied',
	'',
	'',
	' Press Enter to retry.'
);

const CLAUDE_THEME = screen(
	...LOGO,
	" Let's get started.",
	'',
	' Choose the text style that looks best with your terminal',
	'   1. Auto (match terminal)',
	' ❯ 2. Dark mode ✔',
	'   3. Light mode',
	'',
	' ' + '╌'.repeat(98),
	'  1  function greet() {',
	'  2 -  console.log("Hello, World!");',
	'  2 +  console.log("Hello, Claude!");',
	'  3  }',
	' ' + '╌'.repeat(98),
	'  Syntax theme: Monokai Extended (ctrl+t to disable)'
);

const IDLE = screen(
	'⏺ Here is the plan.',
	RULE,
	'❯ ',
	RULE,
	'  ⏵⏵ bypass permissions on (shift+tab to cycle)'
);
const BUSY = screen(
	'✻ Brewing… (3s)',
	RULE,
	'❯ also check the docs',
	'  and the README',
	RULE,
	'  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt'
);
const OLD_BOX = screen(
	'╭' + '─'.repeat(98) + '╮',
	'│ > │',
	'╰' + '─'.repeat(98) + '╯',
	'  ? for shortcuts'
);

const CODEX_DEVICE = screen(
	"  Welcome to Codex, OpenAI's command-line coding agent",
	'',
	'  Finish signing in via your browser',
	'',
	'  1. Open this link in your browser and sign in',
	'',
	'  https://auth.openai.com/codex/device',
	'',
	'  2. Enter this one-time code after you are signed in (expires in 15 minutes)',
	'',
	'  ABCD-EFG12',
	'',
	'  Continue only if you started this login in Codex. If a website or another person gave you this',
	'code, cancel.',
	'',
	'  Press esc to cancel'
);

const CODEX_URL =
	'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&code_challenge=CHALLENGE&code_challenge_method=S256&state=STATE&originator=codex-tui';
const CODEX_BROWSER = screen(
	"  Welcome to Codex, OpenAI's command-line coding agent",
	'',
	'  Finish signing in via your browser',
	'',
	"  If the link doesn't open automatically, press c to copy it:",
	'',
	...wrap(`  ${CODEX_URL}`),
	'',
	'  On a remote or headless machine? Press esc and choose Sign in with Device Code.',
	'',
	'  Press esc to cancel'
);

const PI_URL =
	'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A53692%2Fcallback&code_challenge=CHALLENGE&code_challenge_method=S256&state=STATE';
const pi = (typed = '') =>
	screen(
		RULE,
		' Login to Anthropic',
		'',
		...wrap(PI_URL, 99).map((l) => ` ${l}`),
		' Cmd+click to open',
		'',
		' Complete login in your browser. If the browser is on another machine, paste the final redirect URL',
		' here.',
		'',
		' Complete login in your browser, or paste the authorization code / redirect URL here:',
		`>${typed ? ` ${typed}` : ''}`,
		' (escape/ctrl+c to cancel)',
		RULE,
		'~/firstmate',
		'0.0%/0 (auto)                                                                                unknown'
	);

describe('parseSignIn', () => {
	it('reads Claude Code’s sign-in link, whole where the terminal wrapped it, and its paste field', () => {
		expect(parseSignIn(claudePaste())).toEqual({
			url: CLAUDE_URL,
			code: null,
			paste: true,
			note: null,
			signature: expect.stringMatching(/^[0-9a-f]{16}$/)
		});
		expect(readSignIn(claudePaste())!.typed).toBe('');
	});

	it('says what is already typed into the field, without changing which sign-in it is', () => {
		const typed = readSignIn(claudePaste('3'))!;
		expect(typed.typed).toBe('3');
		expect(typed.signIn.signature).toBe(parseSignIn(claudePaste())!.signature);
	});

	it('reads Codex’s device code, and its browser sign-in with its note on remote machines', () => {
		expect(parseSignIn(CODEX_DEVICE)).toMatchObject({
			url: 'https://auth.openai.com/codex/device',
			code: 'ABCD-EFG12',
			paste: false
		});
		expect(parseSignIn(CODEX_BROWSER)).toMatchObject({
			url: CODEX_URL,
			code: null,
			paste: false,
			note: 'On a remote or headless machine? Press esc and choose Sign in with Device Code.'
		});
	});

	it('reads Pi’s login, which takes the code on the row under its question', () => {
		const read = readSignIn(pi())!;
		expect(read.signIn).toMatchObject({
			url: PI_URL,
			paste: true,
			note: 'Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.'
		});
		expect(readSignIn(pi('abc'))!.typed).toBe('abc');
	});

	it('tells one sign-in from the next', () => {
		const again = claudePaste().replace('STATEstate', 'OTHERstate');
		expect(parseSignIn(again)!.signature).not.toBe(parseSignIn(claudePaste())!.signature);
	});

	it('offers a link only to the harnesses’ own sign-in pages', () => {
		const elsewhere = claudePaste().replace(
			'https://claude.com/',
			'https://claude.com.evil.example/'
		);
		expect(parseSignIn(elsewhere)).toBeNull();
		expect(
			parseSignIn(claudePaste().replace('https://claude.com/', 'https://evil.example/'))
		).toBeNull();
		expect(parseSignIn(claudePaste().replace('https://', 'http://'))).toBeNull();
	});

	it('sees nothing on other screens', () => {
		for (const s of [LOGIN_METHOD, CLAUDE_OAUTH_ERROR, CLAUDE_THEME, IDLE, BUSY, '', null])
			expect(parseSignIn(s)).toBeNull();
		// The words alone, in a reply above the prompt, are not the sign-in screen.
		expect(parseSignIn(screen(' Paste code here if prompted >', ...IDLE.split('\n')))).toBeNull();
	});
});

describe('atClaudePrompt', () => {
	it('finds Claude Code’s prompt, idle or busy, with what is typed in it', () => {
		expect(atClaudePrompt(IDLE)).toBe(true);
		expect(atClaudePrompt(BUSY)).toBe(true);
		expect(atClaudePrompt(OLD_BOX)).toBe(true);
	});

	it('finds no prompt on the screens it stops on before it is ready', () => {
		// The captain's two screens: the login choice (a question the chat shows), then the paste field.
		expect(parsePicker(LOGIN_METHOD)?.options.map((o) => o.label)).toEqual([
			'Claude account with subscription · Pro, Max, Team, or Enterprise',
			'Anthropic Console account · API usage billing',
			'3rd-party platform · Amazon Bedrock, Microsoft Foundry, or Vertex AI'
		]);
		for (const s of [LOGIN_METHOD, claudePaste(), CLAUDE_OAUTH_ERROR, CLAUDE_THEME])
			expect(atClaudePrompt(s)).toBe(false);
		// A message the captain sent shows with the prompt sign, but not under a rule.
		expect(atClaudePrompt(screen('❯ hello', '⏺ Hi.'))).toBe(false);
	});
});

describe('terminalExcerpt', () => {
	it('keeps the last rows that say something, without the logo’s art or rules', () => {
		expect(terminalExcerpt(CLAUDE_OAUTH_ERROR)).toBe(
			'Welcome to Claude Code v2.1.280\nOAuth error: Invalid code. Please make sure the full code was copied\nPress Enter to retry.'
		);
		expect(terminalExcerpt(CLAUDE_THEME)).toBe(
			'2 +  console.log("Hello, Claude!");\n3  }\nSyntax theme: Monokai Extended (ctrl+t to disable)'
		);
	});

	it('shortens a long row', () => {
		expect(terminalExcerpt('x'.repeat(400))).toHaveLength(160);
	});
});
