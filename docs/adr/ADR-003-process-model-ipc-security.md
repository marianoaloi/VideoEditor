---
id: ADR-003
title: Process model, typed IPC and security baseline
status: Accepted
date: 2026-10-13
---

## Context

The renderer shows untrusted media file names and metadata. The legacy code built shell strings from file names, which allowed injection (LEG §9, §10).

## Decision

- **Main process** owns all file-system, process, ffmpeg, hashing, settings and journal work.
- The **renderer** has no Node access: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- **Preload** exposes one generic, typed bridge `window.api`:
  - `invoke(channel, request)` for request/response;
  - `on(channel, listener)`, which returns an unsubscribe function, for events such as job progress or hash progress.

  Both check the channel against allowlists generated from `src/shared/ipc/contract.ts`.
- **The contract is split by domain** (`src/shared/ipc/channels/<domain>.ts`), so each module owner changes only its own file. `contract.ts` merges them.
- **Main validates every request with zod** before the handler runs. Errors cross IPC as a serialisable `{ code, message, details? }`.
- **Local media** reaches `<video>` and `<img>` through a privileged custom scheme `media://`, with HTTP Range support. It serves only files under an **allowlist**: open session roots, the thumbnail cache and temp frame files.
- **CSP** in `index.html`: `default-src 'self'`; scripts `'self'`; styles `'self' 'unsafe-inline'` (Emotion needs this); `img-src`/`media-src` `'self' data: blob: media:`.
- **Processes:** `child_process.spawn(cmd, argsArray, { shell: false })` only. `exec` and `shell: true` are never used. File names never go into a command string.
- **Drag and drop** paths come from `webUtils.getPathForFile` in preload.
- The app never navigates away and never opens new windows to remote content.

## Consequences

- Each feature adds channels in its own domain file, with request schemas.
- The `media://` handler must reject paths outside the allowlist and normalise paths before it checks them.
- *Amended (wave 3):* **a path from the renderer is never trusted on its own.** Folders become usable only through (a) a native dialog result, (b) an item dropped on the window (the preload reports `webUtils.getPathForFile` to main with a one-way message), (c) a root approved in an earlier run (`<userData>/approved-roots.json`), or (d) a folder inside one of those. Every channel that takes a path (`session:open`, `media:*`, `hooks:run`, and the jobs/hashing channels) goes through `ipc/pathGuard.ts`: UNC (`\\server\share`) and device (`\\?\`) paths are refused, and the real path (junctions and symlinks resolved, nearest existing ancestor for new files) must stay inside an allowed root. Session roots are granted to `media://` under both their lexical and real form. The IPC trust check requires the sender to be the main frame of the app window; the window denies every web permission request.
