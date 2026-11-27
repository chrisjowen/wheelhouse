import { describe, expect, it } from 'vitest';
import {
	factsOf,
	portalHref,
	receipt,
	recordName,
	ticks,
	type PortalEvidence,
	type PortalRecord
} from './portal';

const ev = (o: Partial<PortalEvidence> = {}): PortalEvidence => ({
	source: 'codebase',
	repository: null,
	path: null,
	lines: null,
	commit: null,
	sourceRef: null,
	url: null,
	note: null,
	observedAt: '2026-11-20T10:00:00.000Z',
	filedBy: 'firstmate (claude-code)',
	for: 'marcus-bell',
	confirmed: false,
	...o
});

/** payments-api, which Priya's checkout-service calls through POST /v2/refunds. */
const service: PortalRecord = {
	id: 'service.payments-api',
	type: 'service',
	typeName: 'Service',
	title: 'payments-api',
	summary: '',
	attributes: [],
	hidden: 0,
	evidence: [ev({ note: 'Moved to Node 22.', observedAt: '2026-11-10T10:00:00.000Z' })],
	owners: [],
	environments: [],
	links: [
		{
			rel: 'calls',
			direction: 'out',
			id: 'service.ledger-service',
			title: 'ledger-service',
			type: 'service',
			evidence: [ev({ observedAt: '2026-11-27T10:00:00.000Z' })]
		},
		{
			rel: 'exposes',
			direction: 'out',
			id: 'api.refunds-create',
			title: 'POST /v2/refunds',
			type: 'api',
			evidence: [ev({ observedAt: '2026-11-01T10:00:00.000Z' })]
		},
		{
			rel: 'builds',
			direction: 'in',
			id: 'pipeline.ci',
			title: 'payments-api CI',
			type: 'pipeline',
			evidence: []
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
				via: 'api.refunds-create',
				evidence: []
			}
		],
		itCallsYours: []
	},
	confirmed: { facts: 0, of: 0 },
	notKnown: [],
	fullPage: null,
	updatedAt: null
};

describe('the dev portal in words', () => {
	it('puts the facts that touch your things first, then the newest', () => {
		const facts = factsOf(service);
		expect(facts.map((f) => [f.text[0] + (f.other?.title ?? '') + f.text[1], f.yours])).toEqual([
			['payments-api exposes POST /v2/refunds', true],
			['payments-api calls ledger-service', false],
			['Moved to Node 22.', false]
		]);
	});

	it('says where a fact was seen', () => {
		expect(
			receipt(
				ev({
					repository: 'payments-api',
					path: 'openapi/payments.yaml',
					lines: '212-240',
					commit: '9f3c2ab9d'
				})
			)
		).toBe('payments-api/openapi/payments.yaml:212-240 @ 9f3c2ab');
		expect(receipt(ev({ source: 'runtime', sourceRef: 'larkspur-prod' }))).toBe('larkspur-prod');
		expect(receipt(ev({ source: 'docs', url: 'https://wiki.larkspur.test/x' }))).toBe(
			'wiki.larkspur.test'
		);
		expect(receipt(ev({ source: 'person' }))).toBe('a person said so');
	});

	it('names an API by its method and path, and links to its page here', () => {
		expect(
			recordName({
				title: 'Create refund',
				attributes: [
					{ key: 'method', value: 'POST' },
					{ key: 'path', value: '/v2/refunds' }
				]
			})
		).toBe('POST /v2/refunds');
		expect(recordName({ title: 'payments-api' })).toBe('payments-api');
		expect(portalHref('payments', 'api.refunds-create')).toBe(
			'/portal/payments/api.refunds-create'
		);
	});

	it('sets what crews mark as code as code', () => {
		expect(ticks('must carry a `reason_code`; ok')).toEqual([
			{ code: false, text: 'must carry a ' },
			{ code: true, text: 'reason_code' },
			{ code: false, text: '; ok' }
		]);
	});
});
