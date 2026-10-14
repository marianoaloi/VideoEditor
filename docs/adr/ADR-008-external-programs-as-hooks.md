---
id: ADR-008
title: External programs as configurable hooks
status: Accepted
date: 2026-10-13
---

## Context

The legacy suite hard-coded Java uploaders (`Upload4Shared`, `XVideo24Shared`), `movies.sh`, `insertUpload.py`, `delete.py` (MongoDB plus trash), VLC and `getimage`. It ran them through `shell=True` strings.

## Decision

- Hooks are named entries in Settings: `{ enabled, command, args: string[], cwd?, env?: Record<string, string> }`. All of them are **disabled by default**.
- An argument may contain placeholders: `{file}`, `{files}` (expands to several argv entries), `{dir}`, `{root}`, `{md5}`, `{outputs}`. They are substituted per argv entry, never by concatenating strings, and run with `spawn(command, args, { shell: false })`.
- *Amended (wave 3):* a bare command is resolved to an **absolute path from `PATH` only** (never the hook's working directory) before it is started. `hooks:preview` returns `warnings` when the command is a shell (`cmd`, `powershell`, `pwsh`, `sh`, `bash`, `zsh`), a `.cmd/.bat` file, or cannot be found. The built-in step of `deleteR` is computed in main from the session root and `folders.right` (or the image-triage R folder); the renderer's `dir`/`files` are accepted only when they lie directly inside that folder. `hooks:run` reports `builtIn: true` and the exit reports `trashed: N`, so "trashed N files, no command run" differs from "skipped". Hook processes are killed when the app quits.
- **`env` values** support the same placeholders. A list placeholder (`{files}`, `{outputs}`) becomes one string joined with `\n`, which is the Nautilus convention used by `NAUTILUS_SCRIPT_SELECTED_FILE_PATHS` (legacy `delete.py`, `insertUpload.py`) and by the `FixFiles` variable of `getimage`. The hook's `env` is merged over the parent environment.
- The hook names are:
  - `uploadOutputs` (after a job);
  - `uploadAll` (after the batch);
  - `moviesL` ("Clean queue and execute movie");
  - `uploadImagesL` (ImgChoice `L` key);
  - `deleteR`: built in, "send `R/` to trash", with an optional extra command;
  - `externalPlayer` (F8 / `+`);
  - `openList` (`getimage`).
- Hook output goes to the job log or a notification. A non-zero exit is reported.

## Consequences

- No credentials or machine-specific paths in code.
- On Windows the operator points the hooks at `.cmd`/`.bat` files or WSL commands as needed.
