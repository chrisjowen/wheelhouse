export const FIRSTMATE_SETTINGS_TOPICS = [
	{
		id: 'workers',
		name: 'Workers & instructions',
		blurb: 'What each worker is told and what it can reach.'
	},
	{
		id: 'agents',
		name: 'Agents & models',
		blurb: 'Which agent, model and effort Firstmate picks for each kind of work.'
	},
	{
		id: 'projects',
		name: 'Projects',
		blurb:
			'How each project’s work is checked, whether Firstmate may merge it, and how many workers it can take at once.'
	},
	{
		id: 'runtime',
		name: 'Runtime',
		blurb: 'Where workers run on this machine and how much work can run together.'
	},
	{
		id: 'mates',
		name: 'Second mates',
		blurb: 'Who this home routes work to, and which settings it says are shared.'
	},
	{
		id: 'preferences',
		name: 'Your preferences',
		blurb: 'What Firstmate has written down about how you like things done.'
	},
	{
		id: 'safety',
		name: 'Safety & accounts',
		blurb: 'Settings about worker permissions, accounts and the environment they receive.'
	}
] as const;

export type SettingsTopicId = (typeof FIRSTMATE_SETTINGS_TOPICS)[number]['id'];
