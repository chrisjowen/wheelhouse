/** Phase 0 accepts only captain-authored reminders. Provider kinds belong to later phases. */
export type EventLevel = 'off' | 'wheelhouse-only' | 'notify-only';
export interface EventRule {
	id: string;
	source: 'schedule' | '*';
	kind: 'schedule.reminder' | '*';
	level: EventLevel;
	batchMinutes: number;
	digest: 'batch' | 'hourly' | 'daily';
	at: string;
}
export interface EventSettings {
	paused: boolean;
	timeZone: string;
	quiet: { enabled: boolean; start: string; end: string };
	rules: EventRule[];
	source: { level: EventLevel; paused: boolean; reason: string | null };
}
export interface Reminder {
	id: string;
	text: string;
	rule: string;
	timeZone: string;
	missed: 'once' | 'all' | 'skip';
	createdAt: string;
	nextAt: string | null;
	state: 'active' | 'paused' | 'done';
}
export interface ReminderEvent {
	schema: 'wh-event.v1';
	id: string;
	source: 'schedule';
	origin: 'schedule';
	verified: 'captain';
	kind: 'schedule.reminder';
	reminderId: string;
	text: string;
	setAt: string;
	dueAt: string;
	receivedAt: string;
	missed: number;
	ruleId: string;
	level: EventLevel;
	readyAt: string;
	status: 'held' | 'off' | 'wheelhouse-only' | 'rate-limited' | 'batched';
	batchId: string | null;
}
export interface EventBatch {
	id: string;
	classification: 'notify' | 'digest' | 'paused-notice';
	createdAt: string;
	eventIds: string[];
	dropped: number;
	rateLimited: number;
	capturedAt: string | null;
}
export interface EventsState {
	schema: 'wh-events-store.v1';
	settings: EventSettings;
	reminders: Reminder[];
	events: ReminderEvent[];
	batches: EventBatch[];
	delivery: { requestId: string; batchId: string | null; output: string | null } | null;
	counters: { dropped: number; limited: number };
	sourceWindows: { hour: number; count: number; exceeded: boolean }[];
	resumeNotice: boolean;
}
export interface EventsView extends EventsState {
	problem: string | null;
	connected: boolean;
	bound?: boolean;
	pending?: number | null;
	connectionProblem: string | null;
}
