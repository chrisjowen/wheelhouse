/**
 * Files the captain attaches to a message in the Firstmate chat. Each is
 * saved on this machine in Wheelhouse's uploads folder (lib/server/uploads.ts);
 * Firstmate receives one plain line per file naming its absolute path, name,
 * size and type, and opens it with its own tools. The chat turns those lines
 * back into the "files attached" card. Pure, so it is unit-tested.
 */
export interface Attachment {
	/** Absolute path on this machine. */
	path: string;
	name: string;
	/** Bytes. */
	size: number;
	/** MIME type as the browser named it; '' when unknown. */
	type: string;
}

/** The upload's header carrying the file's name, URI-encoded (a header cannot hold every character). */
export const NAME_HEADER = 'x-wheelhouse-filename';
/**
 * The upload's header carrying the file's MIME type. The body itself is always
 * sent as application/octet-stream: SvelteKit's CSRF check refuses form types
 * such as text/plain before Wheelhouse's own checks run.
 */
export const TYPE_HEADER = 'x-wheelhouse-filetype';

/** The largest file Wheelhouse takes. */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** Days an uploaded file is kept before Wheelhouse deletes it. */
export const UPLOAD_KEEP_DAYS = 7;

export function fileSize(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The line a file becomes in the message Firstmate receives. */
export function expandAttachment(a: Attachment): string {
	return `[attached file ${a.path} — ${a.name}, ${fileSize(a.size)}, ${a.type || 'unknown type'}]`;
}

// The name is the path's last part, which keeps a " — " inside a name from splitting the line wrongly.
const LINE =
	/^\[attached file (\/[^\n]*?\/([^/\n]+)) — \2, ([\d.]+) (B|KB|MB), ([^\]\n,]+)\][ \t]*$/gm;

const UNIT = { B: 1, KB: 1024, MB: 1024 * 1024 } as const;

/** A sent message back as its words and its attached files. */
export function parseAttachments(text: string): { text: string; files: Attachment[] } {
	const files: Attachment[] = [];
	const rest = text.replace(
		LINE,
		(_, path: string, name: string, n: string, unit, type: string) => {
			files.push({
				path,
				name,
				size: Math.round(Number(n) * UNIT[unit as keyof typeof UNIT]),
				type: type === 'unknown type' ? '' : type
			});
			return '';
		}
	);
	return files.length ? { text: rest.trim(), files } : { text, files };
}

/** Raster images the chat shows as thumbnails; SVG and anything else are listed by name only. */
export const isImage = (type: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(type);

/** A short kind for a file's row: "PDF", "Image", or its extension. */
export function kindLabel(a: Pick<Attachment, 'name' | 'type'>): string {
	if (a.type === 'application/pdf') return 'PDF';
	if (a.type.startsWith('image/')) return 'Image';
	const ext = /\.([A-Za-z0-9]{1,6})$/.exec(a.name)?.[1];
	if (ext) return ext.toUpperCase();
	return a.type.startsWith('text/') ? 'Text' : 'File';
}

/**
 * Where the page fetches an attached image's thumbnail, or null for a file
 * that is not an image or not in an uploads folder. The server checks again.
 */
export function thumbUrl(a: Attachment): string | null {
	if (!isImage(a.type)) return null;
	const m = /\/uploads\/(\d{4}-\d{2}-\d{2})\/([a-f0-9]{12})\/([^/]+)$/.exec(a.path);
	return m ? `/api/firstmate/uploads/${m[1]}/${m[2]}/${encodeURIComponent(m[3])}` : null;
}

/** A name for a pasted image, which has no name of its own. */
export function pastedName(type: string, now = new Date()): string {
	const ext = /^image\/(png|jpeg|gif|webp|avif)$/.exec(type)?.[1]?.replace('jpeg', 'jpg') ?? 'png';
	const stamp = now.toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
	return `Pasted image ${stamp}.${ext}`;
}
