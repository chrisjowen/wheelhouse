import type { GatewayChannel } from '../../gateway';

/**
 * A chat channel the gateway talks through. Adapters are transports only:
 * they connect out to their platform (never listening on a port), turn its
 * events into InboundEvents and send what the core hands them. They never see
 * Firstmate, the fleet or any credential but their own bot token; who may
 * talk to Firstmate, and what a message or a button does, is the core's call
 * (gateway.ts).
 */

/** A platform user id: immutable (Discord's snowflake), never a username. */
export type PeerId = string;

/** Where a message went: the chat (Discord: the DM channel) and the message's id in it. */
export interface SentRef {
	chat: string;
	id: string;
}

/** The account a message goes to, and its direct-message chat when known. */
export interface Peer {
	id: PeerId;
	dm: string | null;
}

export type InboundEvent =
	| {
			kind: 'text';
			/** The platform's message id: the message's request id is made from it, so a redelivery repeats nothing. */
			id: string;
			from: PeerId;
			/** The sender's display name, for Settings; never used to decide anything. */
			fromName: string;
			/** Sent in a direct message to the bot (not in a server channel). */
			dm: boolean;
			chat: string;
			text: string;
			/** The message it replies to, when the captain replied to one. */
			inReplyTo: SentRef | null;
			/** It carried attachments, stickers, embeds or a forward, none of which is passed on. */
			extras: boolean;
	  }
	| {
			kind: 'button';
			/** The press's own id (unique per press; a redelivered press keeps it). */
			id: string;
			from: PeerId;
			fromName: string;
			dm: boolean;
			chat: string;
			/** The opaque token the button carries. */
			token: string;
			/** The message the button is on. */
			message: SentRef | null;
			/** What the adapter needs to acknowledge the press; opaque to the core and never logged. */
			handle: string;
	  };

export type ButtonEvent = Extract<InboundEvent, { kind: 'button' }>;

export type OutboundButton =
	| { label: string; token: string; style?: 'primary' | 'secondary' | 'danger' }
	| { label: string; url: string };

export interface OutboundMessage {
	text: string;
	buttons?: OutboundButton[];
	/** Send it as a reply to this message. */
	replyTo?: SentRef | null;
}

export interface ChannelHealth {
	state: 'connected' | 'connecting' | 'down';
	reason: string | null;
	/** The bot's own account, once known. */
	self: { id: string; name: string } | null;
}

export interface ChannelAdapter {
	readonly channel: GatewayChannel;
	/** The longest text one message may carry, and the most buttons. */
	readonly limits: { text: number; buttons: number };
	/**
	 * Connect out and stay connected, reconnecting with a backoff, until the
	 * signal aborts; resolves then, or when the platform refuses for good (a
	 * revoked token), with health() saying why. Events go to `sink`, which the
	 * adapter does not wait on.
	 */
	run(sink: (e: InboundEvent) => void, signal: AbortSignal): Promise<void>;
	send(to: Peer, m: OutboundMessage): Promise<SentRef>;
	/** Replace a sent message's text and buttons, e.g. to settle it once a button was used. */
	update(ref: SentRef, m: OutboundMessage): Promise<void>;
	/** Put a reaction on a message (delivery and read marks). */
	react(ref: SentRef, emoji: string): Promise<void>;
	/**
	 * Acknowledge a button press, within the platform's deadline (Discord's is
	 * three seconds). With text, answer only the presser and leave the message
	 * as it is; without, the message is about to be updated.
	 */
	ack(e: ButtonEvent, text?: string): Promise<void>;
	health(): ChannelHealth;
}
