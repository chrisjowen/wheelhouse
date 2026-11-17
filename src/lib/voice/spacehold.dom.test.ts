import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { spaceToTalk, TALK_HOLD_MS } from './spacehold';

let area: HTMLElement;
let talk: { start: Mock<() => void>; stop: Mock<() => void> };
let detach: () => void;

const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit, on: EventTarget = window) => {
	const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
	on.dispatchEvent(e);
	return e;
};
const space = (type: 'keydown' | 'keyup', more: KeyboardEventInit = {}, on?: EventTarget) =>
	key(type, { code: 'Space', key: ' ', ...more }, on);

beforeEach(() => {
	vi.useFakeTimers();
	document.body.innerHTML = '<section id="chat"><input id="box" /></section><div id="else"></div>';
	area = document.getElementById('chat')!;
	talk = { start: vi.fn<() => void>(), stop: vi.fn<() => void>() };
	detach = spaceToTalk(area, talk);
	area.dispatchEvent(new Event('pointerenter'));
});

afterEach(() => {
	detach();
	vi.useRealTimers();
});

describe('hold Space to talk', () => {
	it('starts after the hold and stops when Space is let go', () => {
		space('keydown');
		vi.advanceTimersByTime(TALK_HOLD_MS - 1);
		expect(talk.start).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(talk.start).toHaveBeenCalledOnce();
		const up = space('keyup');
		expect(talk.stop).toHaveBeenCalledOnce();
		expect(up.defaultPrevented).toBe(true);
	});

	it('chimes when the mic comes on and again when it goes off', () => {
		const tones: number[] = [];
		const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
		const node = () => ({ connect: (n: unknown) => n, start() {}, stop() {} });
		vi.stubGlobal(
			'AudioContext',
			class {
				currentTime = 0;
				destination = {};
				createOscillator() {
					return {
						...node(),
						frequency: {
							...param,
							setValueAtTime: (f: number) => tones.push(f)
						}
					};
				}
				createGain() {
					return { ...node(), gain: param };
				}
			}
		);
		space('keydown');
		vi.advanceTimersByTime(TALK_HOLD_MS);
		space('keyup');
		vi.unstubAllGlobals();
		expect(tones).toHaveLength(2);
		expect(tones[1]).toBeLessThan(tones[0]);
	});

	it('leaves a short press as an ordinary Space', () => {
		const down = space('keydown');
		vi.advanceTimersByTime(TALK_HOLD_MS - 100);
		const up = space('keyup');
		vi.advanceTimersByTime(TALK_HOLD_MS);
		expect(down.defaultPrevented).toBe(false);
		expect(up.defaultPrevented).toBe(false);
		expect(talk.start).not.toHaveBeenCalled();
		expect(talk.stop).not.toHaveBeenCalled();
	});

	it('holds back key repeats while it waits, so no row of spaces or scrolling', () => {
		space('keydown');
		expect(space('keydown', { repeat: true }).defaultPrevented).toBe(true);
	});

	it('does nothing with the pointer outside the area', () => {
		area.dispatchEvent(new Event('pointerleave'));
		space('keydown');
		vi.advanceTimersByTime(TALK_HOLD_MS * 2);
		expect(talk.start).not.toHaveBeenCalled();
	});

	it('ignores Space with a modifier, and another key during the wait cancels it', () => {
		space('keydown', { shiftKey: true });
		vi.advanceTimersByTime(TALK_HOLD_MS);
		space('keydown');
		key('keydown', { code: 'KeyA', key: 'a' });
		vi.advanceTimersByTime(TALK_HOLD_MS);
		expect(talk.start).not.toHaveBeenCalled();
	});

	it('respects enabled', () => {
		detach();
		detach = spaceToTalk(area, { ...talk, enabled: () => false });
		area.dispatchEvent(new Event('pointerenter'));
		space('keydown');
		vi.advanceTimersByTime(TALK_HOLD_MS);
		expect(talk.start).not.toHaveBeenCalled();
	});

	it('stops when the window loses focus mid-talk', () => {
		space('keydown');
		vi.advanceTimersByTime(TALK_HOLD_MS);
		window.dispatchEvent(new Event('blur'));
		expect(talk.stop).toHaveBeenCalledOnce();
	});

	it('takes back the space the press typed into a text box', () => {
		const box = document.getElementById('box') as HTMLInputElement;
		box.value = 'hello ';
		box.setSelectionRange(6, 6);
		const typed = vi.fn();
		box.addEventListener('input', typed);
		space('keydown', {}, box);
		vi.advanceTimersByTime(TALK_HOLD_MS);
		expect(box.value).toBe('hello');
		expect(typed).toHaveBeenCalled();
		expect(talk.start).toHaveBeenCalledOnce();
	});

	it('takes back a typed space in an editable div', () => {
		const ed = document.createElement('div');
		ed.contentEditable = 'true';
		ed.textContent = 'hi\u00a0';
		area.append(ed);
		document.getSelection()!.collapse(ed.firstChild!, 3);
		space('keydown', {}, ed);
		vi.advanceTimersByTime(TALK_HOLD_MS);
		expect(ed.textContent).toBe('hi');
	});
});
