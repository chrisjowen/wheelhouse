import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PortalEvidence, PortalRecord } from '$lib/portal';

vi.mock('$app/state', () => ({
	page: {
		data: {},
		url: new URL('http://127.0.0.1:4310/portal/payments/api.refunds-create')
	}
}));

const { default: Page } = await import('./+page.svelte');

const ev = (o: Partial<PortalEvidence> = {}): PortalEvidence => ({
	source: 'codebase',
	repository: 'checkout-service',
	path: 'src/RefundsClient.kt',
	lines: '14-52',
	commit: '4be7a19',
	sourceRef: null,
	url: null,
	note: null,
	observedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
	filedBy: 'firstmate (codex)',
	for: 'priya-nair',
	confirmed: true,
	...o
});

const ready = ev({ note: 'Sends amount and payment_id; no reason_code yet.' });

const refunds: PortalRecord = {
	id: 'api.refunds-create',
	type: 'api',
	typeName: 'API',
	title: 'Create refund',
	summary: 'Refunds all or part of a payment. The body must carry a `reason_code`.',
	attributes: [
		{ key: 'kind', value: 'rest' },
		{ key: 'method', value: 'POST' },
		{ key: 'path', value: '/v2/refunds' },
		{ key: 'auth', value: 'payments:write' }
	],
	hidden: 0,
	evidence: [
		ev({ repository: 'payments-api', note: 'reason_code is now required (payments-api#412).' })
	],
	owners: [{ id: 'person.marcus-bell', title: 'Marcus Bell', type: 'person', via: null }],
	environments: [],
	links: [
		{
			rel: 'exposes',
			direction: 'in',
			id: 'service.payments-api',
			title: 'payments-api',
			type: 'service',
			evidence: [ev()]
		},
		{
			rel: 'calls',
			direction: 'in',
			id: 'service.checkout-service',
			title: 'checkout-service',
			type: 'service',
			evidence: [ready]
		},
		{
			rel: 'gated_by',
			direction: 'out',
			id: 'flag.require-reason',
			title: 'refunds.require_reason',
			type: 'flag',
			evidence: [ev()]
		}
	],
	touchesYou: {
		known: true,
		youOwn: false,
		yoursCallIt: [
			{
				id: 'service.checkout-service',
				title: 'checkout-service',
				type: 'service',
				via: null,
				evidence: [ready]
			}
		],
		itCallsYours: []
	},
	confirmed: { facts: 3, of: 4 },
	notKnown: ['what calls it'],
	fullPage: 'https://fleetyard.io/t/payments/portal/apis/refunds-create',
	updatedAt: new Date().toISOString()
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

function show(data: Record<string, unknown>) {
	app = mount(Page, {
		target: document.body,
		props: { data: { q: '', answer: null, team: 'payments', ...data } } as never
	});
	flushSync();
}
const text = (id: string) =>
	document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('an API’s basics', () => {
	it('says how it touches you: owner, whether you call it, whether you are ready, and its flag', () => {
		show({
			record: {
				ok: true,
				value: { team: { slug: 'payments', name: 'Payments squad' }, record: refunds }
			}
		});
		expect(text('portal-title')).toBe('POST /v2/refunds');
		expect(text('portal-part-of')).toBe('Part of payments-api.');
		expect(document.querySelector('code')?.textContent).toBe('reason_code');
		expect(text('portal-about')).toContain('dev portal');
		expect(text('portal-owner')).toBe('Marcus Bell');
		expect(text('portal-calls')).toBe('Yes: your checkout-service calls it.');
		expect(text('portal-change')).toContain('reason_code is now required (payments-api#412).');
		expect(text('portal-ready')).toContain(
			'checkout-service: Sends amount and payment_id; no reason_code yet.'
		);
		expect(text('portal-ready')).toContain('Confirmed in the code');
		expect(text('portal-flag')).toBe('Behind the flag refunds.require_reason');
		expect(text('portal-not-known')).toContain('what calls it');
	});

	it('puts the facts that touch you first, and links to the full page on Fleetyard', () => {
		show({
			record: {
				ok: true,
				value: { team: { slug: 'payments', name: 'Payments squad' }, record: refunds }
			}
		});
		const first = document.querySelector('[data-testid="portal-facts"] li');
		expect(first?.textContent).toContain('checkout-service calls POST /v2/refunds');
		expect(first?.textContent).toContain('yours');
		const full = document.querySelector<HTMLAnchorElement>('[data-testid="portal-full-page"]');
		expect(full?.href).toBe(refunds.fullPage);
		expect(full?.target).toBe('_blank');
	});

	it('shows what the dev portal holds for a question, or that it holds nothing', () => {
		show({
			record: {
				ok: true,
				value: { team: { slug: 'payments', name: 'Payments squad' }, record: refunds }
			},
			q: 'partner integrations',
			answer: {
				ok: true,
				value: { q: 'partner integrations', notRecorded: true, matches: [], fullPortal: null }
			}
		});
		expect(text('portal-answer')).toContain('Not recorded in the dev portal');
		expect(
			document.querySelector<HTMLInputElement>('[data-testid="portal-ask"] input')?.value
		).toBe('partner integrations');
	});

	it('says why when Fleetyard could not give it', () => {
		show({
			record: {
				ok: false,
				status: 404,
				message: 'Not recorded in Docket: the team’s record has no api.nope.'
			}
		});
		expect(text('portal-error')).toBe('Not recorded in Docket: the team’s record has no api.nope.');
	});
});
