import { error } from '@sveltejs/kit';
import { uploadedImage, uploadsDir } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

/**
 * An attached image, for its thumbnail in the chat. Only files in the uploads
 * folder whose bytes are a PNG, JPEG, GIF, WebP or AVIF image are served, with
 * that sniffed type, never the type the browser claimed; anything else (SVG,
 * HTML, documents) is not served at all. The CSP and nosniff keep a browser
 * from treating the bytes as anything but an image even if opened directly.
 */
export const GET: RequestHandler = async ({ params }) => {
	const img = await uploadedImage(uploadsDir(process.env), params.day, params.id, params.name);
	if (!img) error(404, 'Not found');
	return new Response(new Uint8Array(img.bytes), {
		headers: {
			'content-type': img.type,
			'content-length': String(img.bytes.length),
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox",
			'content-disposition': 'inline',
			'cache-control': 'private, max-age=86400'
		}
	});
};
