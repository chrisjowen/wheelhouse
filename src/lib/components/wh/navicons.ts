import type { Component } from 'svelte';
import type { SectionKey } from '$lib/nav';
import {
	Blocks,
	BookOpen,
	LibraryBig,
	MessageCircleQuestionMark,
	MessagesSquare,
	RadioTower,
	Ship,
	ShipWheel,
	UsersRound
} from '@lucide/svelte';

/** Each main section's icon, in the left-hand menu and a phone's menu drawer. */
export const sectionIcons: Record<SectionKey, Component> = {
	firstmate: MessagesSquare,
	crew: UsersRound,
	harbour: Ship,
	decisions: MessageCircleQuestionMark,
	documents: LibraryBig,
	remotes: RadioTower,
	fleet: ShipWheel,
	logbook: BookOpen,
	plugins: Blocks
};
