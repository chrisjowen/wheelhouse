import { afterEach, describe, expect, it, vi } from 'vitest';

const crews: { stop: ReturnType<typeof vi.fn> }[] = [];

vi.mock('./crew', () => ({
	Crew: class {
		alive = true;
		stop = vi.fn(() => (this.alive = false));
		constructor() {
			crews.push(this);
		}
		async start() {}
		on() {
			return () => {};
		}
	}
}));
vi.mock('./tools', () => ({ crewLaunch: async () => ({}) }));
vi.mock('./context', () => ({
	IN_FLIGHT: new Set<string>(),
	chatLines: () => [],
	digest: () => '',
	taskNotes: async () => ({ status: new Map(), reports: new Map() })
}));

const { endSession, liveSession, startSession, SWEEP_MS } = await import('./sessions');

const deps = {
	fleet: async () => ({ tasks: [] }) as never,
	inbox: async () => ({ cards: [] }) as never,
	records: () => [],
	home: '/nowhere',
	configDir: '/nowhere',
	env: { WHEELHOUSE_LIVE_CLAUDE: '/bin/true' }
};

afterEach(() => {
	vi.useRealTimers();
	crews.length = 0;
});

describe('live discussions', () => {
	it('ends an abandoned discussion on time, even when no other one starts', async () => {
		vi.useFakeTimers();
		const s = await startSession(deps);
		expect(liveSession(s.id)).not.toBeNull();
		vi.advanceTimersByTime(29 * 60_000);
		expect(crews[0].stop).not.toHaveBeenCalled();
		vi.advanceTimersByTime(2 * 60_000 + SWEEP_MS);
		expect(crews[0].stop).toHaveBeenCalled();
		expect(liveSession(s.id)).toBeNull();
		// Nothing is left running to check an empty set.
		expect(vi.getTimerCount()).toBe(0);
	});

	it('keeps a discussion in use', async () => {
		vi.useFakeTimers();
		const s = await startSession(deps);
		for (let i = 0; i < 4; i++) {
			vi.advanceTimersByTime(20 * 60_000);
			expect(liveSession(s.id)).not.toBeNull();
		}
		expect(crews[0].stop).not.toHaveBeenCalled();
		endSession(s.id);
		expect(crews[0].stop).toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
