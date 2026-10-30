import { ALERT_KINDS } from '../../bell';
import { needsYou } from '../../harbour';
import type { InboxCard, InboxOption } from '../../inbox';
import type { FleetView, ShipAlert, TaskSummary } from '../../types';
import type { ButtonAction } from './record';

/**
 * What the gateway says, channel by channel the same: bell alerts, Decision
 * cards, the local `status` and `help` answers, and the line that tells
 * Firstmate a note came from the captain's phone. Buttons are drafted as the
 * actions they stand for; the core turns each into a single-use token.
 */

export interface Draft {
	text: string;
	taskId: string | null;
	actions: { label: string; action: ButtonAction; style?: 'primary' | 'secondary' | 'danger' }[];
	links: { label: string; url: string }[];
}

const kindLabel = (kind: ShipAlert['kind']) => ALERT_KINDS.find((k) => k.kind === kind)?.label;

/** Only links a phone can open: Wheelhouse's own pages are on loopback. */
const webLink = (href: string) =>
	/^https?:\/\//i.test(href) && !/\/\/(127\.|localhost|\[::1\])/i.test(href);

/** The first line of a note from a channel, so Firstmate knows the captain is not at the keyboard. */
export function provenance(label: string): string {
	return `[via ${label}] The captain sent this from their phone and is away from the keyboard: answer with fm-inbox.sh reply on this note so the answer reaches them.`;
}

/**
 * A bell alert as a message: its own Merge note as a button, its pull request
 * as a link. Titles only, it says just the kind and the task.
 */
export function alertDraft(alert: ShipAlert, titlesOnly: boolean): Draft {
	const head = `${kindLabel(alert.kind) ?? 'Alert'}: ${alert.title}`;
	const body = titlesOnly ? head : `${head}\n${alert.text}`;
	if (alert.taskId === null) {
		// A menu in Firstmate's session (a question or a permission prompt) is answered at the keyboard only.
		return {
			text: `${body}\nFirstmate is asking in its session; answer it at the keyboard.`,
			taskId: null,
			actions: [],
			links: []
		};
	}
	const draft: Draft = {
		text: body,
		taskId: alert.taskId,
		actions: [],
		links: []
	};
	for (const a of alert.actions) {
		if (a.kind === 'note') {
			draft.actions.push({
				label: a.label,
				style: 'primary',
				// The browser's toast sends exactly this, so a tap here and a click there are one note.
				action: { kind: 'note', requestId: a.requestId, text: a.text, sent: a.sent, taskId: null }
			});
		} else if (a.external && webLink(a.href)) {
			draft.links.push({ label: a.label, url: a.href });
		}
	}
	return draft;
}

/**
 * An open question from the Decisions inbox, with its choices as buttons;
 * titles only, without the question. A question that names options sends
 * only picks the captain saw: a single call's options are buttons of their
 * own when they fit beside Fix, Skip and the links, else the picks are made
 * in Wheelhouse.
 */
export function cardDraft(
	card: InboxCard,
	titlesOnly: boolean,
	room: { buttons: number; wheelhouse: string | null }
): Draft {
	const lines = [`Decision: ${card.taskTitle}`];
	if (!titlesOnly) {
		lines.push(card.question);
		if (card.recommendation?.text) lines.push(`Recommended: ${card.recommendation.text}`);
	}
	const answer = (o: InboxOption): Draft['actions'][number] => ({
		label: o.label,
		style: card.recommendation?.choice === o.choice ? 'primary' : 'secondary',
		action: { kind: 'answer', cardId: card.id, choice: o.choice, label: o.label }
	});
	const draft: Draft = {
		text: '',
		taskId: card.taskId,
		actions: card.options.map(answer),
		links: card.evidence.pr ? [{ label: 'Open PR', url: card.evidence.pr.url }] : []
	};
	if (card.choices) {
		const rest = draft.actions.filter(
			(a) => a.action.kind === 'answer' && a.action.choice !== 'approve'
		);
		const [call, ...more] = card.choices.calls;
		const fits = call && call.options.length + rest.length + draft.links.length <= room.buttons;
		if (!titlesOnly && call && !more.length && fits) {
			draft.actions = [
				...call.options.map((o): Draft['actions'][number] => ({
					label: o.label,
					style: o.recommended ? 'primary' : 'secondary',
					action: {
						kind: 'answer',
						cardId: card.id,
						choice: 'approve',
						label: o.label,
						picks: { [call.id]: o.id }
					}
				})),
				...rest
			];
		} else {
			draft.actions = rest;
			if (room.wheelhouse) {
				draft.links.unshift({ label: 'Open in Wheelhouse', url: `${room.wheelhouse}/decisions` });
			}
			lines.push('Make your picks in Wheelhouse’s Decisions.');
		}
	}
	lines.push('Reply to this message to answer in your own words.');
	draft.text = lines.join('\n');
	return draft;
}

const STUCK = new Set(['blocked', 'failed', 'lost']);

function waitLine(t: TaskSummary): string {
	if (t.status === 'needs-review' && t.pr) return `${t.shortTitle}: pull request ready for you`;
	const said = t.attention?.text?.replace(/\s+/g, ' ').trim();
	return `${t.shortTitle}: ${said ? (said.length > 140 ? `${said.slice(0, 139)}…` : said) : t.statusLabel}`;
}

/** The answer to `status`, from the fleet Wheelhouse already has: nothing is asked of Firstmate. */
export function statusText(fleet: FleetView, onWatch: boolean | null): string {
	const lines = [
		onWatch === true
			? 'Firstmate is on watch.'
			: onWatch === false
				? 'Firstmate is off watch.'
				: 'Wheelhouse cannot tell whether Firstmate is on watch.'
	];
	if (!fleet.collectedAt) {
		lines.push(fleet.staleReason ?? 'Wheelhouse has not read the fleet yet.');
		return lines.join('\n');
	}
	const yours = fleet.tasks.filter(needsYou);
	if (yours.length) {
		lines.push(`Waiting on you (${yours.length}):`);
		for (const t of yours.slice(0, 8)) lines.push(`- ${waitLine(t)}`);
		if (yours.length > 8) lines.push(`- and ${yours.length - 8} more`);
	} else {
		lines.push('Nothing is waiting on you.');
	}
	const count = (p: (t: TaskSummary) => boolean) => fleet.tasks.filter(p).length;
	const parts = [
		[count((t) => t.status === 'working' || t.status === 'waiting'), 'under way'],
		[count((t) => STUCK.has(t.status)), 'stuck'],
		[count((t) => t.status === 'queued'), 'queued']
	]
		.filter(([n]) => (n as number) > 0)
		.map(([n, w]) => `${n} ${w}`);
	if (parts.length) lines.push(parts.join(' · '));
	if (fleet.stale)
		lines.push(`(As of ${fleet.collectedAt}: ${fleet.staleReason ?? 'the view is stale'}.)`);
	return lines.join('\n');
}

export const HELP_TEXT = [
	'Anything you write here goes to Firstmate, and its answer comes back here.',
	'Reply to an alert or a decision to write about that task.',
	'status: what the crew is doing, answered by Wheelhouse without waking Firstmate.',
	'help: this message.',
	'Questions Firstmate asks in its own session, and its permission prompts, are answered at the keyboard only.'
].join('\n');

/** The words answered here, never sent to Firstmate. */
export function localCommand(text: string): 'status' | 'help' | null {
	const t = text.trim().toLowerCase();
	return t === 'status' || t === 'help' ? t : null;
}

/** Split text into pieces of at most `limit` characters, at line breaks where it can. */
export function splitText(text: string, limit: number): string[] {
	const out: string[] = [];
	let cur = '';
	for (const line of text.split('\n')) {
		let rest = line;
		while (rest.length > limit) {
			if (cur) {
				out.push(cur);
				cur = '';
			}
			const cut = rest.lastIndexOf(' ', limit);
			const at = cut > limit / 2 ? cut : limit;
			out.push(rest.slice(0, at));
			rest = rest.slice(at).trimStart();
		}
		const next = cur ? `${cur}\n${rest}` : rest;
		if (next.length > limit) {
			out.push(cur);
			cur = rest;
		} else {
			cur = next;
		}
	}
	if (cur || !out.length) out.push(cur);
	return out;
}
