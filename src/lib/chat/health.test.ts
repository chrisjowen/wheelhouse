import { describe, expect, it } from 'vitest';
import type { Harbour } from '$lib/harbour';
import type { TaskSummary } from '$lib/types';
import { shipHealth } from './health';

const t = (status: string) => ({ id: status, status }) as unknown as TaskSummary;
const h = (o: Partial<Harbour> = {}): Harbour => ({
	needsYou: [],
	waitingOnFirstmate: [],
	underWay: [],
	queued: [],
	landedRecent: [],
	landedOlder: [],
	trouble: [],
	live: null,
	stepFailed: [],
	...o
});

describe('shipHealth', () => {
	it('says the worst thing first', () => {
		expect(shipHealth(h({ stepFailed: [t('working')], needsYou: [t('needs-review')] }))).toEqual({
			label: 'Something failed',
			tone: 'danger'
		});
		expect(shipHealth(h({ trouble: [t('failed')] })).tone).toBe('danger');
		expect(shipHealth(h({ needsYou: [t('a'), t('b')], trouble: [t('lost')] })).label).toBe(
			'2 need you'
		);
		expect(shipHealth(h({ needsYou: [t('a')] })).label).toBe('1 needs you');
		expect(shipHealth(h({ trouble: [t('blocked')] })).tone).toBe('warning');
		expect(shipHealth(h())).toEqual({ label: 'All well', tone: 'success' });
	});
});
