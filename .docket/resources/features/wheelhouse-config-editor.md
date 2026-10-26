---
id: feature.wheelhouse-config-editor
type: feature
title: .wheelhouse configuration editor

status: planned

tags:
  - wheelhouse
  - config
  - editor
  - ui
  - passages

links:
  - rel: part_of
    target: project.wh-build-insight
    evidence:
      - source: conversation
        session: 54991214-0be1-4605-986b-df9cde72921e
        observedAt: 2026-10-26
        observedBy: claude
        note: User intent requires way to edit .wheelhouse to add more stages

evidence:
  - source: conversation
    session: 54991214-0be1-4605-986b-df9cde72921e
    observedAt: 2026-10-26
    observedBy: claude
    note: >
      User intent: "I want a way to edit the .wheelhouse here to add more stages etc and test
      this out, add some arbertory step to do a 'local deploy' a k8s local deployment for
      casebook only". Need UI for editing .wheelhouse.yaml configuration and adding custom
      build stages.

provenance:
  capturedBy: claude
---

# .wheelhouse configuration editor

UI within Wheelhouse to edit the .wheelhouse.yaml configuration file and define custom build
stages. This enables captain to manage passages (build stages) and add new observational checks
without leaving the Wheelhouse interface.

Status: Planned, not yet implemented in fm/wh-build-insight branch.
