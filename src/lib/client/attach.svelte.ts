import {
	NAME_HEADER,
	TYPE_HEADER,
	isImage,
	pastedName,
	UPLOAD_MAX_BYTES,
	type Attachment
} from '$lib/chat/attachments';
import { SESSION_HEADER } from '$lib/client/messages';

/**
 * The files waiting to go with the captain's next message. Each uploads as
 * soon as it is added (button, drop or paste), to /api/firstmate/uploads with
 * the session token; the message names only the ones that finished. A file
 * that fails stays listed with why, until removed.
 */
export type Draft = {
	id: string;
	name: string;
	size: number;
	type: string;
	/** A local object URL for an image's thumbnail while it waits. */
	preview: string | null;
	state: 'uploading' | 'ready' | 'failed';
	/** 0 to 1. */
	progress: number;
	error: string | null;
	upload: Attachment | null;
};

const TOO_LARGE = `Too large · ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB at most`;

class Attachments {
	drafts = $state<Draft[]>([]);
	/** Files dropped on the chat, for the composer to take. */
	dropped = $state.raw<File[]>([]);
	private inflight = new Map<string, XMLHttpRequest>();

	/** Add files and start uploading them. `pasted`: from the clipboard, so an image under the browser's generic name gets a readable one. */
	add(files: File[], token: string, pasted = false) {
		for (const f of files) {
			const generic = pasted && isImage(f.type) && /^image\.\w+$/.test(f.name);
			const name = generic || !f.name ? pastedName(f.type) : f.name;
			this.drafts.push({
				id: crypto.randomUUID(),
				name,
				size: f.size,
				type: f.type,
				preview: isImage(f.type) ? URL.createObjectURL(f) : null,
				state: 'uploading',
				progress: 0,
				error: null,
				upload: null
			});
			const d = this.drafts[this.drafts.length - 1];
			if (f.size > UPLOAD_MAX_BYTES) this.fail(d, TOO_LARGE);
			else if (f.size === 0) this.fail(d, 'Empty file');
			else this.send(d, f, token);
		}
	}

	remove(id: string) {
		this.inflight.get(id)?.abort();
		this.inflight.delete(id);
		const d = this.drafts.find((x) => x.id === id);
		if (d?.preview) URL.revokeObjectURL(d.preview);
		this.drafts = this.drafts.filter((x) => x.id !== id);
	}

	/** The uploaded files, handed to the message; failed ones stay listed. */
	take(): Attachment[] {
		const ready = this.drafts.filter((d) => d.state === 'ready' && d.upload);
		for (const d of ready) if (d.preview) URL.revokeObjectURL(d.preview);
		this.drafts = this.drafts.filter((d) => !ready.includes(d));
		return ready.map((d) => d.upload!);
	}

	get uploading() {
		return this.drafts.some((d) => d.state === 'uploading');
	}

	get ready() {
		return this.drafts.some((d) => d.state === 'ready');
	}

	private fail(d: Draft, error: string) {
		d.state = 'failed';
		d.error = error;
	}

	private send(d: Draft, file: File, token: string) {
		const xhr = new XMLHttpRequest();
		this.inflight.set(d.id, xhr);
		xhr.open('POST', '/api/firstmate/uploads');
		xhr.setRequestHeader(SESSION_HEADER, token);
		xhr.setRequestHeader(NAME_HEADER, encodeURIComponent(d.name));
		xhr.setRequestHeader(TYPE_HEADER, file.type);
		xhr.setRequestHeader('content-type', 'application/octet-stream');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) d.progress = e.loaded / e.total;
		};
		xhr.onload = () => {
			this.inflight.delete(d.id);
			let body: { message?: string } & Partial<Attachment> = {};
			try {
				body = JSON.parse(xhr.responseText);
			} catch {
				// answered with something other than JSON
			}
			if (xhr.status === 201 && typeof body.path === 'string') {
				d.upload = {
					path: body.path,
					name: body.name ?? d.name,
					size: body.size ?? d.size,
					type: body.type ?? ''
				};
				d.progress = 1;
				d.state = 'ready';
			} else if (xhr.status === 413) this.fail(d, TOO_LARGE);
			else this.fail(d, body.message ?? `Not uploaded · Wheelhouse answered ${xhr.status}`);
		};
		xhr.onerror = () => {
			this.inflight.delete(d.id);
			this.fail(d, 'Could not reach the Wheelhouse server');
		};
		xhr.send(file);
	}
}

export const attachments = new Attachments();
