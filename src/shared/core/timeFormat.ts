/**
 * Display formatting shared by InfoBar, TimeRanges, Duplicates and Image Triage.
 * `formatSize` is the legacy `Util.formatSize` (UT:19-29) including Python's half-even `%.2f`;
 * `formatMillis` is `hms` without the legacy 24 h wrap (hours keep counting).
 */

const KIB = 1024

/** `n / divisor` as Python's `'%.2f' % (n / divisor)` prints it (exact binary value, ties to even). */
function fixed2(n: number, divisor: number): string {
  const scaled = n * 100
  let whole = Math.floor(scaled / divisor)
  const remainder = scaled - whole * divisor
  const twice = remainder * 2
  if (twice > divisor || (twice === divisor && whole % 2 === 1)) whole += 1
  const intPart = Math.floor(whole / 100)
  const frac = String(whole % 100).padStart(2, '0')
  return `${intPart}.${frac}`
}

/** 1023 → `1023.00B`, 1536 → `1.50K`, 52428800 → `50.00M`, 2^30 → `1.00G`, ≥ 1 TiB → `<bytes>B`. */
export function formatSize(bytes: number): string {
  const b = Math.max(0, Math.trunc(bytes))
  if (b < KIB) return `${fixed2(b, 1)}B`
  if (b < KIB ** 2) return `${fixed2(b, KIB)}K`
  if (b < KIB ** 3) return `${fixed2(b, KIB ** 2)}M`
  if (b < KIB ** 4) return `${fixed2(b, KIB ** 3)}G`
  return `${b}B`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * `HH:MM:SS`, or `HH:MM:SS.mmm` with `{ millis: true }`. Negative or non-finite input gives zero.
 * 3723000 → `01:02:03`; 90061000 → `25:01:01` (hours are not wrapped).
 */
export function formatMillis(ms: number, options: { millis?: boolean } = {}): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : 0
  const totalSeconds = Math.floor(total / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const base = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  return options.millis === true ? `${base}.${String(total % 1000).padStart(3, '0')}` : base
}

/** Same as `formatMillis(seconds * 1000)`; the legacy `hms` took seconds. */
export function hms(seconds: number): string {
  return formatMillis(seconds * 1000)
}

/**
 * Parses `HH:MM:SS(.mmm)`, `MM:SS` or plain seconds (`90`, `1.5`) into milliseconds.
 * Returns `null` for anything else (the range editor's typed-time field).
 */
export function parseTimeInput(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  const parts = t.split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + Number(part)
  return Math.round(seconds * 1000)
}
