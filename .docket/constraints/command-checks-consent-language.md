---
id: constraint.command-checks-consent-language
type: constraint
title: Command check consent language must be honest about scope
tags:
- command-checks
- passages
- consent
- transparency

links:
- rel: governs
  target: service.wheelhouse-passages
  evidence:
  - source: conversation
    session: bbfea3ac-fdcf-492b-ac26-33e91a99f67b
    observedAt: '2026-10-26'
    observedBy: claude
    note: Review phase decision about consent UI transparency

evidence:
- source: conversation
  session: bbfea3ac-fdcf-492b-ac26-33e91a99f67b
  observedAt: '2026-10-26'
  observedBy: claude
  note: |
    Code review finding review-1(b) from fm/wh-passage-editor branch.
    
    Consent UI and documentation must plainly state that allowing command
    checks trusts the project's own scripts at the commit they run on.
    Consent covers the command line (argv), not the scripts those commands
    call, which can change through merged pull requests without turning
    off consent.
    
    Drop wording that implies any change to what runs turns consent off.
    Keep: changing a command line turns consent off again.
    
    Affects:
    - Passage page command consent section
    - Check form "Exactly what will run" panel  
    - docs/passages.md documentation
- source: conversation
  session: e064bb97-5455-413d-96c3-294df02036cb
  observedAt: '2026-10-26'
  observedBy: claude
  note: |
    Review phase (fm/wh-passage-editor branch, commits 1804faf→dd83a87) re-examined
    this constraint. Finding review-1 confirmed the core issue: commandsDigest covers
    only argv/folder/timeout/env/ref/when, not script content. Docs state "any change
    to one turns them off again" but this is inaccurate for script-only changes.
    Remedy needs captain's decision: either implement pinned worktrees to guarantee
    script consistency, or update consent UI and docs/passages.md to be honest that
    consent covers command line only, not script content.

provenance:
  capturedBy: claude
---

# Command check consent language must be honest about scope

The UI and documentation for consenting to command checks must clearly state
that consent covers the command line itself, not the scripts or behavior
those commands invoke at runtime.

## Rationale

The original wording implied that any change to what a command runs turns
consent off again. This is not accurate. If the command line (argv) stays
constant but the scripts it calls change (through a merged PR), the command
runs under the earlier consent. This is an important distinction that users
must understand to make informed consent decisions.

## Implementation

- Update the passage page's command consent section to state plainly:
  "Allowing command checks trusts the project's own scripts at the commit
  they run on. Consent covers the command line, not the scripts it calls,
  which can change through merged pull requests."

- Update the check form's "Exactly what will run" panel with similar
  transparent language.

- Update `docs/passages.md` to reflect this reality.

- Retain the statement that changing a command line turns consent off again.

- Remove wording that misleads users about what changes require new consent.

## Impact

This constraint ensures users understand the trust model for command checks
and can make informed security decisions about what scripts they authorize
to run.
