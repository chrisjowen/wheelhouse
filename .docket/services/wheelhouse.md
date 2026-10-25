---
name: wheelhouse_service
description: Wheelhouse is the main application for managing and viewing no-mistakes build pipeline stages
metadata:
  type: service
  createdAt: "2026-10-25"
---

# Wheelhouse Service

Wheelhouse is the primary user-facing web application that displays and manages CI/CD pipeline stages, builds, tasks, and validation checks. It consists of multiple UI views and server-side components.

## Key Features

- **Firstmate Session**: One-pane interface showing live chat and task management
- **Harbor View**: Fleet board for viewing multiple tasks/builds
- **Checks Stage Visibility**: Shows validation steps and pipeline progress
- **Task Management**: Display of task pages with timeline of stage changes

## Architecture Components

### Frontend Components
- Rail components (first-mate rail cards)
- ChecksStrip: Slim step strip showing validation status on cards
- ChecksTimeline: Timeline view on task pages showing what each stage found/changed
- TaskCard: Card component displaying task information

### Server-Side Components
- Evidence collection (`src/lib/server/firstmate/evidence.ts`)
- NMStatus: Pipeline status model (`src/lib/server/firstmate/nmstatus.ts`)
- Collector: Data aggregation service
- Model: Core data model

### Configuration
- .wheelhouse.yaml: Configuration for passage stages and typed checks

## Evidence

- **Session**: 0d480bfa-88e0-49f6-a67d-2be65d30fe4a
- **Observed At**: 2026-10-25
- **Source**: conversation
- **Note**: Identified from branch `fm/wh-checks-visibility` featuring checks stage visibility implementation
