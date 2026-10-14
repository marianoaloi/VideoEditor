# VideoEditor: Functional Specification (build 1)

VideoEditor rewrites the Python/PyQt5 **Media Maloi** suite as one **Electron + React + Redux Toolkit + TypeScript** desktop app. It covers `choicevideos` plus the parts of `myvideos`, `mediacommonpackage` and `recognition` that `choicevideos` depends on.

| Source | Location |
|---|---|
| Legacy specification (binding for behaviour) | `C:/Users/maria/prj/Python/mediamaloi/PROJECTS_MIGRATION.md` (cited below as **LEG §n**) |
| Legacy code (read-only) | `C:/Users/maria/prj/Python/mediamaloi/{choicevideos,myvideos,mediacommonpackage/mediamaloipackage,recognition}` |
| Behaviour-parity notes (exact formulas, keys, argv) | `.swarm/research/*.md` |
| Decisions | `docs/adr/*.md` (binding) |

## 1. User and goals

A single operator curates large personal media collections (videos, images, GIFs) with the keyboard. **Throughput matters more than polish:** every action is one keystroke, the next item appears instantly, and the next items are prefetched (metadata, thumbnails, frames).

## 2. In scope

### 2.1 Workspaces

| Workspace | Replaces | LEG |
|---|---|---|
| **Video Triage** | ChoiceVideos (`choicevideos/main.py`, `mainwindow.ui`), MainForceFriend (VLC fallback player) | §5.1, §5.3 |
| **Image Triage** | ImgChoice (`choicevideos/getImg.py`, `imgChoice.ui`) **without AI** | §5.2 |
| **Cutter** | MyVideos (`myvideos/myvideos.py`), DialogResume | §4.1, §4.2 |
| **Jobs** | ExecuteConfiguratedFiles, cmdExecuteConfiguratedFiles, dragInDrop | §4.4, §5.3 |
| **Duplicates** | md5Files / TableWindow, localMD5 (**local only**, no DB) | §2.3, §4.5 |
| **Settings** | hard-coded paths, thresholds, hooks, ffmpeg paths | §11.3 |

Dialogs and overlays: **Crop** (CroppMedia, LEG §3.2), **Zoom viewer** (recognition `ZoomScreem` with no classes, LEG §6), **Help F1** (HelpComponent, LEG §3.3, scoped to the active workspace).

### 2.2 Features (LEG §7)

| # | Capability | Build 1 |
|---|---|---|
| F1 | Folder session: open (recursive), sort by size desc, filter by MIME, progressive load | Yes |
| F2 | Video triage L/R/skip/undo/trash, speed and seek controls with modifier multipliers | Yes |
| F3 | Image triage: multi-image strip, L/R history strips, editable destination names | Yes |
| F4 | Media info bar with colour thresholds and size/time estimates | Yes |
| F5 | Range editor (in/out, multiple ranges, split into N) | Yes |
| F6 | Crop / rotate / brightness / contrast on a frame, auto black-bar detection | Yes |
| F7 | Write the video job JSON, move to `CUSTOM/` | Yes |
| F8 | Batch transcoder: queue (2 workers), cut/concat, GPU→CPU and encoder fallbacks, logs | Yes |
| F9 | Post-process hooks: upload, `movies.sh`, delete `R/`, upload images | Yes, as **configurable hooks** (ADR-008) |
| F10 | Duplicate finder: 6 hash keys, grouped table, thumbnails, move | Yes, local only |
| F11 | Thumbnail / mosaic cache (4×4) | Yes |
| F12 | Fallback playback for formats Chromium can't decode | Yes (ADR-004) |
| F16 | Image quick-crop reuse and un-crop from `bkp/` | Yes |
| F17 | "Mark to delete" | Only as the delete-`R/` hook (send to trash). No DB. |
| F18 | Central keybinding registry plus F1 help, with conflict detection | Yes |

## 3. Out of scope for build 1

- **YOLOv5 / any AI**: F13, F15, `preprocessIMG`, "Split with IA", "Auto choice", "Open Config", model tags, AI boxes. Omit these controls. Don't leave dead buttons.
- **MongoDB**: "Analise with DB", "Mandatory has DB", Delete MD5 / Saved MD5, VIP accounts, marking posts `deleted`, `HaveToDeletes`, `fake_<id>` posts.
- **recognition annotation workspace** (F14). Ctrl+Shift+A, which opened annotation on a frame, is left unbound.
- Email extraction (`preprocessEMAIL`), the `getimage` external viewer (it is reachable only as an optional hook), and the dev scratch files listed in LEG §3.3 and §4.6.

Keep the seams so these can return later: a hash-provider interface (ADR-007) and hook points after moves and jobs (ADR-008).

## 4. File-system contracts (keep, LEG §2)

- **Folders** inside the session root: `L/` keep, `R/` reject, `CUSTOM/` video + job JSON, `md5Purge/` (or a typed name) duplicates, `bkp/` image originals before a crop or rotate, `ruimFolder/` unreadable files. The folder names come from Settings, with these defaults. The personal folder (`P` key) is a Setting with no default; the key is disabled until it is set.
- **Recursive open:** a file moved out of a sub-folder is renamed `<subfolderWithoutSeparators>_<name>`. Build names with path APIs. Never overwrite an existing file: on a collision, add a numeric suffix.
- **Job JSON `<video>.json`** (LEG §2.2): read both legacy formats. Write the current legacy key set (`filename, originalPath, crop, bright, contrast, transpose, mediaPath, convert, size, rate, avgrate, times, posExecution`) plus `"version": 2`. Outputs: cut → `<video>.<i>.mp4`, concat → `<video>.mp4`.
- **Hash CSV** `<prefix>resultsMD5.txt` (prefix `vdo_` / `img_` / `gif_`), same columns as LEG §2.3.
- **New:** `<root>/.mediamaloi/journal.jsonl`, an operation journal (move / copy / trash / write) that makes undo work across sessions.

## 5. Non-functional requirements

- Windows 11 is the primary target. The app must stay Linux-compatible: no `mv`/`find`/`ps`/`mimetype`, no splitting paths on `"/"`.
- **No shell strings, ever.** Spawn processes with argument arrays (LEG §9, §10).
- Long tasks (probe, thumbnails, hashing, ffmpeg) run in the main process with progress, cancellation and logs. The UI never blocks.
- Errors reach the operator (a snackbar or the job log). No silent `catch`.
- Destructive operations keep a backup or a journal entry. Never rewrite an image in place without a `bkp/` copy. Never silently convert formats.
- Fix the legacy bugs listed in LEG §9. Don't port them.

## 6. Acceptance criteria (LEG §12, without DB and AI)

1. The job JSON from LEG §2.2 loads and round-trips. The legacy `{definedSize, definedRate, times:[{st,du}], posExecution:"f"|"d"}` format loads.
2. The ffmpeg args builder produces the expected argv for cut, concat, crop, scale, transpose and eq. A cut produces `.0.mp4`/`.1.mp4`, a concat produces `.mp4`.
3. GPU encoder missing → the runner falls back to `libx264` and succeeds. A corrupt input → the copy-then-cut fallback runs. An output under 1000 bytes is reported as a failure.
4. Video Triage `A`/`F`/`D`/`B` move to `L/`, `R/`, nowhere, and undo (including the `.json` sidecar), with recursive-prefix naming.
5. `C` with no ranges writes `times=[[low,high]]` and moves the video to `CUSTOM/`.
6. The info bar colours and the `otimizedSize` / `otimizedTime` / `estimativesize` values match the formulas in `choicevideos/main.py` (`fillVideo`, `changeDurationSelected`).
7. Duplicate groups for each of the 6 keys match `MD5Files.processData` semantics. "Move to R" moves only the selected files.
8. Image quick-crop: after a crop the original is in `bkp/` and a quick-crop button exists. Ctrl+Shift+F applies the same crop to the next image. Ctrl+F restores the original.
9. No code path builds a shell command string from a file name.
10. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass, and the app starts on Windows.
