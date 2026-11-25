import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	readSessionAnswer,
	RECHECK_MS,
	RemoteSession,
	resumeHref,
	SESSION_PATH
} from './remote-session.svelte';
import { LOST_AFTER_MS, watchedStream } from './stream';

const RESUME = 'https://fleetyard.io/resume/mac';

describe('the gateway’s answer about a relay session', () => {
	it('reads live, offline and ended, with where to sign in again', () => {
		expect(
			readSessionAnswer({ live: true, machine: 'online', expiresAt: 1, resume: RESUME })
		).toEqual({ state: 'live', resume: RESUME });
		expect(readSessionAnswer({ live: true, machine: 'offline' })).toEqual({
			state: 'offline',
			resume: null
		});
		expect(readSessionAnswer({ live: false, resume: RESUME })).toEqual({
			state: 'ended',
			resume: RESUME
		});
	});

	it('is nothing when it is not such an answer, and never resumes at a script', () => {
		expect(readSessionAnswer(null)).toBeNull();
		expect(readSessionAnswer({ error: 'not found' })).toBeNull();
		expect(readSessionAnswer({ live: false, resume: 'javascript:alert(1)' })).toEqual({
			state: 'ended',
			resume: null
		});
	});

	it('signs in again back at this page, at the gateway’s resume page or its own', () => {
		const at = { pathname: '/tasks/a b', search: '?tab=chat' };
		expect(resumeHref(RESUME, at)).toBe(`${RESUME}?next=%2Ftasks%2Fa%20b%3Ftab%3Dchat`);
		expect(resumeHref(null, at)).toBe('/__whc/resume?next=%2Ftasks%2Fa%20b%3Ftab%3Dchat');
	});
});

/** A gateway that answers /__whc/session with `answer`, and other requests with `other`. */
function gateway() {
	const g = {
		answer: { live: true, machine: 'online', resume: RESUME } as unknown,
		other: () => new Response('{}', { status: 200 }) as Response,
		asked: 0,
		fetch: vi.fn(async (input: RequestInfo | URL) => {
			if (String(input) === SESSION_PATH) {
				g.asked++;
				return new Response(JSON.stringify(g.answer), { status: 200 });
			}
			return g.other();
		})
	};
	return g;
}

class FakeSource {
	static CLOSED = 2;
	static all: FakeSource[] = [];
	readyState = 0;
	listeners = new Map<string, (() => void)[]>();
	constructor() {
		FakeSource.all.push(this);
	}
	addEventListener(type: string, fn: () => void) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
	}
	fail() {
		this.readyState = FakeSource.CLOSED;
		for (const fn of this.listeners.get('error') ?? []) fn();
	}
	close() {}
}

let g: ReturnType<typeof gateway>;
let stops: (() => void)[];
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
	vi.useFakeTimers();
	g = gateway();
	stops = [];
	FakeSource.all = [];
	vi.stubGlobal('fetch', g.fetch);
	vi.stubGlobal('EventSource', FakeSource);
});

afterEach(() => {
	for (const stop of stops) stop();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function started(relayed = true) {
	const s = new RemoteSession();
	stops.push(s.start(relayed));
	return s;
}

describe('a page that came through Wheelhouse Cloud', () => {
	it('asks the gateway when a stream is lost, and changes nothing while the session is live', async () => {
		const s = started();
		stops.push(
			watchedStream(
				'/api/events',
				() => {},
				() => {}
			)
		);
		FakeSource.all[0].fail();
		await settle();
		expect(g.fetch).toHaveBeenCalledWith(
			SESSION_PATH,
			expect.objectContaining({ cache: 'no-store' })
		);
		expect(s.state).toBe('live');
		expect(s.resume).toBe(RESUME);
	});

	it('says the machine is offline and keeps asking until it is back', async () => {
		const s = started();
		g.answer = { live: true, machine: 'offline', resume: RESUME };
		await s.check();
		expect(s.state).toBe('offline');
		await vi.advanceTimersByTimeAsync(RECHECK_MS);
		expect(g.asked).toBe(2);
		g.answer = { live: true, machine: 'online', resume: RESUME };
		await vi.advanceTimersByTimeAsync(RECHECK_MS);
		expect(s.state).toBe('live');
		await vi.advanceTimersByTimeAsync(RECHECK_MS * 3);
		expect(g.asked).toBe(3);
	});

	it('says the session ended when the gateway does, and stays ended', async () => {
		const s = started();
		g.answer = { live: false, resume: RESUME };
		await s.check();
		expect(s.state).toBe('ended');
		g.answer = { live: true, machine: 'online' };
		await vi.advanceTimersByTimeAsync(RECHECK_MS * 2);
		await s.check();
		expect(s.state).toBe('ended');
	});

	it('hears an ended session from any request answered 401 with X-WHC-Session: ended', async () => {
		const s = started();
		g.answer = { live: false, resume: RESUME };
		g.other = () => new Response('', { status: 401, headers: { 'x-whc-session': 'ended' } });
		const res = await fetch('/api/fleet');
		expect(res.status).toBe(401);
		expect(s.state).toBe('ended');
		await settle();
		expect(s.resume).toBe(RESUME);
	});

	it('takes a plain 401 for what it is', async () => {
		const s = started();
		g.other = () => new Response('', { status: 401 });
		await fetch('/api/fleet');
		expect(s.state).toBe('live');
		expect(g.asked).toBe(0);
	});

	it('asks at most every so often while streams keep failing', async () => {
		const s = started();
		await s.check();
		await s.check();
		expect(g.asked).toBe(1);
		await vi.advanceTimersByTimeAsync(RECHECK_MS);
		await s.check();
		expect(g.asked).toBe(2);
	});

	it('changes nothing when the gateway does not answer (an older one, or none)', async () => {
		const s = started();
		g.fetch.mockImplementation(async () => new Response('not found', { status: 404 }));
		await s.check();
		expect(s.state).toBe('live');
		expect(s.resume).toBeNull();
	});

	it('signs in again at the resume page, moving the window that frames it', async () => {
		const s = started();
		g.answer = { live: false, resume: RESUME };
		await s.check();
		const top = { location: { href: '' } };
		vi.stubGlobal('top', top);
		history.replaceState(null, '', '/tasks/t-1?tab=chat');
		s.signIn();
		expect(top.location.href).toBe(`${RESUME}?next=${encodeURIComponent('/tasks/t-1?tab=chat')}`);
	});
});

describe('a page served on this computer', () => {
	it('never asks the gateway, nor watches requests', async () => {
		const s = started(false);
		stops.push(
			watchedStream(
				'/api/events',
				() => {},
				() => {}
			)
		);
		FakeSource.all[0].fail();
		await vi.advanceTimersByTimeAsync(LOST_AFTER_MS);
		await s.check();
		expect(g.asked).toBe(0);
		expect(globalThis.fetch).toBe(g.fetch);
	});
});
