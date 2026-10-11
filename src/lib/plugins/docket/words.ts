import {
	Bot,
	Boxes,
	Circle,
	Database,
	Flag,
	FolderGit2,
	Gavel,
	Globe,
	Library,
	Lock,
	Server,
	Users
} from '@lucide/svelte';
import type { Component } from 'svelte';
import type { Mark } from './types';

/**
 * Plain words and pictures for the Chart: the captain reads "position
 * approximate", not "confidence 0.65, basis evidence".
 */

/** Docket's Lucide icon names for the default ontology; anything else draws a circle. */
const ICONS: Record<string, Component> = {
	bot: Bot,
	boxes: Boxes,
	database: Database,
	flag: Flag,
	'folder-git-2': FolderGit2,
	gavel: Gavel,
	globe: Globe,
	library: Library,
	lock: Lock,
	server: Server,
	users: Users
};

export const iconFor = (name: string | null | undefined): Component =>
	(name && ICONS[name]) || Circle;

/** `feature_flag` → `Feature flag`. */
export const typeLabel = (type: string) => {
	const s = type.replace(/[_-]+/g, ' ').trim();
	return s ? s[0].toUpperCase() + s.slice(1) : 'Exhibit';
};

/** `depends_on` → `depends on`. */
export const relLabel = (rel: string) => rel.replace(/[_-]+/g, ' ');

export const MARKS: Record<Mark, { short: string; label: string; means: string }> = {
	charted: { short: '', label: 'Charted', means: 'backed by evidence' },
	approximate: {
		short: 'PA',
		label: 'Position approximate',
		means: 'some evidence, not conclusive'
	},
	doubtful: { short: 'ED', label: 'Existence doubtful', means: 'stated, with no evidence yet' },
	unsurveyed: { short: '', label: 'Unsurveyed', means: 'named, but nothing describes it' }
};

/** SVG dash pattern per mark. */
export const DASH: Record<Mark, string | undefined> = {
	charted: undefined,
	approximate: '7 4',
	doubtful: '1 4',
	unsurveyed: '1 4'
};

/** How an exhibit's own confidence reads. */
export function confidenceWords(confidence: number | null, basis: string | null): string {
	const pct = confidence === null ? '' : ` (${Math.round(confidence * 100)}%)`;
	if (basis === 'evidence') return `Backed by evidence${pct}`;
	if (basis === 'stated') return `Stated in the docket${pct}`;
	if (basis === 'unevidenced') return 'Stated, with no evidence yet';
	return confidence === null ? 'Confidence not computed' : `Confidence${pct}`;
}

/** Evidence older than this reads as an old survey. */
export const OLD_SURVEY_DAYS = 180;

export function surveyAge(date: string | null, now: number): 'fresh' | 'old' | null {
	if (!date) return null;
	const t = Date.parse(`${date}T00:00:00Z`);
	if (Number.isNaN(t)) return null;
	return now - t > OLD_SURVEY_DAYS * 86_400_000 ? 'old' : 'fresh';
}
