---
id: ADR-001
title: Scope of build 1
status: Accepted
date: 2026-10-13
---

## Context

The legacy suite has four Python projects. The owner asked to recreate `choicevideos` and the projects it depends on, and to ignore YOLOv5 and MongoDB for now.

## Decision

Build these workspaces: Video Triage, Image Triage, Cutter, Jobs, Duplicates (local only), Settings, plus the Crop, Zoom and F1 Help dialogs (docs/SPEC.md §2).

Excluded: every AI feature (YOLOv5, auto-choice, IA split, preprocessIMG), every MongoDB feature, the recognition annotation workspace, and email extraction.

## Consequences

- No Python runtime is needed.
- Controls that existed only for AI or DB features are left out, not stubbed.
- Two seams stay open for later work: a `HashProvider` interface (ADR-007) and hook points (ADR-008).
