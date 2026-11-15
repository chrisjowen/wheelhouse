import { constants } from 'node:fs';
import { access, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import type { FirstmateInstall } from './install';
import { parseProjectsRegistry } from './model';
import { runBounded } from './exec';
import type { SettingsTopicId } from '../../firstmate-settings';

export type SettingTag = 'Editable' | 'Ask Firstmate' | 'Security' | 'Captain only' | 'Read only';

export interface SettingDetail {
	title: string;
	rows: { label: string; value: string }[];
}

export interface FirstmateSetting {
	id: string;
	topic: SettingsTopicId;
	label: string;
	meaning: string;
	value: string;
	sub: string | null;
	tag: SettingTag | null;
	share: 'shared' | 'home' | 'not-applicable';
	shareText: string;
	affects: string;
	history: string[];
	details: SettingDetail[];
	technical: { file: string; reader: string; documentation: string; effect?: string };
}

export interface FirstmateProject {
	name: string;
	mode: string;
	modeShort: string;
	autoMerge: boolean;
	capacity: number | null;
	meaning: string;
	shareText: string;
	history: string[];
	technical: FirstmateSetting['technical'];
}

export interface FirstmateMate {
	id: string;
	remote: boolean;
	projects: string[];
}

export interface FirstmateSettingsView {
	available: boolean;
	reason: string | null;
	readAt: string;
	projectCount: number;
	mateCount: number;
	dispatchRuleCount: number;
	settings: FirstmateSetting[];
	projects: FirstmateProject[];
	mates: FirstmateMate[];
	startupBudget: { budget: number; used: number | null; overBy: number | null } | null;
}

interface FileRead {
	state: 'present' | 'absent' | 'unreadable';
	text: string | null;
	modifiedAt: Date | null;
}

interface MateRoute {
	id: string;
	host: string | null;
	projects: string[];
}

interface DispatchProfile {
	harness: string;
	model: string | null;
	effort: string | null;
	floor: number | null;
}

interface DispatchRule {
	when: string;
	use: DispatchProfile[];
}

interface DispatchConfig {
	rules: DispatchRule[];
	fallback: DispatchProfile[];
	preferredProvider: string | null;
}

const MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_STARTUP_BUDGET = 7500;
const DOC = 'docs/configuration.md';
const SHARE =
	'Shared with second mates. This page shows this home’s setting, not a remote mate’s effective value.';
const LOCAL = 'This home only. Each Firstmate home keeps its own value.';
const NO_HISTORY = 'No change history is recorded for this setting.';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function readFileInfo(homeDir: string, relative: string): Promise<FileRead> {
	const file = path.join(homeDir, relative);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		const link = await lstat(file);
		if (link.isSymbolicLink() || !link.isFile() || link.nlink > 1 || link.size > MAX_FILE_BYTES)
			return { state: 'unreadable', text: null, modifiedAt: null };
		handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const info = await handle.stat();
		if (!info.isFile() || info.nlink > 1 || info.size > MAX_FILE_BYTES)
			return { state: 'unreadable', text: null, modifiedAt: null };
		const chunks: Buffer[] = [];
		let bytesRead = 0;
		while (bytesRead <= MAX_FILE_BYTES) {
			const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - bytesRead));
			const result = await handle.read(chunk, 0, chunk.length, bytesRead);
			if (!result.bytesRead) break;
			bytesRead += result.bytesRead;
			if (bytesRead > MAX_FILE_BYTES) return { state: 'unreadable', text: null, modifiedAt: null };
			chunks.push(chunk.subarray(0, result.bytesRead));
		}
		return {
			state: 'present',
			text: Buffer.concat(chunks, bytesRead).toString('utf8'),
			modifiedAt: info.mtime
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return { state: 'absent', text: null, modifiedAt: null };
		return { state: 'unreadable', text: null, modifiedAt: null };
	} finally {
		await handle?.close().catch(() => {});
	}
}

async function filePresence(homeDir: string, relative: string): Promise<FileRead> {
	try {
		const info = await lstat(path.join(homeDir, relative));
		return info.isFile() && !info.isSymbolicLink() && info.nlink === 1
			? { state: 'present', text: null, modifiedAt: info.mtime }
			: { state: 'unreadable', text: null, modifiedAt: null };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return { state: 'absent', text: null, modifiedAt: null };
		return { state: 'unreadable', text: null, modifiedAt: null };
	}
}

function fileText(file: FileRead): string | null {
	return file.state === 'present' ? file.text : null;
}

function fileHistory(file: FileRead): string[] {
	if (file.state === 'unreadable') return ['The file could not be read; no history is available.'];
	if (!file.modifiedAt) return [NO_HISTORY];
	const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(file.modifiedAt);
	return [`File last changed ${date}. Who changed it is not recorded.`];
}

function countLines(text: string | null): number {
	if (!text?.trim()) return 0;
	return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

function countBullets(text: string | null): number {
	if (!text?.trim()) return 0;
	return text.split(/\r?\n/).filter((line) => /^\s*(?:[-*+] |\d+[.)] )/.test(line)).length;
}

function safeNames(text: string | null): string[] {
	if (!text) return [];
	return text
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+#.*$/, '').trim())
		.filter((line) => line && !line.startsWith('#'))
		.map((line) => line.split(/\s+/)[0])
		.filter((name) => IDENTIFIER.test(name));
}

/** A short, presentation-only label derived from a dispatch rule’s `when` text. */
export function dispatchRuleLabel(when: string): string {
	const clean = when
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const firstThought = clean.split(/[:.!?]/, 1)[0]?.trim() || clean;
	if (firstThought.length <= 64) return firstThought || 'Unnamed work type';
	const words = firstThought.split(' ');
	let label = '';
	for (const word of words) {
		const next = label ? `${label} ${word}` : word;
		if (next.length > 61) break;
		label = next;
	}
	return `${label || firstThought.slice(0, 61).trimEnd()}…`;
}

function parseProfile(value: unknown): DispatchProfile | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	const harness =
		typeof item.harness === 'string' && IDENTIFIER.test(item.harness) ? item.harness : null;
	if (!harness) return null;
	const model = typeof item.model === 'string' && IDENTIFIER.test(item.model) ? item.model : null;
	const effort =
		typeof item.effort === 'string' && IDENTIFIER.test(item.effort) ? item.effort : null;
	const rawFloor = item.floor;
	const floor =
		typeof rawFloor === 'number' && Number.isFinite(rawFloor) && rawFloor >= 0 && rawFloor <= 100
			? rawFloor
			: null;
	return { harness, model, effort, floor };
}

function profileList(value: unknown): DispatchProfile[] {
	return Array.isArray(value)
		? value.map(parseProfile).filter((profile): profile is DispatchProfile => profile !== null)
		: [];
}

function parseDispatch(text: string | null): DispatchConfig | null {
	if (!text) return null;
	try {
		const raw: unknown = JSON.parse(text);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
		const value = raw as Record<string, unknown>;
		const rules = Array.isArray(value.rules)
			? value.rules.flatMap((entry): DispatchRule[] => {
					if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
					const rule = entry as Record<string, unknown>;
					if (typeof rule.when !== 'string' || !rule.when.trim()) return [];
					return [{ when: rule.when.slice(0, 2000), use: profileList(rule.use) }];
				})
			: [];
		const rawPreferred = value.preferred_provider;
		return {
			rules,
			fallback: profileList(value.fallback ?? value.default),
			preferredProvider:
				typeof rawPreferred === 'string' && IDENTIFIER.test(rawPreferred) ? rawPreferred : null
		};
	} catch {
		return null;
	}
}

function humanHarness(harness: string): string {
	const known: Record<string, string> = {
		claude: 'Claude Code',
		pi: 'Pi',
		codex: 'Codex',
		grok: 'Grok CLI',
		opencode: 'OpenCode',
		gemini: 'Gemini CLI',
		kimi: 'Kimi'
	};
	return known[harness.toLowerCase()] ?? harness;
}

function humanModel(model: string): string {
	return model
		.split('/')
		.map((part) => part.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()))
		.join(' · ');
}

function profileDescription(profile: DispatchProfile): string {
	const model = profile.model ? ` · ${humanModel(profile.model)}` : '';
	const effort = profile.effort ? ` · ${profile.effort} effort` : '';
	const floor = profile.floor !== null ? ` · reserve ${profile.floor}% of allowance` : '';
	return `${humanHarness(profile.harness)}${model}${effort}${floor}`;
}

function parseCapacity(text: string | null): Map<string, number> {
	const out = new Map<string, number>();
	for (const line of text?.split(/\r?\n/) ?? []) {
		const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]{0,127})\s+([1-9]\d{0,3})\s*(?:#.*)?$/.exec(line);
		if (match) out.set(match[1], Number(match[2]));
	}
	return out;
}

function postureOf(posture: string | null): { mode: string; short: string; autoMerge: boolean } {
	const bits = (posture ?? '').split(/\s+/).filter(Boolean);
	const mode = bits.find((bit) =>
		['no-mistakes-prod-only', 'no-mistakes', 'direct-PR', 'local-only'].includes(bit)
	);
	const modes: Record<string, { mode: string; short: string }> = {
		'no-mistakes-prod-only': {
			mode: 'Product work gets full checks',
			short: 'Checked for product work'
		},
		'no-mistakes': { mode: 'Always fully checked', short: 'Always fully checked' },
		'direct-PR': { mode: 'Straight to a pull request', short: 'Straight to a pull request' },
		'local-only': { mode: 'Stays on this machine', short: 'Stays on this machine' }
	};
	const result = mode
		? modes[mode]
		: { mode: 'Firstmate’s documented default', short: 'Firstmate default' };
	return { ...result, autoMerge: bits.includes('+yolo') };
}

function parseMates(text: string | null): MateRoute[] {
	if (!text) return [];
	const mates: MateRoute[] = [];
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*-\s+([A-Za-z0-9][A-Za-z0-9._-]{0,127})\s+-\s+/.exec(line);
		if (!match) continue;
		const meta = line.slice(match[0].length);
		const host = /\(host:\s*([^;)]+)[;)]/.exec(meta)?.[1]?.trim() ?? null;
		const projectsText = /(?:\(|;)\s*projects:\s*([^;)]*)/.exec(meta)?.[1] ?? '';
		const projects = projectsText
			.split(',')
			.map((name) => name.trim())
			.filter((name) => PROJECT_ID.test(name));
		mates.push({ id: match[1], host, projects });
	}
	return mates;
}

function readOnlyLine(
	id: string,
	topic: SettingsTopicId,
	label: string,
	meaning: string,
	value: string,
	sub: string | null,
	tag: SettingTag | null,
	share: FirstmateSetting['share'],
	shareText: string,
	affects: string,
	file: string,
	reader: string,
	documentation: string,
	history: string[],
	details: SettingDetail[] = [],
	effect?: string
): FirstmateSetting {
	return {
		id,
		topic,
		label,
		meaning,
		value,
		sub,
		tag,
		share,
		shareText,
		affects,
		history,
		details,
		technical: { file, reader, documentation: `${DOC} · ${documentation}`, effect }
	};
}

async function startupBudgetReport(install: FirstmateInstall): Promise<string | null> {
	const script = path.join(install.firstmateDir, 'bin', 'fm-startup-memory-budget.sh');
	try {
		await access(script);
	} catch {
		return null;
	}
	const result = await runBounded(script, ['report'], {
		cwd: install.homeDir,
		env: {
			PATH: process.env.PATH || '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
			FM_HOME: install.homeDir
		},
		timeoutMs: 3000,
		maxOutputBytes: 16 * 1024
	});
	return result.ok ? result.stdout : null;
}

function parseBudgetReport(
	text: string | null
): { used: number; budget: number; overBudget: boolean } | null {
	if (!text) return null;
	const total = /^total_estimated_tokens=(\d+)$/m.exec(text);
	const budget = /^effective_budget_tokens=(\d+)$/m.exec(text);
	const status = /^budget_status=(within-budget|over-budget)$/m.exec(text);
	if (!total || !budget || !status) return null;
	return {
		used: Number(total[1]),
		budget: Number(budget[1]),
		overBudget: status[1] === 'over-budget'
	};
}

function parseBudgetFile(file: FileRead): number | null {
	if (file.state === 'absent') return DEFAULT_STARTUP_BUDGET;
	if (file.state !== 'present' || !file.text) return null;
	const match = /^\s*(\d+)\s*$/.exec(file.text);
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseEnvNames(file: FileRead): { names: string[]; configured: boolean } {
	if (file.state === 'absent') return { names: [], configured: false };
	if (file.state === 'unreadable' || !file.text) return { names: [], configured: true };
	const names = file.text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith('#'));
	if (names.every((name) => ENV_NAME.test(name))) return { names, configured: true };
	// Do not echo malformed content: an unexpected format might contain values.
	return { names: [], configured: true };
}

function routeRemote(host: string | null): boolean {
	return Boolean(host);
}

export async function readFirstmateSettings(
	install: FirstmateInstall,
	options: { budgetReport?: () => Promise<string | null> } = {}
): Promise<FirstmateSettingsView> {
	const home = install.homeDir;
	const names = [
		'config/brief-include.md',
		'config/crew-exclude-tools',
		'config/wait-no-turns',
		'config/crew-dispatch.json',
		'config/crew-harness',
		'config/secondmate-harness',
		'config/backend',
		'config/lane-capacity',
		'config/fleet-ledger',
		'config/project-capacity',
		'config/startup-memory-budget',
		'config/claude-permission-mode',
		'config/launch-env-allowlist',
		'config/firstmate-role',
		'data/projects.md',
		'data/secondmates.md',
		'data/captain.md',
		'data/captain-shared.md'
	] as const;
	const [files, accountFiles, report] = await Promise.all([
		Promise.all(names.map((name) => readFileInfo(home, name))),
		Promise.all(
			['config/claude-account', 'config/pi-account', 'config/claude-accounts'].map((name) =>
				filePresence(home, name)
			)
		),
		(options.budgetReport ?? (() => startupBudgetReport(install)))()
	]);
	const file = Object.fromEntries(names.map((name, index) => [name, files[index]])) as Record<
		(typeof names)[number],
		FileRead
	>;
	const dispatchFile = file['config/crew-dispatch.json'];
	const dispatch = parseDispatch(fileText(dispatchFile));
	const projectsFile = file['data/projects.md'];
	const projectEntries = parseProjectsRegistry(fileText(projectsFile) ?? '');
	const capacityRead = file['config/project-capacity'];
	const capacity = parseCapacity(fileText(capacityRead));
	const matesFile = file['data/secondmates.md'];
	const mates = parseMates(fileText(matesFile));
	const preferenceFile = file['data/captain.md'];
	const sharedPreferencesFile = file['data/captain-shared.md'];
	const budgetFile = file['config/startup-memory-budget'];
	const budgetFromReport = parseBudgetReport(report);
	const configuredBudget = parseBudgetFile(budgetFile);
	const budget = budgetFromReport?.budget ?? configuredBudget ?? DEFAULT_STARTUP_BUDGET;
	const used = budgetFromReport?.used ?? null;
	const startupBudget = {
		budget,
		used,
		overBy: used !== null && budgetFromReport?.overBudget ? Math.max(0, used - budget) : null
	};
	const permissionFile = file['config/claude-permission-mode'];
	const permissionText = fileText(permissionFile)?.trim().toLowerCase();
	const permissions =
		permissionFile.state === 'absent'
			? 'Workers do not ask'
			: permissionFile.state === 'unreadable'
				? 'Could not read this setting'
				: permissionText === 'auto'
					? 'Workers ask before acting'
					: permissionText === 'bypass'
						? 'Workers do not ask'
						: 'Configured; value not recognized';
	const envAllowlist = parseEnvNames(file['config/launch-env-allowlist']);
	const roleFile = file['config/firstmate-role'];
	const roleText = fileText(roleFile)?.trim().split(/\s+/, 1)[0]?.toLowerCase();
	const roleValue =
		roleFile.state === 'absent'
			? 'User role (documented default)'
			: roleFile.state === 'unreadable'
				? 'Could not read this setting'
				: roleText === 'maintainer'
					? 'Maintainer role'
					: roleText === 'user'
						? 'User role'
						: 'Configured; value not recognized';
	const accountPinned = accountFiles.some((account) => account.state === 'present');
	const accountUnreadable = accountFiles.some((account) => account.state === 'unreadable');
	const accountValue = accountUnreadable
		? 'Could not check whether an account is pinned'
		: accountPinned
			? 'An account pin is set'
			: 'No account pin is set';
	const dispatchRows =
		dispatch?.rules.map((rule, index) => ({
			label: dispatchRuleLabel(rule.when) || `Rule ${index + 1}`,
			value: rule.use.length
				? rule.use.map(profileDescription).join(' → ')
				: 'No valid agent choices were found'
		})) ?? [];
	if (dispatch?.fallback.length)
		dispatchRows.push({
			label: 'When no rule fits',
			value: dispatch.fallback.map(profileDescription).join(' → ')
		});
	if (dispatch?.preferredProvider)
		dispatchRows.push({ label: 'Spend first', value: dispatch.preferredProvider });
	const dispatchCount = dispatch?.rules.length ?? 0;
	const budgetHistory = fileHistory(budgetFile);
	const prefCount = countBullets(fileText(preferenceFile));
	const sharedPrefCount = countBullets(fileText(sharedPreferencesFile));
	const preferenceValue =
		preferenceFile.state === 'unreadable'
			? 'Could not read these preferences'
			: `${prefCount} preference${prefCount === 1 ? '' : 's'} recorded`;
	const envValue =
		file['config/launch-env-allowlist'].state === 'unreadable'
			? 'Could not read this setting'
			: envAllowlist.configured
				? envAllowlist.names.length
					? `${envAllowlist.names.length} name${envAllowlist.names.length === 1 ? '' : 's'}: ${envAllowlist.names.join(', ')}`
					: 'Configured; names unavailable'
				: 'No allowlist file; Firstmate uses its documented default';
	const briefFile = file['config/brief-include.md'];
	const briefCount = countLines(fileText(briefFile));
	const toolsFile = file['config/crew-exclude-tools'];
	const tools = safeNames(fileText(toolsFile));
	const toolsValue =
		toolsFile.state === 'unreadable'
			? 'Could not read this setting'
			: toolsFile.state === 'absent'
				? 'No tools hidden'
				: tools.length
					? `${tools.length} tool${tools.length === 1 ? '' : 's'} hidden`
					: 'Configured; tool names unavailable';
	const harnessFile = file['config/crew-harness'];
	const crewHarnessText = fileText(harnessFile)?.trim().split(/\s+/, 1)[0] ?? '';
	const crewHarness =
		harnessFile.state === 'absent'
			? 'Firstmate’s configured default agent'
			: harnessFile.state === 'unreadable'
				? 'Could not read this setting'
				: IDENTIFIER.test(crewHarnessText)
					? humanHarness(crewHarnessText)
					: 'Configured; value not recognized';
	const secondHarnessFile = file['config/secondmate-harness'];
	const secondHarnessLines =
		fileText(secondHarnessFile)
			?.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#')) ?? [];
	const secondHarnessDefault = secondHarnessLines
		.find((line) => !/^mate\s+/i.test(line))
		?.split(/\s+/, 1)[0];
	const secondHarnessOverrides = secondHarnessLines.flatMap((line) => {
		const match =
			/^mate\s+([A-Za-z0-9][A-Za-z0-9._-]{0,127}):\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,159})/i.exec(
				line
			);
		return match && IDENTIFIER.test(match[2]) ? [{ id: match[1], harness: match[2] }] : [];
	});
	const secondHarnessValue =
		secondHarnessFile.state === 'absent'
			? 'Follows this home’s worker agent by default'
			: secondHarnessFile.state === 'unreadable'
				? 'Could not read this setting'
				: secondHarnessDefault && IDENTIFIER.test(secondHarnessDefault)
					? `${humanHarness(secondHarnessDefault)}${secondHarnessOverrides.length ? ` · ${secondHarnessOverrides.length} mate-specific override${secondHarnessOverrides.length === 1 ? '' : 's'}` : ''}`
					: secondHarnessOverrides.length
						? `${secondHarnessOverrides.length} mate-specific override${secondHarnessOverrides.length === 1 ? '' : 's'}; no default agent`
						: 'Configured; value not recognized';
	const secondHarnessDetails = secondHarnessOverrides.length
		? [
				{
					title: 'Mate-specific choices',
					rows: secondHarnessOverrides.map((override) => ({
						label: override.id,
						value: humanHarness(override.harness)
					}))
				}
			]
		: [];
	const backendFile = file['config/backend'];
	const backendText = fileText(backendFile)?.trim().split(/\s+/, 1)[0] ?? '';
	const backendValue =
		backendFile.state === 'absent'
			? 'tmux windows (documented default)'
			: backendFile.state === 'unreadable'
				? 'Could not read this setting'
				: IDENTIFIER.test(backendText)
					? `${backendText} windows`
					: 'Configured; value not recognized';
	const laneFile = file['config/lane-capacity'];
	const laneText = fileText(laneFile)?.trim().replace(/\s+/g, ' ') ?? '';
	const laneValue =
		laneFile.state === 'absent'
			? 'No limit (documented default)'
			: laneFile.state === 'unreadable'
				? 'Could not read this setting'
				: /^[A-Za-z0-9 .:%=,_-]{1,160}$/.test(laneText)
					? laneText
					: 'Configured; value not recognized';
	const ledgerFile = file['config/fleet-ledger'];
	const waitFile = file['config/wait-no-turns'];
	const ledgerValue =
		ledgerFile.state === 'unreadable'
			? 'Could not read this setting'
			: ledgerFile.state === 'present'
				? 'On'
				: 'Off (documented default)';
	const waitValue =
		waitFile.state === 'unreadable'
			? 'Could not read this setting'
			: waitFile.state === 'present'
				? 'On'
				: 'Off (documented default)';
	const projectHistory = [...new Set([...fileHistory(projectsFile), ...fileHistory(capacityRead)])];
	const projectRows: FirstmateProject[] = projectEntries.map((entry) => {
		const posture = postureOf(entry.posture);
		return {
			name: entry.name,
			mode: posture.mode,
			modeShort: posture.short,
			autoMerge: posture.autoMerge,
			capacity: capacity.get(entry.name) ?? null,
			meaning:
				'How this project’s changes are checked, whether Firstmate may merge them, and how many workers can run at once.',
			shareText:
				'Each home has its own project registry. A local worker limit may also be used by second mates on this machine; remote effective values are not read.',
			history: projectHistory,
			technical: {
				file: 'data/projects.md and config/project-capacity',
				reader: 'parseProjectsRegistry in Wheelhouse; Firstmate project-mode and capacity readers',
				documentation: `${DOC} · Project registry and Project capacity`
			}
		};
	});
	const dispatchValue =
		dispatchFile.state === 'unreadable'
			? 'Could not read dispatch rules'
			: dispatch
				? `${dispatch.rules.length} rule${dispatch.rules.length === 1 ? '' : 's'}${dispatch.fallback.length ? ', plus a fallback' : ''}`
				: dispatchFile.state === 'absent'
					? 'No dispatch rules (documented default)'
					: 'Dispatch file could not be parsed';
	const startupUsed = used === null ? 'Usage unavailable' : `${used.toLocaleString()} tokens used`;
	const startupValue =
		!budgetFromReport && configuredBudget === null
			? 'Could not read this setting'
			: `${budget.toLocaleString()} tokens`;
	const settings: FirstmateSetting[] = [
		readOnlyLine(
			'brief',
			'workers',
			'Standing worker instructions',
			'Extra instructions added to each new worker brief',
			briefFile.state === 'unreadable'
				? 'Could not read these instructions'
				: briefCount
					? `${briefCount} non-empty lines`
					: 'None',
			briefCount ? 'Text is kept private here; it is not shown in this settings page.' : null,
			'Editable',
			'home',
			LOCAL,
			'What Firstmate appends to the next worker or scout brief. Running workers keep the brief they started with.',
			'config/brief-include.md',
			'bin/fm-brief.sh',
			'Home brief include',
			fileHistory(briefFile),
			[],
			'Firstmate appends this text after its other brief sections; it does not reach second-mate workers.'
		),
		readOnlyLine(
			'tools',
			'workers',
			'Tools hidden from workers',
			'Tools new workers are not allowed to use',
			toolsValue,
			null,
			'Ask Firstmate',
			'home',
			LOCAL,
			'Every new worker or relaunch. A runtime that cannot hide a listed tool refuses to launch.',
			'config/crew-exclude-tools',
			'bin/fm-spawn.sh',
			'Worker tool exclusions',
			fileHistory(toolsFile),
			tools.length
				? [{ title: 'Hidden tools', rows: tools.map((name) => ({ label: 'Tool', value: name })) }]
				: []
		),
		readOnlyLine(
			'wait',
			'workers',
			'Waiting workers stay quiet',
			'Whether a worker waiting for an answer spends turns checking for updates',
			waitValue,
			null,
			'Ask Firstmate',
			'home',
			LOCAL,
			'Briefs written with this setting on tell waiting workers not to check their inbox until answered.',
			'config/wait-no-turns',
			'bin/fm-brief.sh',
			'Waiting worker spends no turns',
			fileHistory(waitFile)
		),
		readOnlyLine(
			'dispatch',
			'agents',
			'Which agent does which work',
			'Rules for choosing an agent, model and effort for each kind of task',
			dispatchValue,
			dispatch ? 'Rule labels are derived from their “when” descriptions.' : null,
			'Editable',
			'shared',
			SHARE,
			'Workers and scouts dispatched after the change. While rules exist, Firstmate names an agent for each spawn.',
			'config/crew-dispatch.json',
			'Firstmate dispatch at task intake; bootstrap validates the file',
			'Crew dispatch profiles',
			fileHistory(dispatchFile),
			dispatchRows.length ? [{ title: 'Dispatch choices', rows: dispatchRows }] : [],
			'Choices are listed in their configured order. No remote second mate’s effective dispatch values are read.'
		),
		readOnlyLine(
			'crew-harness',
			'agents',
			'Agent when no rule applies',
			'The worker agent used when no dispatch rule selects one',
			crewHarness,
			null,
			'Read only',
			'shared',
			SHARE,
			'No effect while dispatch rules exist; otherwise it supplies the worker agent.',
			'config/crew-harness',
			'bin/fm-harness.sh',
			'Choose the worker harness',
			fileHistory(harnessFile)
		),
		readOnlyLine(
			'secondmate-harness',
			'agents',
			'Agent for second mates',
			'The agent this home selects for its second mates',
			secondHarnessValue,
			null,
			'Ask Firstmate',
			'home',
			LOCAL,
			'Used when this home next starts or relaunches a second mate. This page does not read the mate’s effective configuration.',
			'config/secondmate-harness',
			'bin/fm-harness.sh',
			'Choose the secondmate harness',
			fileHistory(secondHarnessFile),
			secondHarnessDetails
		),
		readOnlyLine(
			'backend',
			'runtime',
			'Where workers run',
			'The terminal system Firstmate opens worker windows in',
			backendValue,
			null,
			'Ask Firstmate',
			'shared',
			SHARE,
			'New workers only. Running workers stay where they are.',
			'config/backend',
			'bin/fm-backend.sh and bin/fm-spawn.sh',
			'Runtime backend',
			fileHistory(backendFile)
		),
		readOnlyLine(
			'lane-capacity',
			'runtime',
			'How much runs at once',
			'A home-wide limit on workers running together',
			laneValue,
			null,
			'Ask Firstmate',
			'home',
			LOCAL,
			'Whether queued work starts now or waits for room.',
			'config/lane-capacity',
			'bin/fm-capacity.sh',
			'Lane capacity',
			fileHistory(laneFile)
		),
		readOnlyLine(
			'ledger',
			'runtime',
			'Activity record',
			'Whether Firstmate keeps a running record of worker activity',
			ledgerValue,
			null,
			'Read only',
			'home',
			LOCAL,
			'What Wheelhouse can show in Logbook and task history.',
			'config/fleet-ledger (present means on)',
			'bin/fm-fleet-ledger.sh',
			'Fleet ledger',
			fileHistory(ledgerFile)
		),
		readOnlyLine(
			'preferences',
			'preferences',
			'Your recorded preferences',
			'Standing preferences Firstmate has written down from what you told it',
			preferenceValue,
			preferenceFile.modifiedAt ? 'Preference text is not shown here.' : null,
			'Ask Firstmate',
			'home',
			LOCAL,
			'How Firstmate behaves from its next start. The page shows a count and never exposes preference text.',
			'data/captain.md',
			'stow skill',
			'Captain preferences',
			fileHistory(preferenceFile)
		),
		readOnlyLine(
			'shared-preferences',
			'preferences',
			'Shared preferences',
			'Preferences this home says should apply to second mates too',
			sharedPreferencesFile.state === 'unreadable'
				? 'Could not read these preferences'
				: `${sharedPrefCount} shared preference${sharedPrefCount === 1 ? '' : 's'}`,
			null,
			'Ask Firstmate',
			'shared',
			SHARE,
			'How second mates should behave from their next start. Preference text is not shown here.',
			'data/captain-shared.md',
			'stow skill and second-mate setup',
			'Captain preferences',
			fileHistory(sharedPreferencesFile)
		),
		readOnlyLine(
			'startup-budget',
			'preferences',
			'Startup memory budget',
			'How much startup notes Firstmate may read each time it starts',
			startupValue,
			startupUsed,
			'Editable',
			'shared',
			SHARE,
			'How much Firstmate reads from preferences and notes at each start. Over-budget notes are trimmed at a later tidy-up.',
			'config/startup-memory-budget',
			'bin/fm-startup-memory-budget.sh report',
			'Startup memory budget',
			budgetHistory,
			used === null
				? []
				: [
						{
							title: 'Last report',
							rows: [
								{ label: 'Estimated use', value: `${used.toLocaleString()} tokens` },
								{ label: 'Budget', value: `${budget.toLocaleString()} tokens` }
							]
						}
					],
			'Firstmate’s report command owns the estimate and over-budget verdict; Wheelhouse only displays its numeric summary.'
		),
		readOnlyLine(
			'secondmates',
			'mates',
			'Second mates',
			'Routes this home has recorded for other Firstmate homes',
			matesFile.state === 'unreadable'
				? 'Could not read second-mate routes'
				: `${mates.length} route${mates.length === 1 ? '' : 's'} configured`,
			'Only this home’s route file is read; remote effective values are not fetched.',
			'Read only',
			'not-applicable',
			'Only this home’s routes are shown; remote effective values are not fetched.',
			'Routes and project names come from this home’s registry. Wheelhouse does not query remote homes for their effective settings.',
			'data/secondmates.md and inherited config files',
			'Firstmate route and configuration readers',
			'Secondmate routes and inherited configuration',
			fileHistory(matesFile),
			[
				...(mates.length
					? [
							{
								title: 'Routes in this home',
								rows: mates.map((mate) => ({
									label: mate.id,
									value: `${routeRemote(mate.host) ? 'Remote' : 'Local'} · ${mate.projects.length} project${mate.projects.length === 1 ? '' : 's'}`
								}))
							}
						]
					: []),
				{
					title: 'Shared by this home',
					rows: [
						{
							label: 'Shared configuration',
							value: 'See the settings marked “Shared with second mates” on this page.'
						},
						{ label: 'Remote values', value: 'Not fetched in this read-only view.' }
					]
				}
			],
			'Only route IDs, locality and project counts are shown here; host names and home paths stay out of the page.'
		),
		readOnlyLine(
			'permission-mode',
			'safety',
			'Worker permission prompts',
			'Whether Claude Code workers ask before acting',
			permissions,
			null,
			'Security',
			'shared',
			SHARE,
			'What Claude Code workers may do without asking. This page never changes the permission mode.',
			'config/claude-permission-mode (absent means bypass)',
			'bin/fm-spawn.sh',
			'Claude permission mode',
			fileHistory(permissionFile)
		),
		readOnlyLine(
			'accounts',
			'safety',
			'Worker sign-ins',
			'Whether any worker sign-in is pinned for this home',
			accountValue,
			'Account names and pin values are never read or shown.',
			'Captain only',
			'home',
			LOCAL,
			'Whose allowance and account a new worker uses. Only file presence is checked; account contents are never read.',
			'config/claude-account, config/pi-account, config/claude-accounts',
			'bin/fm-spawn.sh',
			'Worker account pins',
			accountFiles.some((account) => account.modifiedAt)
				? ['A pin file exists; who changed it is not recorded.']
				: [NO_HISTORY]
		),
		readOnlyLine(
			'launch-env',
			'safety',
			'What workers receive from your shell',
			'Environment names allowed into a new worker, never their values',
			envValue,
			envAllowlist.names.length ? envAllowlist.names.join(', ') : null,
			'Security',
			'shared',
			SHARE,
			'New workers, scouts and second mates. Running workers keep what they started with.',
			'config/launch-env-allowlist',
			'bin/fm-spawn.sh',
			'Worker launch environment',
			fileHistory(file['config/launch-env-allowlist'])
		),
		readOnlyLine(
			'role',
			'safety',
			'Changes to Firstmate itself',
			'Whether this home may publish changes to the Firstmate project',
			roleValue,
			null,
			'Captain only',
			'shared',
			SHARE,
			'Whether a task on the Firstmate repository may publish a change upstream.',
			'config/firstmate-role',
			'bin/fm-role.sh report',
			'Firstmate role',
			fileHistory(roleFile)
		),
		readOnlyLine(
			'secrets',
			'safety',
			'Secrets',
			'Keys and tokens a task may be granted',
			'Kept in Wheelhouse Vault',
			'Secret names and values are not read by this page.',
			'Captain only',
			'not-applicable',
			'Secret grants are per task. This home only; never read from this page.',
			'Vault grants are managed per task. This page never reads the Vault.',
			'Wheelhouse Vault',
			'Wheelhouse Vault',
			'Secrets and task grants',
			[NO_HISTORY]
		)
	];

	return {
		available: true,
		reason: null,
		readAt: new Date().toISOString(),
		projectCount: projectRows.length,
		mateCount: mates.length,
		dispatchRuleCount: dispatchCount,
		settings,
		projects: projectRows,
		mates: mates.map((mate) => ({
			id: mate.id,
			remote: routeRemote(mate.host),
			projects: mate.projects
		})),
		startupBudget
	};
}

export function unavailableFirstmateSettings(reason: string): FirstmateSettingsView {
	return {
		available: false,
		reason,
		readAt: new Date().toISOString(),
		projectCount: 0,
		mateCount: 0,
		dispatchRuleCount: 0,
		settings: [],
		projects: [],
		mates: [],
		startupBudget: null
	};
}
