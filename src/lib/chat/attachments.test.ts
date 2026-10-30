import { describe, expect, it } from 'vitest';
import {
	expandAttachment,
	fileSize,
	kindLabel,
	parseAttachments,
	pastedName,
	thumbUrl,
	type Attachment
} from './attachments';

const DIR = '/Users/me/.local/state/wheelhouse/uploads/2026-10-31';
const shot: Attachment = {
	path: `${DIR}/0a1b2c3d4e5f/checkout bug.png`,
	name: 'checkout bug.png',
	size: 48_354,
	type: 'image/png'
};
const report: Attachment = {
	path: `${DIR}/abcdefabcdef/Q3 report — final, v2.pdf`,
	name: 'Q3 report — final, v2.pdf',
	size: 3 * 1024 * 1024 + 300_000,
	type: 'application/pdf'
};

describe('expandAttachment', () => {
	it('names the absolute path, the name, the size and the type in one plain line', () => {
		expect(expandAttachment(shot)).toBe(
			`[attached file ${DIR}/0a1b2c3d4e5f/checkout bug.png — checkout bug.png, 47 KB, image/png]`
		);
	});

	it('says so when the browser gave no type', () => {
		expect(expandAttachment({ ...shot, type: '' })).toMatch(/, unknown type\]$/);
	});
});

describe('parseAttachments', () => {
	it('turns a sent message back into its words and its files', () => {
		const text = ['Can you look at these?', expandAttachment(shot), expandAttachment(report)].join(
			'\n'
		);
		const { text: words, files } = parseAttachments(text);
		expect(words).toBe('Can you look at these?');
		expect(files.map((f) => [f.path, f.name, f.type])).toEqual([
			[shot.path, shot.name, 'image/png'],
			[report.path, report.name, 'application/pdf']
		]);
		expect(files[0].size).toBe(47 * 1024);
		expect(files[1].size).toBeCloseTo(3.3 * 1024 * 1024, -4);
	});

	it('keeps a name with a dash and commas in one piece', () => {
		expect(parseAttachments(expandAttachment(report)).files[0].name).toBe(
			'Q3 report — final, v2.pdf'
		);
	});

	it('takes a message that is only files, with no words', () => {
		const r = parseAttachments(expandAttachment({ ...shot, type: '' }));
		expect(r.text).toBe('');
		expect(r.files[0].type).toBe('');
	});

	it('leaves a message without attachment lines exactly as it was', () => {
		const text = '  look at [attached file not/a/path — x, 1 KB, y] please\n';
		expect(parseAttachments(text)).toEqual({ text, files: [] });
	});

	it('does not take a line mentioned inside other words', () => {
		const text = `see ${expandAttachment(shot)} above`;
		expect(parseAttachments(text).files).toEqual([]);
	});
});

describe('thumbUrl', () => {
	it('points an image in an uploads folder at the thumbnail route', () => {
		expect(thumbUrl(shot)).toBe(
			'/api/firstmate/uploads/2026-10-31/0a1b2c3d4e5f/checkout%20bug.png'
		);
	});

	it('gives none for a file that is not a raster image', () => {
		expect(thumbUrl(report)).toBeNull();
		expect(thumbUrl({ ...shot, type: 'image/svg+xml' })).toBeNull();
	});

	it('gives none for a path outside an uploads folder', () => {
		expect(thumbUrl({ ...shot, path: '/etc/passwd.png' })).toBeNull();
		expect(thumbUrl({ ...shot, path: `${DIR}/not-an-id/x.png` })).toBeNull();
	});
});

describe('labels', () => {
	it('sizes files in B, KB and MB', () => {
		expect(fileSize(512)).toBe('512 B');
		expect(fileSize(5_350)).toBe('5 KB');
		expect(fileSize(25 * 1024 * 1024)).toBe('25.0 MB');
	});

	it('names a file’s kind plainly', () => {
		expect(kindLabel(report)).toBe('PDF');
		expect(kindLabel(shot)).toBe('Image');
		expect(kindLabel({ name: 'notes.txt', type: 'text/plain' })).toBe('TXT');
		expect(kindLabel({ name: 'README', type: 'text/plain' })).toBe('Text');
		expect(kindLabel({ name: 'blob', type: '' })).toBe('File');
	});

	it('names a pasted image by when it was pasted', () => {
		expect(pastedName('image/png', new Date('2026-10-31T09:05:07Z'))).toBe(
			'Pasted image 2026-10-31 09.05.07.png'
		);
		expect(pastedName('image/jpeg', new Date('2026-10-31T09:05:07Z'))).toMatch(/\.jpg$/);
	});
});
