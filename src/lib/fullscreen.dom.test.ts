import { describe, expect, it } from 'vitest';
import { fullscreen, inLayer, keepForLayer, layers } from './fullscreen.svelte';

describe('fullscreen', () => {
	it('draws the layer outside the panel it was opened in, and puts it away when closed', () => {
		const panel = document.createElement('div');
		panel.style.contain = 'layout';
		const layer = document.createElement('div');
		const inside = document.createElement('button');
		layer.append(inside);
		panel.append(layer);
		document.body.append(panel);

		const action = fullscreen(layer);
		expect(layer.parentElement).toBe(document.body);
		expect(layer.style.pointerEvents).toBe('auto');
		expect(layers.open).toBe(1);
		expect(inLayer(inside)).toBe(true);
		expect(inLayer(panel)).toBe(false);

		action.destroy();
		expect(layer.isConnected).toBe(false);
		expect(layers.open).toBe(0);
		panel.remove();
	});

	it('keeps focus moving inside a layer from a dialog’s focus trap', () => {
		const layer = document.createElement('div');
		const field = document.createElement('input');
		layer.append(field);
		document.body.append(layer);
		const trapped: EventTarget[] = [];
		const trap = (e: Event) => trapped.push(e.target!);
		document.addEventListener('focusin', trap, true);
		const action = fullscreen(layer);
		field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		expect(trapped).toEqual([]);
		action.destroy();
		document.body.append(layer);
		field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		expect(trapped).toEqual([field]);
		document.removeEventListener('focusin', trap, true);
		layer.remove();
	});

	it('keeps a dialog under a layer open', () => {
		const layer = document.createElement('div');
		document.body.append(layer);
		const action = fullscreen(layer);
		const away = new Event('pointerdown', { cancelable: true });
		keepForLayer(away);
		expect(away.defaultPrevented).toBe(true);
		action.destroy();
		const after = new Event('pointerdown', { cancelable: true });
		keepForLayer(after);
		expect(after.defaultPrevented).toBe(false);
	});
});
