// Turns an API's JSON response into rows and columns for the table view.

export type Row = Record<string, unknown>

export interface TableData {
  /** Where the rows were found, e.g. "data" or "results.places" ('' = the response itself) */
  source: string
  columns: string[]
  rows: Row[]
  /** 'rows' = a list of records; 'fields' = a single object shown as field/value pairs */
  kind: 'rows' | 'fields'
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Finds the biggest list in the response, preferring lists of objects (breadth-first, a few levels deep). */
function findList(root: unknown): { path: string; items: unknown[] } | null {
  let best: { path: string; items: unknown[]; score: number } | null = null
  const queue: { value: unknown; path: string; depth: number }[] = [{ value: root, path: '', depth: 0 }]

  while (queue.length) {
    const { value, path, depth } = queue.shift()!
    if (Array.isArray(value) && value.length > 0) {
      const objects = value.filter(isPlainObject).length
      // Lists of records beat lists of plain values; longer lists beat shorter ones
      const score = (objects / value.length >= 0.5 ? 1_000_000 : 0) + value.length
      if (!best || score > best.score) best = { path, items: value, score }
      continue
    }
    if (isPlainObject(value) && depth < 4) {
      for (const [key, child] of Object.entries(value)) queue.push({ value: child, path: path ? `${path}.${key}` : key, depth: depth + 1 })
    }
  }
  return best
}

/** { a: { b: 1 } } → { "a.b": 1 }, two levels deep; lists stay as they are. */
export function flatten(obj: Record<string, unknown>, prefix = '', out: Row = {}, depth = 0): Row {
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value) && depth < 2 && Object.keys(value).length > 0) flatten(value, name, out, depth + 1)
    else out[name] = value
  }
  return out
}

/** The records (objects) in the main list of a JSON response, e.g. data.results. */
export function findRecords(body: string): Record<string, unknown>[] {
  try {
    const list = findList(JSON.parse(body))
    return list ? list.items.filter(isPlainObject) : []
  } catch {
    return []
  }
}

export function toTable(body: string): TableData | null {
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    return null
  }

  const list = findList(data)
  if (list) {
    const rows = list.items.map((item) => (isPlainObject(item) ? flatten(item) : { value: item }))
    // Keep columns in first-seen order across all rows
    const columns: string[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key)
          columns.push(key)
        }
      }
    }
    return { source: list.path, columns, rows, kind: 'rows' }
  }

  if (isPlainObject(data) && Object.keys(data).length > 0) {
    const rows = Object.entries(flatten(data)).map(([field, value]) => ({ field, value }))
    return { source: '', columns: ['field', 'value'], rows, kind: 'fields' }
  }
  return null
}

/** "full_address" / "fullAddress" / "rating.count" → "Full address" / "Full address" / "Rating · count" */
export function columnLabel(key: string) {
  return key
    .split('.')
    .map((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .toLowerCase(),
    )
    .join(' · ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** Plain-text version of a cell, used for display, search and CSV. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) return value.filter((v) => v !== null).join(', ')
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }
  return JSON.stringify(value)
}

export const isUrl = (text: string) => /^https?:\/\/\S+$/i.test(text)
export const isImageUrl = (text: string) =>
  isUrl(text) && (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(text) || /googleusercontent\.com|ggpht\.com/i.test(text))

export function toCsv(table: TableData, rows: Row[] = table.rows) {
  const escape = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
  const lines = [table.columns.map((c) => escape(columnLabel(c))).join(',')]
  for (const row of rows) {
    lines.push(
      table.columns
        .map((c) => {
          const v = row[c]
          // Keep nested lists/objects intact as JSON in the export
          const text = Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object') ? JSON.stringify(v) : cellText(v)
          return escape(text)
        })
        .join(','),
    )
  }
  // BOM so Excel opens UTF-8 (e.g. Urdu/accented names) correctly
  return '﻿' + lines.join('\r\n')
}
