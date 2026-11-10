/**
 * Files and voice notes on comments. Everything a reviewer uploads is
 * untrusted: only the types below are taken, each checked against what its
 * first bytes say it is (so an HTML page cannot arrive as a picture), every
 * one is size-bounded, and they are served back with their own type, no
 * sniffing, a sandboxing policy and, for anything but pictures, sound and
 * video, as a download. No SVG, HTML or script is ever taken.
 */

import { tidy } from './lib.mjs';

/** One file, a voice note, everything one review holds, files on one comment, and a voice note's length. */
export const LIMITS = {
	file: 10 * 1024 * 1024,
	voice: 5 * 1024 * 1024,
	review: 100 * 1024 * 1024,
	perComment: 4,
	pending: 10,
	voiceSeconds: 300
};

const bytes = (b, at, sig) => sig.every((v, i) => b[at + i] === v);
const ascii = (b, at, s) =>
	b.length >= at + s.length && b.toString('latin1', at, at + s.length) === s;
const riff = (b, form) => ascii(b, 0, 'RIFF') && ascii(b, 8, form);
const ebml = (b) => bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]);
const isoMedia = (b) => ascii(b, 4, 'ftyp');
/** Text: valid UTF-8 without NUL bytes. */
const text = (b) => {
	if (b.includes(0)) return false;
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(b);
		return true;
	} catch {
		return false;
	}
};

/**
 * The types reviewers may attach: what each is called on disk, how it is
 * shown, and how its first bytes are recognised.
 */
export const TYPES = {
	'image/png': {
		ext: 'png',
		kind: 'image',
		sniff: (b) => bytes(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	},
	'image/jpeg': { ext: 'jpg', kind: 'image', sniff: (b) => bytes(b, 0, [0xff, 0xd8, 0xff]) },
	'image/gif': {
		ext: 'gif',
		kind: 'image',
		sniff: (b) => ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')
	},
	'image/webp': { ext: 'webp', kind: 'image', sniff: (b) => riff(b, 'WEBP') },
	'application/pdf': { ext: 'pdf', kind: 'file', sniff: (b) => ascii(b, 0, '%PDF-') },
	'text/plain': { ext: 'txt', kind: 'file', sniff: text },
	'text/csv': { ext: 'csv', kind: 'file', sniff: text },
	'text/markdown': { ext: 'md', kind: 'file', sniff: text },
	'application/json': { ext: 'json', kind: 'file', sniff: text },
	'audio/webm': { ext: 'webm', kind: 'audio', sniff: ebml },
	'audio/ogg': { ext: 'ogg', kind: 'audio', sniff: (b) => ascii(b, 0, 'OggS') },
	'audio/mp4': { ext: 'm4a', kind: 'audio', sniff: isoMedia },
	'audio/mpeg': {
		ext: 'mp3',
		kind: 'audio',
		sniff: (b) => ascii(b, 0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
	},
	'audio/wav': { ext: 'wav', kind: 'audio', sniff: (b) => riff(b, 'WAVE') },
	'video/mp4': { ext: 'mp4', kind: 'video', sniff: isoMedia },
	'video/webm': { ext: 'webm', kind: 'video', sniff: ebml }
};

/** Other spellings browsers use for the same types. */
const ALIASES = {
	'image/jpg': 'image/jpeg',
	'audio/x-wav': 'audio/wav',
	'audio/wave': 'audio/wav',
	'audio/x-m4a': 'audio/mp4',
	'audio/mp3': 'audio/mpeg',
	'text/x-markdown': 'text/markdown'
};

/** A declared type as one of TYPES (parameters such as `;codecs=opus` dropped), or null. */
export function readType(v) {
	const base = String(v ?? '')
		.split(';')[0]
		.trim()
		.toLowerCase();
	const t = ALIASES[base] ?? base;
	return Object.hasOwn(TYPES, t) ? t : null;
}

/** A file name as shown and offered for download: one line, no folders, at most 120 characters. */
export function readFileName(v, type) {
	let raw = String(v ?? '');
	try {
		raw = decodeURIComponent(raw);
	} catch {
		// keep it as sent
	}
	const base = tidy(raw.split(/[/\\]/).pop() ?? '', 120).replace(/^\.+/, '');
	return base || `attachment.${TYPES[type]?.ext ?? 'bin'}`;
}

/**
 * An upload checked: its type is allowed and its bytes are that type, it is
 * within its size, and a voice note is sound of at most five minutes. The
 * value is what a comment keeps about it; or why it is refused.
 */
export function readUpload({ type: declared, name, voice, seconds, body }) {
	const type = readType(declared);
	if (!type)
		return {
			ok: false,
			status: 415,
			error: 'That kind of file cannot be attached. Pictures, PDFs, text and sound or video can.'
		};
	const spec = TYPES[type];
	const isVoice = voice === true;
	if (isVoice && spec.kind !== 'audio')
		return { ok: false, status: 415, error: 'A voice note is a recording of sound.' };
	const max = isVoice ? LIMITS.voice : LIMITS.file;
	if (!body.length) return { ok: false, status: 400, error: 'That file is empty.' };
	if (body.length > max)
		return {
			ok: false,
			status: 413,
			error: `A ${isVoice ? 'voice note' : 'file'} holds at most ${mb(max)}.`
		};
	if (!spec.sniff(body))
		return { ok: false, status: 415, error: `That file is not the ${type} it says it is.` };
	let secs = null;
	if (isVoice) {
		const n = Number(seconds);
		secs = Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
		if (secs !== null && secs > LIMITS.voiceSeconds + 2)
			return { ok: false, status: 413, error: 'A voice note lasts at most five minutes.' };
	}
	return {
		ok: true,
		value: {
			name: isVoice ? `voice-note.${spec.ext}` : readFileName(name, type),
			type,
			size: body.length,
			kind: isVoice ? 'voice' : spec.kind,
			seconds: secs
		}
	};
}

/** What a comment keeps about an attachment, from the owner bringing comments in; null when it is not one. */
export function readAttachmentMeta(v) {
	if (typeof v !== 'object' || v === null) return null;
	const type = readType(v.type);
	if (!type || typeof v.id !== 'string' || !/^[\w-]{1,40}$/.test(v.id)) return null;
	const size = Number(v.size);
	const voice = v.kind === 'voice' && TYPES[type].kind === 'audio';
	if (!Number.isInteger(size) || size < 1 || size > (voice ? LIMITS.voice : LIMITS.file))
		return null;
	const secs = Number(v.seconds);
	return {
		id: v.id,
		name: voice ? `voice-note.${TYPES[type].ext}` : readFileName(v.name, type),
		type,
		size,
		kind: voice ? 'voice' : TYPES[type].kind,
		seconds: voice && Number.isFinite(secs) && secs >= 0 ? Math.round(secs) : null
	};
}

/**
 * Headers an attachment is served with: its own type, never sniffed, under
 * a policy that runs nothing and sandboxes it; pictures, sound and video
 * shown in place, everything else only downloaded.
 */
export function attachmentHeaders(a) {
	const inline = ['image', 'audio', 'video', 'voice'].includes(a.kind);
	const ascii = a.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
	return {
		'content-type':
			a.type.startsWith('text/') || a.type === 'application/json'
				? `${a.type}; charset=utf-8`
				: a.type,
		'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
		'content-security-policy': "default-src 'none'; sandbox",
		'cross-origin-resource-policy': 'same-origin',
		'cache-control': 'private, no-store'
	};
}

export function mb(n) {
	return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

/** A size in a few characters: `820 KB`, `2.4 MB`. */
export function size(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return mb(n);
}

/** A voice note's length: `0:42`. */
export function duration(s) {
	if (typeof s !== 'number') return '';
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Attachments in a few words, for Firstmate's note: `[attached: shot.png (120 KB); voice note, 0:42]`. */
export function attachedWords(list) {
	if (!list?.length) return '';
	const parts = list.map((a) =>
		a.kind === 'voice'
			? `voice note${a.seconds !== null && a.seconds !== undefined ? `, ${duration(a.seconds)}` : ''}`
			: `${a.name} (${size(a.size)})`
	);
	return `[attached: ${parts.join('; ')}]`;
}
