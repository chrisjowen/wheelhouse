---
id: feature.local-deploy-k8s-stage
type: feature
title: Local Kubernetes deployment stage for casebook

status: planned

tags:
  - wheelhouse
  - deployment
  - kubernetes
  - passages
  - casebook
  - local

links:
  - rel: part_of
    target: project.wh-build-insight
    evidence:
      - source: conversation
        session: 54991214-0be1-4605-986b-df9cde72921e
        observedAt: 2026-10-26
        observedBy: claude
        note: User intent requires local k8s deploy stage for testing

evidence:
  - source: conversation
    session: 54991214-0be1-4605-986b-df9cde72921e
    observedAt: 2026-10-26
    observedBy: claude
    note: >
      User intent: "add some arbertory step to do a 'local deploy' a k8s local deployment for
      casebook only". Custom Wheelhouse stage that deploys to local Kubernetes cluster for
      testing Casebook (captain's other SvelteKit+Postgres project in pnpm/moon monorepo).

provenance:
  capturedBy: claude
---

# Local Kubernetes deployment stage for casebook

A custom Wheelhouse build stage that deploys Casebook to a local Kubernetes cluster for testing
and validation. This allows the captain to verify changes in a realistic k8s environment during
development without pushing to remote environments.

Casebook is the captain's other project (SvelteKit + Postgres app in a pnpm/moon monorepo).

Status: Planned, not yet implemented. Requires .wheelhouse config editor feature to be usable.
