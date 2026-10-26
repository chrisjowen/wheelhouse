---
id: decision.wh-text-on-solid-backgrounds
type: decision
title: Put all text on solid white/card backgrounds in Wheelhouse UI

tags:
- wheelhouse
- ui
- design
- readability

evidence:
  - source: conversation
    session: d319d381-8e54-4070-84ad-cce74fe19f5c
    observedAt: '2026-10-26'
    observedBy: claude
    note: >-
      User intent stated: "Small design improvement on wheelhouse, anywhere there is text should
      be a card or white bg (light mode). Its hard to see text on the grid." User confirmed
      after implementation: "text on white looks good".

provenance:
  capturedBy: claude
---

# Put all text on solid white/card backgrounds in Wheelhouse UI

## Decision

All text in the Wheelhouse UI (page headings, intros, empty states, lists, chat, insights, Spec tab, passage editor, task page's Docs tab, and other content surfaces) should sit on solid white or card backgrounds instead of directly on the graph-paper grid.

## Context

Wheelhouse's design draws a faint 48px graph-paper grid on the main background. Side panels are solid surfaces, but several text areas previously sat directly on the grid, making text hard to read and reducing contrast.

## Why

Text legibility and visual hierarchy. The grid provides aesthetic continuity but is not a good surface for reading text. Solid backgrounds significantly improve readability and provide a distinct, professional presentation of content.

## Consequences

- Text in all views (page headings, docs, task details, chat, specs, passages, live consoles) now sits on white or card backgrounds
- The grid background remains visible behind non-text UI elements
- Docs tab now renders markdown as a proper document view (not inline)
- Live consoles are clickable to open full-screen (separate improvement validated alongside this one)

## Confirmation

User tested and confirmed (2026-10-26): "text on white looks good". All scenarios in the test phase passed.
