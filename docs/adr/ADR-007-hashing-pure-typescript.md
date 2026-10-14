---
id: ADR-007
title: Duplicate hashing in pure TypeScript
status: Accepted
date: 2026-10-13
---

## Context

The legacy duplicate finder computes six keys per file or video frame: `md5`, `pureMD5`, `hash16`, `hash8`, `thumbLight` and `thumbDark`. It uses OpenCV, numpy and imagehash. Bit-identical hashes were needed only for the MongoDB `thummd5*` fields, and MongoDB is out of scope. The owner chose pure TypeScript.

## Decision

- Compute in main with **Node crypto + sharp + ffmpeg** (frames as raw RGB). Follow the legacy steps as closely as the libraries allow:
  - resize to 64×64, crop 12 px on each side;
  - colour when the file has a JPEG/PNG trailer, grey otherwise;
  - average-hash at 16 and 8;
  - 2×2 box blur, then threshold at 136 / 115, then MD5.

  Use the same video frame sampling (10 %, 9.7–10.3 % every 600 ms, the first 5 s at 1 fps) and one CSV row per frame.
- **The same CSV file name and columns** as LEG §2.3. Legacy CSVs still load and group. Each key is grouped only against values from the same CSV, so mixing hash origins needs a rebuild. "Concat other data" warns about this.
- Hashing runs behind a **`HashProvider` interface**. A Python/OpenCV sidecar can be added later if DB compatibility comes back.
- `md5` (whole file) stays byte-identical to the legacy value.

## Consequences

- The perceptual keys are not bit-identical to legacy values. Re-scan old folders for accurate grouping.
- No Python at runtime.

## Addendum 2026-10-14: per-folder CSV name, non-destructive rebuild, safe clean (review H4, M7)

- **CSV name.** New files are `<folderName>_<prefix>resultsMD5.txt` (`Photos_img_resultsMD5.txt`) next to the scanned folder, so scanning sibling folders no longer overwrites one shared `img_resultsMD5.txt`. A drive root keeps the legacy name inside the root. The columns and the `.meta.json` sidecar are unchanged.
- **Legacy name.** Loading by folder prefers the per-folder file and falls back to the legacy `<prefix>resultsMD5.txt` (the existing foreign-root guard still applies). The app never writes or deletes the legacy file.
- **Rebuild deletes nothing first.** `hashing:rebuild` is the same scan as `hashing:build`: rows go to `<csv>.tmp` and are renamed over the CSV only when the scan completes. Cancel or failure keeps the previous CSV.
- **Clean.** "Clean" copies the CSV to `<csv>.bak` before it rewrites it. It refuses with a `VALIDATION` error when a row root folder does not exist (unmounted drive, moved folder) or when it would remove every row.
