import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AtSign,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  Globe,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react'
import PlatformIcon from '../components/PlatformIcon'
import { SetupRequiredError } from '../lib/apiStore'
import type { PlatformId } from '../lib/social'
import {
  FIELD_LABELS,
  LEAD_STATUSES,
  SOCIAL_ORDER,
  deleteLeads,
  enrichLeads,
  fetchLeads,
  guessMapping,
  guessSource,
  importLeads,
  leadsToCsv,
  parseCsv,
  rowsToLeads,
  updateLead,
  type Lead,
  type LeadField,
  type LeadStatus,
} from '../lib/leadStore'
import setupSql from '../../supabase/migrations/20261010000000_leads.sql?raw'
import './Leads.css'

const ENRICH_BATCH = 200

interface Pending {
  fileName: string
  headers: string[]
  rows: string[][]
  mapping: LeadField[]
}

function SetupCard({ onRetry, checking }: { onRetry: () => void; checking: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(setupSql)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard can be blocked; the file path below still works
    }
  }
  return (
    <section className="card api-setup">
      <span className="api-setup__icon">
        <Database size={22} />
      </span>
      <div className="api-setup__body">
        <h2 className="card__title">Set up the leads table</h2>
        <p className="card__sub">Imported leads live in your own Supabase database. Create the table once and this page is ready.</p>
        <ol>
          <li>
            Click <strong>Copy SQL</strong> below.
          </li>
          <li>
            In Supabase open <strong>SQL Editor</strong> → <strong>New query</strong>, paste it and press <strong>Run</strong>.
          </li>
          <li>
            Come back and click <strong>Check again</strong>.
          </li>
        </ol>
        <div className="api-setup__actions">
          <button type="button" className="btn btn--primary" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy SQL'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onRetry} disabled={checking}>
            {checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Check again
          </button>
        </div>
        <p className="api-hint">
          The same script is in <code>supabase/migrations/20261010000000_leads.sql</code>.
        </p>
      </div>
    </section>
  )
}

/** Second line under the name: category and city if we have them, else the address without the repeated name. */
function placeLine(lead: Lead) {
  const tags = [lead.category, lead.city].filter(Boolean).join(' · ')
  if (tags) return tags
  const address = lead.address.trim()
  if (lead.name && address.toLowerCase().startsWith(lead.name.toLowerCase())) {
    return address.slice(lead.name.length).replace(/^[\s,-]+/, '') || address
  }
  return address || '—'
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')

  const [pending, setPending] = useState<Pending | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | LeadStatus>('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [contactFilter, setContactFilter] = useState<'all' | 'email' | 'social' | 'none'>('all')
  const [openLead, setOpenLead] = useState<Lead | null>(null)
  const [pageNo, setPageNo] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setLeads(await fetchLeads())
      setSetupRequired(false)
    } catch (err) {
      if (err instanceof SetupRequiredError) setSetupRequired(true)
      else setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not load your leads.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const sources = useMemo(() => [...new Set(leads.map((l) => l.source).filter(Boolean))], [leads])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter((lead) => {
      if (statusFilter !== 'all' && lead.status !== statusFilter) return false
      if (sourceFilter !== 'all' && lead.source !== sourceFilter) return false
      if (contactFilter === 'email' && lead.emails.length === 0) return false
      if (contactFilter === 'social' && Object.keys(lead.socials).length === 0) return false
      if (contactFilter === 'none' && (lead.emails.length > 0 || Object.keys(lead.socials).length > 0)) return false
      if (q && !`${lead.name} ${lead.category} ${lead.city} ${lead.emails.join(' ')} ${lead.phone}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [leads, search, statusFilter, sourceFilter, contactFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage))
  // A filter or a delete can leave you past the last page.
  const page = Math.min(pageNo, pageCount)
  const shown = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page, perPage])

  const stats = useMemo(
    () => ({
      total: leads.length,
      withEmail: leads.filter((l) => l.emails.length > 0).length,
      withSocial: leads.filter((l) => Object.keys(l.socials).length > 0).length,
      pending: leads.filter((l) => !l.enrichedAt).length,
    }),
    [leads],
  )

  /* ---------- Import ---------- */

  async function pickFile(file: File | undefined) {
    if (!file) return
    setNote(null)
    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) {
        setNote({ kind: 'error', text: 'That file has no rows under the header.' })
        return
      }
      const headers = rows[0].map((h) => h.trim())
      setPending({ fileName: file.name, headers, rows, mapping: guessMapping(headers) })
    } catch {
      setNote({ kind: 'error', text: 'That file could not be read as CSV.' })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function runImport() {
    if (!pending) return
    const parsed = rowsToLeads(pending.rows, pending.mapping, guessSource(pending.fileName))
    if (parsed.length === 0) {
      setNote({ kind: 'error', text: 'No rows had a business name — check the column mapping.' })
      return
    }
    setBusy('import')
    try {
      const added = await importLeads(parsed)
      await load()
      const skipped = parsed.length - added
      setNote({ kind: 'ok', text: `${added} lead${added === 1 ? '' : 's'} imported${skipped > 0 ? `, ${skipped} already there` : ''}.` })
      setPending(null)
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'The import failed.' })
    } finally {
      setBusy('')
    }
  }

  /* ---------- Enrich ---------- */

  async function enrich(ids: string[]) {
    if (ids.length === 0) return
    setBusy('enrich')
    setNote(null)
    let updated = 0
    let withEmail = 0
    let withSocial = 0
    let noWebsite = 0
    const notes: string[] = []
    try {
      for (let i = 0; i < ids.length; i += ENRICH_BATCH) {
        setProgress(`${Math.min(i + ENRICH_BATCH, ids.length)} of ${ids.length}`)
        const result = await enrichLeads(ids.slice(i, i + ENRICH_BATCH))
        updated += result.updated
        withEmail += result.withEmail
        withSocial += result.withSocial
        noWebsite += result.noWebsite ?? 0
        notes.push(...(result.notes ?? []))
      }
      await load()
      setSelected(new Set())
      const why = noWebsite > 0 ? ` ${noWebsite} of them have no website on Google — emails come from the website, so for those the phone is the only way in.` : ''
      setNote({
        kind: notes.length ? 'error' : 'ok',
        text: `${updated} lead${updated === 1 ? '' : 's'} checked — ${withEmail} with an email, ${withSocial} with socials.${why}${notes.length ? ` ${notes[0]}` : ''}`,
      })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Enrichment failed.' })
    } finally {
      setBusy('')
      setProgress('')
    }
  }

  async function removeSelected() {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!window.confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    try {
      await deleteLeads(ids)
      setLeads((list) => list.filter((l) => !selected.has(l.id)))
      setSelected(new Set())
      setNote({ kind: 'ok', text: `${ids.length} lead${ids.length === 1 ? '' : 's'} deleted.` })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not delete those leads.' })
    }
  }

  function exportCsv() {
    const blob = new Blob([leadsToCsv(filtered)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `teeju-leads-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function setStatus(lead: Lead, status: LeadStatus) {
    setLeads((list) => list.map((l) => (l.id === lead.id ? { ...l, status } : l)))
    setOpenLead((l) => (l && l.id === lead.id ? { ...l, status } : l))
    try {
      await updateLead(lead.id, { status })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not update the status.' })
    }
  }

  const allShownSelected = shown.length > 0 && shown.every((l) => selected.has(l.id))

  if (setupRequired) {
    return (
      <>
        <div className="page-head">
          <div>
            <p className="eyebrow">Outreach</p>
            <h1>
              <em>Leads</em>
            </h1>
          </div>
        </div>
        <SetupCard onRetry={() => void load()} checking={loading} />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Outreach</p>
          <h1>
            <em>Leads</em>
          </h1>
          <p className="page-head__sub">Upload a CSV, let Teeju find the emails and social profiles, then work the list.</p>
        </div>
        <div className="inv-actions">
          <button type="button" className="btn btn--secondary" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download size={16} /> Export CSV
          </button>
          <button type="button" className="btn btn--primary" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Upload CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void pickFile(e.target.files?.[0])} />
        </div>
      </div>

      {note && (
        <div className={`alert ${note.kind === 'ok' ? 'alert--success' : 'alert--error'} api-banner`} role="status">
          {note.kind === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
          <span>{note.text}</span>
          <button type="button" className="api-icon-btn" onClick={() => setNote(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <section className="soc-stats">
        {[
          { label: 'Leads', value: stats.total, icon: Users },
          { label: 'With email', value: stats.withEmail, icon: Mail },
          { label: 'With socials', value: stats.withSocial, icon: AtSign },
          { label: 'Not enriched', value: stats.pending, icon: Sparkles },
        ].map((tile) => (
          <article key={tile.label} className="card soc-tile">
            <span className="soc-tile__icon">
              <tile.icon size={16} />
            </span>
            <div>
              <p className="soc-tile__value">{tile.value}</p>
              <p className="soc-tile__label">{tile.label}</p>
            </div>
          </article>
        ))}
      </section>

      {pending && (
        <section className="card lead-import">
          <header className="card__head">
            <div>
              <h2 className="card__title">Check the columns</h2>
              <p className="card__sub">
                <FileSpreadsheet size={14} /> {pending.fileName} · {pending.rows.length - 1} rows · source will be saved as “{guessSource(pending.fileName)}”
              </p>
            </div>
            <button type="button" className="api-icon-btn" onClick={() => setPending(null)} aria-label="Cancel import">
              <X size={16} />
            </button>
          </header>

          <div className="lead-map">
            {pending.headers.map((header, i) => (
              <label key={`${header}-${i}`} className="lead-map__col">
                <span className="lead-map__head">{header || `Column ${i + 1}`}</span>
                <select
                  className="api-input"
                  value={pending.mapping[i]}
                  onChange={(e) => {
                    const mapping = [...pending.mapping]
                    mapping[i] = e.target.value as LeadField
                    setPending({ ...pending, mapping })
                  }}
                >
                  {FIELD_LABELS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <span className="lead-map__sample">{pending.rows[1]?.[i]?.slice(0, 40) || '—'}</span>
              </label>
            ))}
          </div>

          <div className="soc-actions">
            <button type="button" className="btn btn--primary" onClick={() => void runImport()} disabled={busy === 'import'}>
              {busy === 'import' ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Import {pending.rows.length - 1} rows
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setPending(null)}>
              Cancel
            </button>
            <p className="api-hint">Leads already saved (same Google ID, or same name and address) are skipped automatically.</p>
          </div>
        </section>
      )}

      {loading ? (
        <div className="card api-loading">
          <Loader2 size={20} className="spin" /> Loading your leads…
        </div>
      ) : (
        <section className="card card--flush">
          <header className="card__head inv-list__head">
            <div>
              <h2 className="card__title">{filtered.length} lead{filtered.length === 1 ? '' : 's'}</h2>
              <p className="card__sub">{selected.size > 0 ? `${selected.size} selected` : 'Select rows to enrich or delete them'}</p>
            </div>
            <div className="inv-list__tools">
              <div className="api-toggle">
                {(['all', 'email', 'social', 'none'] as const).map((f) => (
                  <button key={f} type="button" className={contactFilter === f ? 'is-active' : ''} onClick={() => { setContactFilter(f); setPageNo(1) }}>
                    {f === 'all' ? 'All' : f === 'email' ? 'Has email' : f === 'social' ? 'Has socials' : 'No contacts'}
                  </button>
                ))}
              </div>
              <select className="api-input soc-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as LeadStatus | 'all'); setPageNo(1) }}>
                <option value="all">Any status</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {sources.length > 1 && (
                <select className="api-input soc-select" value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPageNo(1) }}>
                  <option value="all">Every file</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              <label className="api-table-search">
                <Search size={15} />
                <span className="sr-only">Search leads</span>
                <input type="search" placeholder="Search name, city, email…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1) }} />
              </label>
            </div>
          </header>

          <div className="lead-bulk">
            <label className="lead-check">
              <input
                type="checkbox"
                checked={allShownSelected}
                onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((l) => l.id)) : new Set())}
              />
              Select all shown
            </label>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void enrich(selected.size ? [...selected] : filtered.filter((l) => !l.enrichedAt).map((l) => l.id))}
              disabled={busy === 'enrich' || filtered.length === 0}
            >
              {busy === 'enrich' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              {busy === 'enrich' ? `Enriching ${progress}` : selected.size ? `Enrich ${selected.size} selected` : 'Enrich not-yet-checked'}
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void removeSelected()} disabled={selected.size === 0}>
              <Trash2 size={14} /> Delete
            </button>
            <p className="api-hint">Enrichment uses your RapidAPI quota — one credit per business.</p>
          </div>

          {filtered.length === 0 ? (
            <div className="empty">
              <span className="empty__icon">
                <Users size={24} />
              </span>
              <h2>No leads here yet</h2>
              <p>Upload a CSV from the Lead Finder (or any list with a business name and website) to get started.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table lead-table">
                <thead>
                  <tr>
                    <th className="lead-table__pick" />
                    <th>Business</th>
                    <th>Contact</th>
                    <th>Socials</th>
                    <th className="num">Rating</th>
                    <th>Status</th>
                    <th className="num">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((lead) => (
                    <tr key={lead.id} className={selected.has(lead.id) ? 'is-picked' : ''}>
                      <td className="lead-table__pick">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          aria-label={`Select ${lead.name}`}
                          onChange={(e) => {
                            const next = new Set(selected)
                            if (e.target.checked) next.add(lead.id)
                            else next.delete(lead.id)
                            setSelected(next)
                          }}
                        />
                      </td>
                      <td>
                        <button type="button" className="lead-name" onClick={() => setOpenLead(lead)}>
                          {lead.name || '(no name)'}
                        </button>
                        <div className="lead-place">{placeLine(lead)}</div>
                      </td>
                      <td>
                        <div className="lead-contact">
                          {lead.emails[0] ? (
                            <a href={`mailto:${lead.emails[0]}`} className="lead-link">
                              <Mail size={13} /> {lead.emails[0]}
                              {lead.emails.length > 1 && <span className="lead-badge">+{lead.emails.length - 1}</span>}
                            </a>
                          ) : (
                            <span className="lead-missing">{lead.enrichedAt ? 'no email found' : 'not checked yet'}</span>
                          )}
                          {(lead.phones[0] || lead.phone) && (
                            <span className="lead-sub">
                              <Phone size={12} /> {lead.phones[0] || lead.phone}
                            </span>
                          )}
                          {lead.website ? (
                            <a href={lead.website} target="_blank" rel="noopener noreferrer" className="lead-sub lead-sub--link">
                              <Globe size={12} /> {lead.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')}
                            </a>
                          ) : (
                            <span className="lead-sub">
                              <Globe size={12} /> no website
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="lead-socials">
                          {SOCIAL_ORDER.filter((s) => lead.socials[s]).map((s) => (
                            <a key={s} href={lead.socials[s]} target="_blank" rel="noopener noreferrer" title={lead.socials[s]} className="lead-social">
                              <PlatformIcon id={s as PlatformId} size={14} />
                            </a>
                          ))}
                          {Object.keys(lead.socials).length === 0 && <span className="lead-missing">—</span>}
                        </div>
                      </td>
                      <td className="num">
                        {lead.rating === null ? (
                          <span className="lead-missing">—</span>
                        ) : (
                          <span className="lead-rating">
                            <Star size={12} /> {lead.rating.toFixed(1)}
                          </span>
                        )}
                        {lead.reviews !== null && <div className="lead-sub lead-sub--right">{lead.reviews} reviews</div>}
                      </td>
                      <td>
                        <select className="lead-status" value={lead.status} onChange={(e) => void setStatus(lead, e.target.value as LeadStatus)}>
                          {LEAD_STATUSES.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num table__muted">{lead.source || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > 0 && (
            <nav className="lead-pager" aria-label="Pages of leads">
              <p className="lead-pager__count">
                {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length}
              </p>
              <div className="lead-pager__controls">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPageNo(page - 1)} disabled={page <= 1}>
                  <ChevronLeft size={14} /> Previous
                </button>
                <span className="lead-pager__page">
                  Page {page} of {pageCount}
                </span>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setPageNo(page + 1)} disabled={page >= pageCount}>
                  Next <ChevronRight size={14} />
                </button>
              </div>
              <label className="lead-pager__size">
                Per page
                <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPageNo(1) }}>
                  {[25, 50, 100, 200].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </nav>
          )}
        </section>
      )}

      {openLead && (
        <div className="lead-drawer" onMouseDown={(e) => e.target === e.currentTarget && setOpenLead(null)}>
          <aside className="lead-drawer__panel" role="dialog" aria-label={openLead.name}>
            <header className="lead-drawer__head">
              <div>
                <h2 className="card__title">{openLead.name}</h2>
                <p className="card__sub">{[openLead.category, openLead.city, openLead.country].filter(Boolean).join(' · ')}</p>
              </div>
              <button type="button" className="api-icon-btn" onClick={() => setOpenLead(null)} aria-label="Close">
                <X size={16} />
              </button>
            </header>

            <div className="lead-drawer__body">
              {openLead.rating !== null && (
                <p className="lead-drawer__line">
                  <span className="lead-rating">
                    <Star size={12} /> {openLead.rating.toFixed(1)}
                  </span>
                  {openLead.reviews !== null && ` · ${openLead.reviews} reviews`}
                </p>
              )}
              {openLead.address && <p className="lead-drawer__line">{openLead.address}</p>}
              {openLead.website && (
                <a className="lead-link" href={openLead.website} target="_blank" rel="noopener noreferrer">
                  <Globe size={14} /> {openLead.website.replace(/^https?:\/\//, '')}
                </a>
              )}

              <h3 className="lead-drawer__title">Emails</h3>
              {openLead.emails.length === 0 ? (
                <p className="lead-missing">None found yet.</p>
              ) : (
                <ul className="lead-drawer__list">
                  {openLead.emails.map((email) => (
                    <li key={email}>
                      <a className="lead-link" href={`mailto:${email}`}>
                        <Mail size={13} /> {email}
                      </a>
                      <button type="button" className="api-icon-btn" title="Copy" onClick={() => void navigator.clipboard.writeText(email)}>
                        <Copy size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="lead-drawer__title">Phones</h3>
              {openLead.phones.length === 0 ? (
                <p className="lead-missing">None found yet.</p>
              ) : (
                <ul className="lead-drawer__list">
                  {openLead.phones.map((phone) => (
                    <li key={phone}>
                      <a className="lead-link" href={`tel:${phone.replace(/\s+/g, '')}`}>
                        <Phone size={13} /> {phone}
                      </a>
                      <a className="api-icon-btn" title="WhatsApp" href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
                        <PlatformIcon id="telegram" size={14} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className="lead-drawer__title">Social profiles</h3>
              {Object.keys(openLead.socials).length === 0 ? (
                <p className="lead-missing">None found yet.</p>
              ) : (
                <ul className="lead-drawer__list">
                  {SOCIAL_ORDER.filter((s) => openLead.socials[s]).map((s) => (
                    <li key={s}>
                      <a className="lead-link" href={openLead.socials[s]} target="_blank" rel="noopener noreferrer">
                        <PlatformIcon id={s as PlatformId} size={14} /> {openLead.socials[s].replace(/^https?:\/\/(www\.)?/, '')}
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              <div className="soc-actions">
                <button type="button" className="btn btn--primary btn--sm" onClick={() => void enrich([openLead.id])} disabled={busy === 'enrich'}>
                  {busy === 'enrich' ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Enrich this lead
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
