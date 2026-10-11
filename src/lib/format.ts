/** Small display helpers shared by the UI. */

export function ago(iso: string | null | undefined, now: number): string {
	if (!iso) return 'unknown';
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return 'unknown';
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function clock(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? ''
		: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const HARNESS: Record<string, string> = {
	claude: 'Claude',
	codex: 'Codex',
	pi: 'Pi',
	copilot: 'Copilot',
	cursor: 'Cursor',
	gemini: 'Gemini',
	opencode: 'OpenCode',
	grok: 'Grok',
	antigravity: 'Antigravity',
	devin: 'Devin'
};

/** "Claude" or "Claude, opus-5"; the harness default model is left unsaid. */
export function workerName(
	worker: { harness: string | null; model: string | null } | null
): string | null {
	if (!worker?.harness) return null;
	const h = HARNESS[worker.harness.toLowerCase()] ?? worker.harness;
	return worker.model ? `${h}, ${worker.model}` : h;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
