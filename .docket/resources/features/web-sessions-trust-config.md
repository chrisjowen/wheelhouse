---
id: feature.web-sessions-trust-config
type: feature
title: Pre-registration of Claude Code trust settings (questionable scope)

tags:
  - sessions
  - websocket
  - trust
  - scope-creep

attributes:
  status: flagged
  severity: warning

links:
  - rel: part_of
    target: feature.web-sessions-websocket
    evidence:
      - source: code
        path: src/lib/server/sessions/trust.ts
        lines: 60-90
        symbol: Trust pre-registration logic
        commit: 967deff
        observedAt: '2026-10-12'
        observedBy: claude
        session: 71583f35-026d-4285-99c2-39ccdd873ce1
        note: Called from sessions.ts:346 to pre-populate Claude Code's trust dialog before launch.

evidence:
  - source: conversation
    observedAt: '2026-10-12'
    observedBy: claude
    session: 71583f35-026d-4285-99c2-39ccdd873ce1
    note: Code review flagged trust pre-registration as a new component beyond the stated intent. The user intent only requires web-based sessions and in-browser editing, not pre-writing to the captain's global Claude config.

  - source: code
    path: src/lib/server/sessions/trust.ts
    lines: 60-90
    symbol: readAndModifyTrustConfig, renameSync
    commit: 967deff
    observedAt: '2026-10-12'
    observedBy: claude
    session: 71583f35-026d-4285-99c2-39ccdd873ce1
    note: Before every session launch, Wheelhouse reads, modifies, and writes the user's ${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json to set projects[<dir>].hasTrustDialogAccepted. This creates a lost-update window: a concurrent Claude Code process that rewrites the file between the fingerprint check and renameSync has its write overwritten. One entry per session accumulates in the file forever.

  - source: code
    path: src/routes/api/sessions/+server.ts
    lines: 40-50
    symbol: warning result plumbing
    commit: 967deff
    observedAt: '2026-10-12'
    observedBy: claude
    session: 71583f35-026d-4285-99c2-39ccdd873ce1
    note: Warning result from trust.ts is plumbed through sessions.ts, sessions.ts, client sessions.ts, new-session.svelte.ts, and displayed in the session page's warning banner.

provenance:
  capturedBy: claude
---

# Pre-registration of Claude Code trust settings

The web-sessions feature pre-writes trust dialog settings to the captain's
global Claude Code configuration (`.claude.json`) before launching each
session. This design choice goes beyond the stated user intent (streaming
sessions to the web with in-browser editing) and creates operational issues:

1. **Out-of-scope modification**: The captain can answer Claude's trust prompt
   directly in the Wheelhouse browser terminal, making pre-registration
   unnecessary.

2. **Lost-update race condition**: Between checking the file's fingerprint
   (trust.ts:66) and renaming it (trust.ts:67), a concurrently running Claude
   Code process can rewrite `.claude.json`, losing its changes. No conflict
   resolution exists.

3. **Unbounded file growth**: One `hasTrustDialogAccepted` entry accumulates
   in the config file per session, with no cleanup or consolidation.

## Recommendation

Remove the trust pre-registration feature unless the captain explicitly
requests it. The feature bloats the config file, modifies a file Wheelhouse
does not own (risk of version skew or schema drift), and is not required by
the user intent.

If pre-registration is needed, implement a better concurrency model (versioned
writes, CAS-style updates, or a separate trust store) and bound the config
file's growth.
