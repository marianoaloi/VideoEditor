---
id: ADR-002
title: Stack and project layout
status: Accepted
date: 2026-10-13
---

## Context

The target is Electron + React + Redux Toolkit + TypeScript. The development machine is Windows 11 with Node 22 and npm. pnpm isn't installed. The owner chose MUI.

## Decision

- **One npm package** in the repository root, scaffolded with **electron-vite** (main, preload and renderer builds) and packaged with **electron-builder**. No monorepo.
- **React** (current major) + **Redux Toolkit** (slices, `createAsyncThunk`, listener middleware) + **react-redux**.
- **MUI** (`@mui/material`, `@mui/icons-material`, Emotion) with a **dark theme**. It provides the two-thumb `Slider`, dialogs, menus and snackbars.
- **TypeScript strict** everywhere. **zod** schemas at every boundary (IPC, disk JSON, CSV rows, settings), with types inferred from the schemas.
- Canvas work (crop, zoom): **react-konva**. Large lists: **@tanstack/react-virtual**.
- Tests: **Vitest** (node environment for `src/main` and `src/shared`, jsdom for `src/renderer`) + **Testing Library**. End-to-end: **Playwright `_electron`**.
- Path aliases: `@shared/*` → `src/shared/*`, `@main/*` → `src/main/*`, `@renderer/*` → `src/renderer/src/*`.
- `src/shared/**` must run in both Node and the browser, so it can't import `node:*` or `electron`.

## Consequences

- One `npm install`, one `npm run build`.
- The shared pure logic (job schema, ffmpeg args builder, estimates, naming, grouping) is unit-testable without Electron.
