/** What the Project links summary provider returns, and its Harbour card renders. */
export interface ProjectSummary {
	repoUrl: string | null;
	readme: { title: string; url: string | null } | null;
	pulls: { title: string; url: string; number: number | null; landed: boolean }[];
}
