---
id: ADR-006
title: File-system contracts and operation journal
status: Accepted
date: 2026-10-13
---

## Context

External scripts and the operator's habits depend on the per-folder `L/`, `R/` and `CUSTOM/` layout, on `<video>.json` jobs and on `<prefix>resultsMD5.txt`. Undo existed only for the last video. Destructive image edits had partial undo.

## Decision

- **Keep the per-folder layout.** Folder names are configurable; the defaults are `L`, `R`, `CUSTOM`, `md5Purge`, `bkp`, `ruimFolder`.
- **Moves:**
  - collision-safe: never overwrite; add ` (n)` before the extension;
  - a sidecar `<file>.json` moves with its file;
  - recursive sessions prefix the name with the source sub-folder path, separators removed;
  - the file name is limited to 255 characters by trimming the start and keeping the end, as the legacy code did.

  Moves use `fs.rename`, falling back to copy + unlink across devices.
- **Journal:** every move, copy, trash and in-place write appends a JSON line to `<root>/.mediamaloi/journal.jsonl`: `{ id, ts, op, from, to, sidecars[], backup?, sessionId }`. `backup` is the `bkp/` copy that an in-place edit created.
- **Undo is one rule for both triage workspaces.** It matches the legacy positional undo when items are handled in order.
  - Each workspace session keeps a **LIFO decision stack**. Every decision is pushed: move-L, move-R, CUSTOM, skip (cursor only), copy-personal.
  - `B` / `↑` pops the latest decision. A move is reversed through the journal: the file and its sidecar go back to the original path, and a compensating entry is appended. Then the cursor returns to that item. A skip only moves the cursor back.
  - Trash (Shift+Del) is **not** pushed, and it can never be undone, as in the legacy app.
  - In-place edits (crop, rotate) are not decisions. They are undone with their own command (un-crop restores from `bkp/`).
  - When the stack is empty, for example after the app restarts, undo falls back to the **latest undoable journal entry for this root**. It reverses that entry and puts the item back into the session if it is part of it.
- **Trash:** `shell.trashItem`.
- **In-place image edits** (crop, rotate) first copy the original to `bkp/` (unless a backup already exists) and record a journal entry. Un-crop restores the file from `bkp/`.
- **Session scanning skips** the destination folders, `.mediamaloi/` and the thumbnail cache.

## Consequences

- Undo works across app restarts.
- Folders created by the legacy app keep working without migration.
