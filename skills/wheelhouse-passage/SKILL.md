---
name: wheelhouse-passage
description: >-
  Add or change a project's Wheelhouse passage (the progress track a task walks: Queued → Building → … → Landed → Released/Deployed/On npm). Use whenever the captain asks for a step such as Released, On npm or Deployed on a project, when a project publishes an npm package or deploys and its passage stops at Landed, or when a passage step never reaches.
---

# Wheelhouse passage

A passage is the track of steps Wheelhouse shows for each task of a project. The built-in `ship` track ends at **Landed**. Anything after that (a release, an npm publish, a deploy) appears only once a passage file adds it, so changing how a project releases is not enough: its passage must say so too.

## Where the file lives

- **The captain's file** (use this by default): in Wheelhouse's config, one per project. It applies within a minute. Network checks in it need no consent; command checks still need the captain's approval.
- **The project's file**: `.wheelhouse.yaml` on the project's default branch, changed only through a pull request. Its network checks need the captain's consent on the passage page. The captain's file wins over the project's, which wins over the built-in.
- The format, with examples, is `docs/passages.md` in the Wheelhouse repository.

Never write either file by hand: the commands below check it and save it only over the version you read.

## Procedure

1. **Read the passage:** `wheelhouse passage show <project>` lists its steps, where each comes from, any errors, and what waits on the captain.
2. **Find out what the project really does** before picking a check; never invent an indicator.
   - npm: `npm view <package> dist-tags`, and the workflow that runs `npm publish`.
   - GitHub releases: `gh release list -R <owner>/<repo>`. A Released step reads GitHub Releases, not bare tags, and On npm takes its version from that release. A project that only pushes tags never reaches Released until its release process also publishes a GitHub release.
   - Deploys: the GitHub Actions workflow that deploys, or the GitHub deployment environment it records.
3. **Add the step from a preset** (most cases):

   ```sh
   wheelhouse passage add-step <project> released --dry-run
   wheelhouse passage add-step <project> released
   wheelhouse passage add-step <project> on-npm --package <npm-package>
   wheelhouse passage add-step <project> deployed --workflow <deploy.yml>   # or --environment <name>
   ```

   `--dry-run` prints the file it would save. It keeps everything already in the captain's file, checks the result and saves only over what it read.

4. **Anything a preset does not cover:** `wheelhouse passage get <project> > passage.yaml` (its digest goes to stderr), edit it, `wheelhouse passage check <project> passage.yaml`, then `wheelhouse passage apply <project> passage.yaml --base <digest>` (`--base new` for a file that does not exist yet). Exit 5 means it changed since you read it: read it again and redo the edit.
5. **Verify:** `wheelhouse passage show <project>` again: the new step is there and the captain's source applies with no errors.
6. **Confirm the step can reach:** its checks must find real data (a GitHub release containing the merge, the npm version). If the project's process does not produce that data yet, route the fix to whoever owns the project's release process, and say so.

## What stays the captain's

Consent for a project file's network checks, approval of command checks, and running a passage test (which can run commands and deploy) are the captain's calls on the project's passage page: `wheelhouse passage show` names what waits, and a refused command prints the page to open. Never fake a reached step or a consent.
