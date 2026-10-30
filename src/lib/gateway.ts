import type { AlertKind } from './types';

/**
 * The messaging gateway, as the browser sees it: which chat channels can reach
 * Firstmate from the captain's phone, whether each is connected, and who it is
 * paired with. The bot token itself never leaves the server.
 */

export type GatewayChannel = 'discord';

export const GATEWAY_CHANNELS: { channel: GatewayChannel; label: string }[] = [
	{ channel: 'discord', label: 'Discord' }
];

/** The bell alerts a newly set up channel sends: the moments worth a phone buzz. */
export const DEFAULT_GATEWAY_ALERTS: readonly AlertKind[] = ['question', 'pr-green', 'stuck'];

/** How long a pairing code works. */
export const PAIRING_MS = 10 * 60_000;

/**
 *   off         turned off (`wheelhouse gateway off`, or the switch in Settings)
 *   no-token    no bot token is set yet (`wheelhouse gateway connect discord`)
 *   connecting  connecting, or reconnecting after a drop
 *   connected   connected and listening for the captain's messages
 *   down        stopped: the reason says why and what fixes it
 */
export type GatewayState = 'off' | 'no-token' | 'connecting' | 'connected' | 'down';

export interface GatewayChannelView {
	channel: GatewayChannel;
	label: string;
	/** A bot token is set. */
	token: boolean;
	/** Where it is kept: the macOS Keychain, or the file named. */
	tokenStore: string | null;
	enabled: boolean;
	state: GatewayState;
	reason: string | null;
	/** The bot the token belongs to, once it has connected. */
	bot: { id: string; name: string } | null;
	/** The one account whose messages reach Firstmate; nobody else's do. */
	paired: { id: string; name: string; at: string } | null;
	/** A pairing code is waiting to be sent to the bot (the code is shown only once, to the page that asked). */
	pairing: { expiresAt: string } | null;
	/** Why the last pairing stopped early, e.g. too many wrong codes. */
	pairingNote: string | null;
	/** Which bell alerts it sends. */
	alerts: AlertKind[];
	/** Alerts and decisions go as their titles only, without their text. */
	titlesOnly: boolean;
}

export interface GatewayView {
	schema: 'wheelhouse-gateway.v1';
	available: boolean;
	reason: string | null;
	/** Where the gateway's settings live. */
	settingsDir: string | null;
	channels: GatewayChannelView[];
}

/** A pairing code as the captain types it: the letters, without spaces or the dash. */
export function normaliseCode(text: string): string {
	return text.replace(/[\s-]/g, '').toUpperCase();
}
