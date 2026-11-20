/**
 * Settings → Discussion, shared by the server and the page: which tools, MCP
 * servers and skills the discussion crew launches with, and whether what it
 * passes on to Firstmate is held for the captain until the call ends (the
 * default) or sent straight away. Built-in tools are on by default; an MCP
 * server is on unless the captain turned it off or it fails to connect;
 * skills are off unless picked. Nothing here can let the crew change the
 * fleet. Pure, so it is unit-tested.
 */

export interface CrewSettings {
	tools: { webSearch: boolean; webFetch: boolean; files: boolean };
	/** Servers the captain switched; a server not here follows its default. */
	mcp: Record<string, boolean>;
	/** Skills the crew may use, by name. */
	skills: string[];
	/** `hold`: a card the captain sends or deletes, else it goes with the briefing; `direct`: sent at once. */
	handoffs: 'hold' | 'direct';
}

export const DEFAULT_CREW_TOOLS: CrewSettings = {
	tools: { webSearch: true, webFetch: true, files: true },
	mcp: {},
	skills: [],
	handoffs: 'hold'
};

export interface CrewToolsView {
	settings: CrewSettings;
	/** `connects`: null when it could not be checked. */
	mcp: { name: string; on: boolean; connects: boolean | null }[];
	skills: { name: string; description: string; on: boolean }[];
}

const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

export function parseCrewSettings(raw: unknown): CrewSettings {
	const r =
		raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const t = r.tools && typeof r.tools === 'object' ? (r.tools as Record<string, unknown>) : {};
	const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
	const mcp: Record<string, boolean> = {};
	if (r.mcp && typeof r.mcp === 'object' && !Array.isArray(r.mcp))
		for (const [name, on] of Object.entries(r.mcp as Record<string, unknown>))
			if (NAME.test(name) && typeof on === 'boolean') mcp[name] = on;
	const skills = Array.isArray(r.skills)
		? [...new Set(r.skills.filter((s): s is string => typeof s === 'string' && NAME.test(s)))]
		: [];
	return {
		tools: {
			webSearch: flag(t.webSearch, DEFAULT_CREW_TOOLS.tools.webSearch),
			webFetch: flag(t.webFetch, DEFAULT_CREW_TOOLS.tools.webFetch),
			files: flag(t.files, DEFAULT_CREW_TOOLS.tools.files)
		},
		mcp,
		skills,
		handoffs: r.handoffs === 'direct' ? 'direct' : 'hold'
	};
}
