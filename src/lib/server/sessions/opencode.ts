import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Picker, ScreenMenu, TranscriptSource } from '../../types';
import type { PickerAction } from './picker';
import { MAX_RECORDS, MAX_RESULT_CHARS, type TranscriptRecord } from './transcript';

export interface OpenCodeConnection {
	url: string;
	sessionId: string;
	username: string;
	password: string;
	directory: string;
}

export class OpenCodeError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 409 | 503 = 503
	) {
		super(message);
	}
}

const REQUEST_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 5000;
const SESSION_ID = /^ses_[A-Za-z0-9_-]{1,120}$/;
const REQUEST_ID = /^(?:per|que)_[A-Za-z0-9_-]{1,120}$/;

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new OpenCodeError('OpenCode returned an invalid object.');
	return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new OpenCodeError('OpenCode returned an invalid list.');
	return value;
}

function text(value: unknown): string {
	if (typeof value !== 'string') throw new OpenCodeError('OpenCode returned invalid text.');
	return value;
}

/** Parse the private launch record before using its endpoint or credentials. */
export function parseOpenCodeConnection(raw: unknown): OpenCodeConnection {
	const value = object(raw);
	const url = text(value.url);
	let endpoint: URL;
	try {
		endpoint = new URL(url);
	} catch {
		throw new OpenCodeError('The OpenCode endpoint must be a loopback HTTP URL.');
	}
	if (
		endpoint.protocol !== 'http:' ||
		!['127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
		!endpoint.port ||
		(url !== endpoint.origin && url !== `${endpoint.origin}/`)
	)
		throw new OpenCodeError(
			'The OpenCode endpoint must use 127.0.0.1 or [::1] and an explicit HTTP port.'
		);
	const sessionId = text(value.sessionId);
	if (!SESSION_ID.test(sessionId)) throw new OpenCodeError('The OpenCode session ID is invalid.');
	const directory = text(value.directory);
	if (!path.isAbsolute(directory) || directory.includes('\0'))
		throw new OpenCodeError('The OpenCode directory must be absolute.');
	const username = text(value.username);
	const password = text(value.password);
	if (
		!username ||
		username.length > 128 ||
		/[:\r\n\0]/.test(username) ||
		!password ||
		password.length > 512 ||
		/[\r\n\0]/.test(password)
	)
		throw new OpenCodeError('The OpenCode connection needs valid private credentials.');
	return {
		url: endpoint.origin,
		sessionId,
		username,
		password,
		directory: path.resolve(directory)
	};
}

async function request(
	connection: OpenCodeConnection,
	route: string,
	body?: unknown,
	signal?: AbortSignal,
	allowMissing = false
): Promise<unknown> {
	const conn = parseOpenCodeConnection(connection);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(`${conn.url}${route}`, {
			method: body === undefined ? 'GET' : 'POST',
			redirect: 'error',
			signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
			headers: {
				authorization: `Basic ${Buffer.from(`${conn.username}:${conn.password}`).toString('base64')}`,
				...(body === undefined ? {} : { 'content-type': 'application/json' })
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (response.status === 404 && allowMissing) {
			await response.body?.cancel();
			return null;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new OpenCodeError(
				`OpenCode returned HTTP ${response.status}.`,
				response.status === 404 ? 409 : 503
			);
		}
		if (response.status === 204) return null;
		const reader = response.body?.getReader();
		if (!reader) throw new OpenCodeError('OpenCode returned an empty response.');
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			bytes += part.value.length;
			if (bytes > REQUEST_BYTES) {
				await reader.cancel();
				throw new OpenCodeError('The OpenCode response exceeded the size limit.');
			}
			chunks.push(part.value);
		}
		return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
	} catch (error) {
		if (error instanceof OpenCodeError) throw error;
		throw new OpenCodeError(
			'Could not read OpenCode. Check that its private session server is running.'
		);
	} finally {
		clearTimeout(timeout);
	}
}

function sessionRoute(conn: OpenCodeConnection): string {
	return `/api/session/${encodeURIComponent(conn.sessionId)}`;
}

function verifySession(raw: unknown, conn: OpenCodeConnection): void {
	const session = object(object(raw).data);
	const location = object(session.location);
	if (
		session.id !== conn.sessionId ||
		typeof location.directory !== 'string' ||
		!path.isAbsolute(location.directory) ||
		path.resolve(location.directory) !== path.resolve(conn.directory)
	)
		throw new OpenCodeError('The OpenCode session does not match this Firstmate checkout.');
}

async function boundSession(conn: OpenCodeConnection, signal?: AbortSignal): Promise<void> {
	verifySession(await request(conn, sessionRoute(conn), undefined, signal), conn);
}

/** Create only the preallocated session, reusing it when startup is retried. */
export async function createOpenCodeSession(connection: OpenCodeConnection): Promise<void> {
	const conn = parseOpenCodeConnection(connection);
	const existing = await request(conn, sessionRoute(conn), undefined, undefined, true);
	if (existing) {
		verifySession(existing, conn);
		return;
	}
	try {
		verifySession(
			await request(conn, '/api/session', {
				id: conn.sessionId,
				location: { directory: conn.directory }
			}),
			conn
		);
	} catch (error) {
		// Another startup may have created the same preallocated ID while this request was in flight.
		const created = await request(conn, sessionRoute(conn), undefined, undefined, true);
		if (!created) throw error;
		verifySession(created, conn);
	}
}

/** Call after the native TUI is ready to select its exact bound session. */
export async function selectOpenCodeSession(conn: OpenCodeConnection): Promise<void> {
	await boundSession(conn);
	const selected = await request(
		conn,
		`/tui/select-session?directory=${encodeURIComponent(conn.directory)}`,
		{ sessionID: conn.sessionId }
	);
	if (selected !== true) throw new OpenCodeError('OpenCode did not select the bound session.');
}

function timestamp(value: unknown): string {
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		!Number.isFinite(new Date(value).getTime())
	)
		throw new OpenCodeError('OpenCode returned an invalid message timestamp.');
	return new Date(value).toISOString();
}

function cut(value: string): string {
	return value.length > MAX_RESULT_CHARS
		? `${value.slice(0, MAX_RESULT_CHARS)}\n… (more in the terminal)`
		: value;
}

function toolContent(value: unknown): string {
	if (!Array.isArray(value)) return '';
	return cut(
		value
			.flatMap((raw) => {
				const part = object(raw);
				return part.type === 'text' && typeof part.text === 'string' ? [part.text] : [];
			})
			.join('\n')
	);
}

function messageRecords(raw: unknown): TranscriptRecord[] {
	const message = object(raw);
	const id = text(message.id);
	const time = object(message.time);
	const at = timestamp(time.created);
	const base = { uuid: `opencode:${id}`, timestamp: at };
	if (message.type === 'user' || message.type === 'synthetic') {
		return [
			{
				...base,
				type: 'user',
				isMeta: message.type === 'synthetic',
				message: { role: 'user', content: text(message.text) }
			}
		];
	}
	if (message.type === 'compaction')
		return [
			{ ...base, type: 'system', subtype: 'away_summary', content: cut(text(message.summary)) }
		];
	if (message.type !== 'assistant') return [];
	const records: TranscriptRecord[] = [];
	const assistant = (suffix: string, content: unknown[]): TranscriptRecord => ({
		type: 'assistant',
		uuid: `${base.uuid}:${suffix}`,
		timestamp: at,
		message: { id: base.uuid, role: 'assistant', content }
	});
	for (const rawPart of list(message.content)) {
		const part = object(rawPart);
		const partId = text(part.id);
		if (part.type === 'text')
			records.push(assistant(partId, [{ type: 'text', text: text(part.text) }]));
		else if (part.type === 'reasoning')
			records.push(assistant(partId, [{ type: 'thinking', thinking: cut(text(part.text)) }]));
		else if (part.type === 'tool') {
			const state = object(part.state);
			const name = text(part.name);
			const names: Record<string, string> = {
				bash: 'Bash',
				shell: 'Bash',
				read: 'Read',
				write: 'Write',
				edit: 'Edit',
				glob: 'Glob',
				grep: 'Grep'
			};
			const toolId = `opencode:${partId}`;
			const input =
				typeof state.input === 'string' ? { input: cut(state.input) } : object(state.input);
			records.push(
				assistant(`${partId}:call`, [
					{ type: 'tool_use', id: toolId, name: names[name] ?? name, input }
				])
			);
			if (state.status === 'completed' || state.status === 'error') {
				const error = state.error ? object(state.error) : null;
				const result =
					toolContent(state.content) ||
					(typeof error?.message === 'string' ? cut(error.message) : '');
				records.push({
					type: 'user',
					uuid: `${base.uuid}:${partId}:result`,
					timestamp: at,
					message: {
						role: 'user',
						content: [
							{
								type: 'tool_result',
								tool_use_id: toolId,
								content: result,
								is_error: state.status === 'error'
							}
						]
					}
				});
			}
		}
	}
	if (message.error) {
		const error = object(message.error);
		records.push(assistant('error', [{ type: 'text', text: cut(text(error.message)) }]));
	}
	if (time.completed !== undefined && (message.error || message.finish !== 'tool-calls')) {
		const completed = timestamp(time.completed);
		records.push({
			type: 'system',
			uuid: `${base.uuid}:completed`,
			timestamp: completed,
			subtype: 'turn_duration',
			durationMs: Math.max(0, Date.parse(completed) - Date.parse(at))
		});
	}
	return records;
}

interface Admission {
	id: string;
	time: { created: number };
	text: string;
	type: 'user';
}
const histories = new Map<string, { sequence: number; admissions: Map<string, Admission> }>();

async function admissions(conn: OpenCodeConnection, signal: AbortSignal): Promise<Admission[]> {
	const key = JSON.stringify([conn.url, conn.sessionId, conn.directory]);
	let history = histories.get(key);
	if (!history) {
		history = { sequence: 0, admissions: new Map() };
		histories.set(key, history);
		if (histories.size > 8) histories.delete(histories.keys().next().value ?? '');
	}
	for (let page = 0; page < 24; page++) {
		const response = object(
			await request(
				conn,
				`${sessionRoute(conn)}/history?after=${history.sequence}&limit=100`,
				undefined,
				signal
			)
		);
		const rows = list(response.data);
		let sequence = history.sequence;
		for (const raw of rows) {
			const event = object(raw);
			const durable = object(event.durable);
			const data = object(event.data);
			if (
				durable.aggregateID !== conn.sessionId ||
				data.sessionID !== conn.sessionId ||
				typeof durable.seq !== 'number' ||
				!Number.isSafeInteger(durable.seq) ||
				durable.seq <= sequence
			)
				throw new OpenCodeError('OpenCode returned history outside the bound session or cursor.');
			sequence = durable.seq;
			if (event.type === 'session.next.prompt.admitted' || event.type === 'session.next.prompted') {
				const prompt = object(data.prompt);
				const id = text(data.messageID);
				timestamp(data.timestamp);
				if (typeof data.timestamp !== 'number')
					throw new OpenCodeError('Invalid OpenCode admission timestamp.');
				history.admissions.set(id, {
					id,
					type: 'user',
					text: text(prompt.text),
					time: { created: data.timestamp }
				});
				if (history.admissions.size > MAX_RECORDS)
					history.admissions.delete(history.admissions.keys().next().value ?? '');
			}
		}
		history.sequence = Math.max(history.sequence, sequence);
		if (response.hasMore === false) return [...history.admissions.values()];
		if (response.hasMore !== true || !rows.length)
			throw new OpenCodeError('OpenCode returned an invalid history cursor.');
	}
	// Each retry continues from the committed cursor rather than silently skipping the remaining history.
	throw new OpenCodeError('OpenCode conversation history is still catching up. Retry shortly.');
}

/** Read one bounded canonical chat snapshot from this exact native session. */
export async function openCodeSnapshot(
	connection: OpenCodeConnection
): Promise<{ source: TranscriptSource; records: TranscriptRecord[] }> {
	const conn = parseOpenCodeConnection(connection);
	const signal = AbortSignal.timeout(15000);
	await boundSession(conn, signal);
	const messages: unknown[] = [];
	let cursor: string | null = null;
	let more = false;
	const seen = new Set<string>();
	do {
		const query = cursor ? `cursor=${encodeURIComponent(cursor)}` : 'order=desc';
		const page = object(
			await request(conn, `${sessionRoute(conn)}/message?limit=200&${query}`, undefined, signal)
		);
		messages.push(...list(page.data));
		const next = object(page.cursor).next;
		if (next !== null && typeof next !== 'string')
			throw new OpenCodeError('OpenCode returned an invalid message cursor.');
		cursor = next;
		more = cursor !== null;
		if (cursor && seen.has(cursor)) throw new OpenCodeError('OpenCode repeated a message cursor.');
		if (cursor) seen.add(cursor);
	} while (more && messages.length < MAX_RECORDS);
	messages.reverse();
	const projected = new Set(messages.map((raw) => text(object(raw).id)));
	const queued = (await admissions(conn, signal)).filter((entry) => !projected.has(entry.id));
	const combined = [...messages, ...queued]
		.map((raw) => {
			const value = object(raw);
			const at = Date.parse(timestamp(object(value.time).created));
			return { raw, at };
		})
		.sort((a, b) => a.at - b.at);
	const records = combined.flatMap(({ raw }) => messageRecords(raw));
	return {
		source: {
			how: 'api',
			file: `opencode:${conn.url}/${conn.sessionId}`,
			truncated: more || records.length > MAX_RECORDS
		},
		records: records.slice(-MAX_RECORDS)
	};
}

type Pending =
	{ picker: Picker; id: string; kind: 'permission' | 'question' } | { menu: ScreenMenu } | null;

async function pending(conn: OpenCodeConnection): Promise<Pending> {
	await boundSession(conn);
	const [permissions, questions] = await Promise.all([
		request(conn, `${sessionRoute(conn)}/permission`),
		request(conn, `${sessionRoute(conn)}/question`)
	]);
	const permissionList = list(object(permissions).data);
	const questionList = list(object(questions).data);
	const raw = permissionList[0] ?? questionList[0];
	if (!raw) return null;
	const item = object(raw);
	const id = text(item.id);
	if (!REQUEST_ID.test(id) || item.sessionID !== conn.sessionId)
		throw new OpenCodeError('OpenCode returned an interaction outside the bound session.');
	const kind = permissionList.length ? 'permission' : 'question';
	const signature = `opencode:${createHash('sha256')
		.update(JSON.stringify([conn.sessionId, kind, item]))
		.digest('hex')
		.slice(0, 32)}`;
	let title: string;
	let options: Picker['options'];
	if (kind === 'permission') {
		title = `Allow ${text(item.action)}?\n${list(item.resources).map(text).join('\n')}`;
		options = [
			{
				n: 1,
				label: 'Allow once',
				description: 'Allow this request only.',
				checked: null,
				freeText: false
			},
			{
				n: 2,
				label: 'Reject',
				description: 'Do not allow this request.',
				checked: null,
				freeText: false
			}
		];
	} else {
		const entries = list(item.questions);
		if (entries.length !== 1)
			return { menu: { title: 'Answer OpenCode’s questions in its terminal.', canDismiss: false } };
		const question = object(entries[0]);
		if (question.multiple === true)
			return {
				menu: {
					title: 'Answer OpenCode’s multiple-choice question in its terminal.',
					canDismiss: false
				}
			};
		title = text(question.question);
		options = list(question.options).map((rawOption, i) => {
			const option = object(rawOption);
			return {
				n: i + 1,
				label: text(option.label),
				description: text(option.description),
				checked: null,
				freeText: false
			};
		});
		if (!options.length || options.length > 20)
			return {
				menu: { title: 'Answer this OpenCode question in its terminal.', canDismiss: false }
			};
		if (question.custom !== false)
			options.push({
				n: options.length + 1,
				label: 'Type an answer',
				description: '',
				checked: null,
				freeText: true
			});
	}
	if (title.length > 16000)
		return { menu: { title: 'Review this OpenCode request in its terminal.', canDismiss: false } };
	return {
		id,
		kind,
		picker: { title, signature, options, tabs: [], multiSelect: false, submitMoves: null }
	};
}

export async function openCodeStatus(
	conn: OpenCodeConnection
): Promise<{ picker: Picker | null; menu: ScreenMenu | null; busy: boolean }> {
	const [interaction, active] = await Promise.all([
		pending(conn),
		request(conn, '/api/session/active')
	]);
	const running = object(object(active).data)[conn.sessionId];
	if (running !== undefined && object(running).type !== 'running')
		throw new OpenCodeError('OpenCode returned an unknown execution state.');
	return {
		picker: interaction && 'picker' in interaction ? interaction.picker : null,
		menu: interaction && 'menu' in interaction ? interaction.menu : null,
		busy: running !== undefined
	};
}

export async function pendingOpenCodePicker(conn: OpenCodeConnection): Promise<Picker | null> {
	const interaction = await pending(conn);
	return interaction && 'picker' in interaction ? interaction.picker : null;
}

export async function answerOpenCodePicker(
	conn: OpenCodeConnection,
	signature: string,
	action: PickerAction
): Promise<void> {
	const current = await pending(conn);
	if (!current || !('picker' in current) || current.picker.signature !== signature)
		throw new OpenCodeError('That OpenCode choice is no longer waiting for an answer.', 409);
	if (!('press' in action) || !Number.isInteger(action.press))
		throw new OpenCodeError('Choose one of the available answers.', 400);
	const option = current.picker.options.find((entry) => entry.n === action.press);
	if (!option || option.freeText)
		throw new OpenCodeError('Choose an available answer, or type in the terminal.', 400);
	const route = `${sessionRoute(conn)}/${current.kind}/${encodeURIComponent(current.id)}/reply`;
	await request(
		conn,
		route,
		current.kind === 'permission'
			? { reply: action.press === 1 ? 'once' : 'reject' }
			: { answers: [[option.label]] }
	);
}

export async function sendOpenCode(conn: OpenCodeConnection, text: string): Promise<void> {
	const message = text.replace(/\r\n?/g, '\n').trim();
	if (!message || message.includes('\0') || Buffer.byteLength(message) > 64 * 1024)
		throw new OpenCodeError('The message must be valid text of at most 64 KiB.', 400);
	if (await pending(conn))
		throw new OpenCodeError(
			'Answer OpenCode’s pending request before sending another message.',
			409
		);
	await request(conn, `${sessionRoute(conn)}/prompt`, {
		id: `msg_${randomUUID().replace(/-/g, '')}`,
		prompt: { text: message },
		delivery: 'steer'
	});
}

export async function interruptOpenCode(conn: OpenCodeConnection): Promise<void> {
	await boundSession(conn);
	await request(conn, `${sessionRoute(conn)}/interrupt`, {});
}
