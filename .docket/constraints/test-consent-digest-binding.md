---
id: constraint.test-consent-digest-binding
type: constraint
title: Test panel command consent tied to displayed command digest
tags:
- command-checks
- passages
- test-consent
- ui-state

links:
- rel: governs
  target: feature.passage-editor-test-panel
  evidence:
  - source: conversation
    session: bbfea3ac-fdcf-492b-ac26-33e91a99f67b
    observedAt: '2026-10-26'
    observedBy: claude
    note: Review phase decision about test consent in passage editor

evidence:
- source: conversation
  session: bbfea3ac-fdcf-492b-ac26-33e91a99f67b
  observedAt: '2026-10-26'
  observedBy: claude
  note: |
    Code review finding review-2 from fm/wh-passage-editor branch
    (TestPanel.svelte line 60).
    
    The test panel's "Also run these commands" consent checkbox must be
    tied to the exact command list the captain saw when ticking the box,
    not to whatever commands are in the current draft.
    
    Race condition: captain sees command list A, ticks the checkbox,
    then edits A into B in the YAML view, and submits before the draft
    refreshes. Currently, B runs on the captain's machine, though the
    checkbox listed A.
    
    Fix: send the digest of the commands listed (commandsDigest of the
    draft's commands at the time of submission) with the test request.
    Server's dryRun endpoint must refuse with 409 when the digest differs
    from the actual text's commands, similar to the commands-consent endpoint.
    
    Also reset runCommands whenever the listed commands change, so the
    tick does not carry over to newly displayed commands.

provenance:
  capturedBy: claude
---

# Test panel command consent tied to displayed command digest

The test panel's "Also run these commands" checkbox must enforce that
the commands actually run match the exact list displayed when the captain
ticked the box.

## Problem

The test panel's `runCommands` checkbox stays ticked when the file's commands
change. The list of commands displayed comes from the debounced draft (300 ms
plus a network round trip). The server's `dryRun` endpoint runs every command
in the submitted text whenever `runCommands === true`, without verifying they
match what was displayed.

**Race condition**: The captain ticks the box while seeing command list A,
then edits A into B in the YAML editor and clicks "Run the test" before
the draft refreshes. B runs on the captain's machine, though the displayed
list showed A.

Even after the list refreshes, the old tick carries over to the new commands,
creating consent confusion.

## Implementation

- Send the digest of the commands listed (`commandsDigest` of the draft's
  commands at the time of test submission) with the test request.

- The server's `dryRun` endpoint (service.ts:705) must refuse with a 409
  status code when the submitted digest differs from the actual commands in
  the text, returning a clear message asking the captain to review again.

- Reset the `runCommands` state whenever the listed commands change, so the
  tick does not automatically carry to newly displayed commands.

## Testing

- Verify that ticking the checkbox with command list A and then editing
  to list B before submission causes the server to reject with 409.

- Verify that changing the commands resets the `runCommands` checkbox.

## Related

This constraint mirrors the behavior of the `commands-consent` endpoint
(which the captain must explicitly approve before running any commands),
ensuring test command execution requires deliberate, informed consent.
