/**
 * Hash CSV reader/writer (research duplicates-thumbs §3).
 *
 * Writes the legacy layout byte for byte: header `root,inFile,path,...`, Python `csv` excel
 * dialect (QUOTE_MINIMAL, CRLF after every row), `True`/`False`, empty cell = null, UTF-8 no BOM.
 * Reads by header NAME, so it also accepts the pandas `to_csv` layout (index `path` first, extra
 * `DB` column last), LF or CRLF, and quoted multi-line fields. Hashes stay opaque strings.
 */
import { HASH_CSV_COLUMNS, type HashCsvColumn, type HashRow } from '../domain/hash'

const NEEDS_QUOTES = /[",\r\n]/
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const EOL = CR + LF

function quoteField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function rowToFields(row: HashRow): string[] {
  return [
    row.root,
    row.inFile,
    row.path,
    row.md5 ?? '',
    row.pureMD5 ?? '',
    row.hash16 ?? '',
    row.hash8 ?? '',
    row.thumbLight ?? '',
    row.thumbDark ?? '',
    row.worksdWell ? 'True' : 'False',
    String(row.sizeFile),
    row.comments
  ]
}

export function csvHeaderLine(): string {
  return HASH_CSV_COLUMNS.join(',') + EOL
}

export function csvRowLine(row: HashRow): string {
  return rowToFields(row).map(quoteField).join(',') + EOL
}

export function serializeHashCsv(rows: readonly HashRow[]): string {
  return csvHeaderLine() + rows.map(csvRowLine).join('')
}

/** RFC 4180 style records; CRLF, LF and lone CR end a record; blank records are skipped. */
export function parseCsvRecords(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  let touched = false
  const endField = (): void => {
    record.push(field)
    field = ''
  }
  const endRecord = (): void => {
    if (touched || record.length > 0) {
      endField()
      if (!(record.length === 1 && record[0] === '')) records.push(record)
    }
    record = []
    touched = false
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (quoted) {
      if (ch !== '"') {
        field += ch
      } else if (text.charAt(i + 1) === '"') {
        field += '"'
        i++
      } else {
        quoted = false
      }
    } else if (ch === '"') {
      quoted = true
      touched = true
    } else if (ch === ',') {
      endField()
      touched = true
    } else if (ch === LF || ch === CR) {
      if (ch === CR && text.charAt(i + 1) === LF) i++
      endRecord()
    } else {
      field += ch
      touched = true
    }
  }
  endRecord()
  return records
}

type ColumnIndex = Partial<Record<HashCsvColumn, number>>

function indexHeader(header: readonly string[]): ColumnIndex {
  const index: ColumnIndex = {}
  header.forEach((name, i) => {
    const clean = name.trim()
    const column = HASH_CSV_COLUMNS.find((c) => c === clean)
    if (column !== undefined && index[column] === undefined) index[column] = i
  })
  // pandas index written without a name: the first header cell is empty.
  if (index.path === undefined && (header[0] ?? '').trim() === '' && index.root !== undefined) {
    index.path = 0
  }
  return index
}

function truthy(value: string): boolean {
  return value.trim().toLowerCase() === 'true'
}

function cell(fields: readonly string[], index: ColumnIndex, column: HashCsvColumn): string {
  const at = index[column]
  return at === undefined ? '' : (fields[at] ?? '')
}

function nullable(value: string): string | null {
  return value === '' ? null : value
}

function fieldsToRow(fields: readonly string[], index: ColumnIndex): HashRow | null {
  const path = cell(fields, index, 'path')
  if (path === '') return null
  const size = Number.parseInt(cell(fields, index, 'sizeFile'), 10)
  return {
    root: cell(fields, index, 'root'),
    inFile: cell(fields, index, 'inFile'),
    path,
    md5: nullable(cell(fields, index, 'md5')),
    pureMD5: nullable(cell(fields, index, 'pureMD5')),
    hash16: nullable(cell(fields, index, 'hash16')),
    hash8: nullable(cell(fields, index, 'hash8')),
    thumbLight: nullable(cell(fields, index, 'thumbLight')),
    thumbDark: nullable(cell(fields, index, 'thumbDark')),
    worksdWell: truthy(cell(fields, index, 'worksdWell')),
    sizeFile: Number.isFinite(size) && size > 0 ? size : 0,
    comments: cell(fields, index, 'comments')
  }
}

/** Parses a hash CSV (legacy, TS or pandas layout). Throws when the header has no `path` column. */
export function parseHashCsv(text: string): HashRow[] {
  const records = parseCsvRecords(text)
  const header = records[0]
  if (header === undefined) return []
  const index = indexHeader(header)
  if (index.path === undefined) throw new Error('Not a hash CSV: the header has no "path" column')
  const rows: HashRow[] = []
  for (const fields of records.slice(1)) {
    const row = fieldsToRow(fields, index)
    if (row !== null) rows.push(row)
  }
  return rows
}
