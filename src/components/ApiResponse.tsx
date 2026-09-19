import { useMemo, useState } from 'react'
import { Braces, Check, Copy, Download, Search, Table2 } from 'lucide-react'
import { formatBytes, prettyBody, statusLabel, type ApiResult } from '../lib/rapidapi'
import { cellText, columnLabel, isImageUrl, isUrl, toCsv, toTable, type Row } from '../lib/tableize'

const MAX_ROWS = 500

function Cell({ value }: { value: unknown }) {
  const text = cellText(value)
  if (!text) return <span className="api-table__empty">—</span>
  if (isImageUrl(text)) {
    return (
      <a href={text} target="_blank" rel="noopener noreferrer" className="api-table__img">
        <img src={text} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </a>
    )
  }
  if (isUrl(text)) {
    return (
      <a href={text} target="_blank" rel="noopener noreferrer" className="api-table__link" title={text}>
        {text.replace(/^https?:\/\/(www\.)?/, '')}
      </a>
    )
  }
  return (
    <span className="api-table__text" title={text.length > 60 ? text : undefined}>
      {text}
    </span>
  )
}

export default function ApiResponse({ result, fileName }: { result: ApiResult; fileName: string }) {
  const table = useMemo(() => toTable(result.body), [result.body])
  const pretty = useMemo(() => prettyBody(result.body, result.contentType), [result])
  const [view, setView] = useState<'table' | 'json'>(table ? 'table' : 'json')
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState(false)
  const ok = result.status >= 200 && result.status < 300
  const showTable = view === 'table' && table !== null

  const filtered = useMemo<Row[]>(() => {
    if (!table) return []
    const q = filter.trim().toLowerCase()
    if (!q) return table.rows
    return table.rows.filter((row) => table.columns.some((c) => cellText(row[c]).toLowerCase().includes(q)))
  }, [table, filter])

  async function copy() {
    try {
      await navigator.clipboard.writeText(pretty)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked; nothing else to do
    }
  }

  function downloadCsv() {
    if (!table) return
    const blob = new Blob([toCsv(table, filtered)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'response'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="api-response">
      <div className="api-response__meta">
        <span className={`api-pill ${ok ? 'api-pill--ok' : 'api-pill--err'}`}>
          {result.status} {statusLabel(result.status, result.statusText)}
        </span>
        <span>{result.durationMs} ms</span>
        <span>{formatBytes(result.size)}</span>
        {result.quota.remaining && (
          <span>
            Quota left: <strong>{result.quota.remaining}</strong>
            {result.quota.limit ? ` / ${result.quota.limit}` : ''}
          </span>
        )}

        <div className="api-response__actions">
          {table && (
            <div className="api-toggle" role="tablist" aria-label="Response view">
              <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'is-active' : ''} onClick={() => setView('table')}>
                <Table2 size={14} /> Table
              </button>
              <button type="button" role="tab" aria-selected={view === 'json'} className={view === 'json' ? 'is-active' : ''} onClick={() => setView('json')}>
                <Braces size={14} /> JSON
              </button>
            </div>
          )}
          {showTable ? (
            <button type="button" className="btn btn--secondary btn--sm" onClick={downloadCsv}>
              <Download size={14} /> CSV
            </button>
          ) : (
            <button type="button" className="btn btn--secondary btn--sm" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {showTable ? (
        <>
          <div className="api-table-bar">
            <p className="api-hint">
              {table.kind === 'rows' ? (
                <>
                  <strong>{filtered.length}</strong>
                  {filter.trim() ? ` of ${table.rows.length}` : ''} row{filtered.length === 1 ? '' : 's'} · {table.columns.length} columns
                  {table.source && (
                    <>
                      {' '}
                      from <code>{table.source}</code>
                    </>
                  )}
                </>
              ) : (
                <>
                  <strong>{filtered.length}</strong> field{filtered.length === 1 ? '' : 's'}
                </>
              )}
            </p>
            <label className="api-table-search">
              <Search size={15} />
              <span className="sr-only">Filter rows</span>
              <input type="search" placeholder="Filter results…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
          </div>

          <div className="api-table-wrap">
            <table className="api-table">
              <thead>
                <tr>
                  {table.kind === 'rows' && <th className="api-table__index">#</th>}
                  {table.columns.map((c) => (
                    <th key={c} title={c}>
                      {columnLabel(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, MAX_ROWS).map((row, i) => (
                  <tr key={i}>
                    {table.kind === 'rows' && <td className="api-table__index">{i + 1}</td>}
                    {table.columns.map((c) => (
                      <td key={c}>{table.kind === 'fields' && c === 'field' ? <strong>{columnLabel(String(row[c]))}</strong> : <Cell value={row[c]} />}</td>
                    ))}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={table.columns.length + 1} className="api-table__none">
                      No rows match “{filter}”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > MAX_ROWS && (
            <p className="api-hint">
              Showing the first {MAX_ROWS} rows. Download the CSV to get all {filtered.length}.
            </p>
          )}
        </>
      ) : (
        <pre className="api-code">{pretty || '(empty response)'}</pre>
      )}
    </div>
  )
}
