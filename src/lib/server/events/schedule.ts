/** A deliberately small recurrence grammar, evaluated in the entry's IANA zone. */
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const isClock = (s: unknown): s is string => typeof s === 'string' && CLOCK.test(s);
export function checkZone(zone: string): void {
	new Intl.DateTimeFormat('en', { timeZone: zone }).format();
}
export function localParts(at: number, timeZone: string) {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		weekday: 'short'
	}).formatToParts(at);
	const p = Object.fromEntries(parts.map((p) => [p.type, p.value]));
	return {
		date: `${p.year}-${p.month}-${p.day}`,
		time: `${p.hour}:${p.minute}`,
		day: Number(p.day),
		weekday: p.weekday.toLowerCase()
	};
}
type Rule =
	| { kind: 'once'; local: string }
	| { kind: 'every'; ms: number }
	| { kind: 'calendar'; time: string; days: string[] | null; day: number | null };
function parse(rule: string): Rule {
	const once =
		/^once (\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)?)$/.exec(rule);
	if (once) {
		const local = once[1];
		const [year, month, day] = local.slice(0, 10).split('-').map(Number);
		const calendar = new Date(0);
		calendar.setUTCFullYear(year, month - 1, day);
		calendar.setUTCHours(0, 0, 0, 0);
		if (
			calendar.getUTCFullYear() !== year ||
			calendar.getUTCMonth() !== month - 1 ||
			calendar.getUTCDate() !== day ||
			!isClock(local.slice(11, 16))
		)
			throw new Error('Invalid date.');
		if (!/(?:Z|[+-]\d\d:\d\d)$/.test(local) && local.length !== 16)
			throw new Error('Local once times use YYYY-MM-DDTHH:MM; include an offset for seconds.');
		if (!Number.isFinite(Date.parse(/[Z+-]\d|Z$/.test(local.slice(10)) ? local : local + 'Z')))
			throw new Error('Invalid date.');
		return { kind: 'once', local };
	}
	const every = /^every ([1-9]\d{0,4})(m|h|d)$/.exec(rule);
	if (every) {
		const ms =
			Number(every[1]) * { m: 60000, h: 3600000, d: 86400000 }[every[2] as 'm' | 'h' | 'd'];
		if (ms < 900000) throw new Error('The minimum interval is 15 minutes.');
		return { kind: 'every', ms };
	}
	const calendar =
		/^(daily|weekdays|weekly (?:mon|tue|wed|thu|fri|sat|sun)(?:,(?:mon|tue|wed|thu|fri|sat|sun))*|monthly (?:[1-9]|[12]\d|3[01])) ((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
			rule
		);
	if (!calendar)
		throw new Error(
			'Use once <ISO date>, daily HH:MM, weekdays HH:MM, weekly mon,thu HH:MM, monthly 1 HH:MM, or every 2h.'
		);
	const [kind, arg] = calendar[1].split(' ');
	return {
		kind: 'calendar',
		time: calendar[2],
		days:
			kind === 'weekdays'
				? ['mon', 'tue', 'wed', 'thu', 'fri']
				: kind === 'weekly'
					? arg.split(',')
					: null,
		day: kind === 'monthly' ? Number(arg) : null
	};
}
/** The next instant strictly after `after`. DST gaps skip; a repeated wall minute fires once. */
export function nextOccurrence(rule: string, timeZone: string, after: number): string | null {
	checkZone(timeZone);
	const r = parse(rule);
	if (r.kind === 'every') return new Date(after + r.ms).toISOString();
	if (r.kind === 'once' && /(?:Z|[+-]\d\d:\d\d)$/.test(r.local)) {
		const at = Date.parse(r.local);
		return at > after ? new Date(at).toISOString() : null;
	}
	// Calendar search is bounded to 370 days. Scan dates via UTC then resolve only the selected wall time.
	const wanted = r.kind === 'once' ? r.local.slice(0, 10) : null;
	const time = r.kind === 'once' ? r.local.slice(11, 16) : r.time;
	const start = Date.parse(localParts(after, timeZone).date + 'T00:00:00Z');
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	const wall = (t: number) => {
		const p = Object.fromEntries(formatter.formatToParts(t).map((p) => [p.type, p.value]));
		return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
	};
	for (let d = 0; d <= 370; d++) {
		const date = new Date(start + d * 86400000),
			day = date.toISOString().slice(0, 10);
		if (wanted && day !== wanted) continue;
		if (
			r.kind === 'calendar' &&
			((r.day && date.getUTCDate() !== r.day) ||
				(r.days &&
					!r.days.includes(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getUTCDay()])))
		)
			continue;
		const target = `${day}T${time}`,
			nominal = Date.parse(target + 'Z');
		// All current IANA offsets are quarter-hour multiples. Cover both sides of DST transitions.
		for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
			const at = nominal + offset * 60000;
			if (wall(at) === target) {
				if (at > after) return new Date(at).toISOString();
				if (r.kind === 'once') return null;
				break;
			}
		}
	}
	if (r.kind === 'once')
		throw new Error(
			'That local time does not exist or is not in the next year; use an ISO instant with an offset.'
		);
	throw new Error('No occurrence in the next year.');
}
export function validateSchedule(rule: string, timeZone: string, now: number): string {
	const at = nextOccurrence(rule, timeZone, now);
	if (!at) throw new Error('Choose a future reminder time.');
	return at;
}
