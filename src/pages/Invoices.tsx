import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Database,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import InvoiceDocument from '../components/InvoiceDocument'
import { SetupRequiredError } from '../lib/apiStore'
import { downloadHtml, downloadPdf, downloadPng, printInvoice } from '../lib/invoiceExport'
import {
  CURRENCIES,
  DEFAULT_SETTINGS,
  TEMPLATES,
  addDays,
  blankInvoice,
  calcTotals,
  deleteInvoice,
  emptyClient,
  fetchInvoices,
  fetchSettings,
  accentForTemplate,
  accentsFor,
  formatDate,
  formatMoney,
  hasTemplateUpgrade,
  isDarkTemplate,
  newItem,
  nextNumber,
  readImage,
  saveSettings,
  upsertInvoice,
  type AccentId,
  type Invoice,
  type InvoiceItem,
  type InvoiceSettings,
  type InvoiceStatus,
} from '../lib/invoices'
import setupSql from '../../supabase/migrations/20260926000000_invoices.sql?raw'
import templatesSql from '../../supabase/migrations/20260928010000_invoice_gold_templates.sql?raw'
import './Invoices.css'

const STATUSES: { id: InvoiceStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'paid', label: 'Paid' },
]

const A4_WIDTH = 793.7
const A4_HEIGHT = 1122.5

function SetupCard({ onRetry, checking }: { onRetry: () => void; checking: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(setupSql)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard can be blocked; the file path below still works
    }
  }
  return (
    <section className="card api-setup">
      <span className="api-setup__icon">
        <Database size={22} />
      </span>
      <div className="api-setup__body">
        <h2 className="card__title">Set up invoices</h2>
        <p className="card__sub">Invoices are saved in your Supabase database. Create the tables once and this page is ready.</p>
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
          The same script is in <code>supabase/migrations/20260926000000_invoices.sql</code>.
        </p>
      </div>
    </section>
  )
}

/** An image field used for the logo and the signature. */
function ImageField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (dataUrl: string) => void }) {
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setError('')
    try {
      onChange(await readImage(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be used.')
    }
  }

  return (
    <div className="inv-field">
      <span>{label}</span>
      <div className="inv-upload">
        {value ? (
          <img src={value} alt="" className="inv-upload__preview" />
        ) : (
          <span className="inv-upload__empty">
            <ImageIcon size={18} />
          </span>
        )}
        <div className="inv-upload__actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => inputRef.current?.click()}>
            <Upload size={14} /> {value ? 'Replace' : 'Upload'}
          </button>
          {value && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => onChange('')}>
              <X size={14} /> Remove
            </button>
          )}
          <p className="api-hint">{hint}</p>
        </div>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {error && <p className="api-inline-error">{error}</p>}
    </div>
  )
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [settings, setSettings] = useState<InvoiceSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Invoice | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(0)
  const [rememberDetails, setRememberDetails] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all')
  const [exportTarget, setExportTarget] = useState<Invoice | null>(null)
  const [busyExport, setBusyExport] = useState('')
  const [scale, setScale] = useState(0.55)

  const frameRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [list, saved] = await Promise.all([fetchInvoices(), fetchSettings()])
      setInvoices(list)
      setSettings(saved)
      setSetupRequired(false)
    } catch (err) {
      if (err instanceof SetupRequiredError) setSetupRequired(true)
      else setLoadError(err instanceof Error ? err.message : 'Could not load your invoices.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  // Fit the A4 preview to the space available
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / A4_WIDTH)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [draft])

  const documentInvoice = draft ?? exportTarget

  // A download asked for from the list: render the invoice off-screen first, then save the PDF
  useEffect(() => {
    if (!exportTarget || draft) return
    const invoice = exportTarget
    const id = window.setTimeout(() => {
      void exportAs('pdf', invoice).finally(() => setExportTarget(null))
    }, 150)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportTarget, draft])

  const totals = draft ? calcTotals(draft) : null
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false
      if (!q) return true
      return `${inv.number} ${inv.client.name} ${inv.client.email}`.toLowerCase().includes(q)
    })
  }, [invoices, search, statusFilter])

  const stats = useMemo(() => {
    let outstanding = 0
    let paid = 0
    for (const inv of invoices) {
      const total = calcTotals(inv).total
      if (inv.status === 'paid') paid += total
      else if (inv.status === 'sent') outstanding += total
    }
    return { outstanding, paid, count: invoices.length }
  }, [invoices])

  function update(patch: Partial<Invoice>) {
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  function updateItem(id: string, patch: Partial<InvoiceItem>) {
    setDraft((d) => (d ? { ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) } : d))
  }

  function startNew() {
    setDraft(blankInvoice(settings, nextNumber(invoices, settings.prefix)))
    setIsNew(true)
    setSaveError(null)
    window.scrollTo({ top: 0 })
  }

  function edit(invoice: Invoice) {
    setDraft(structuredClone(invoice))
    setIsNew(false)
    setSaveError(null)
    window.scrollTo({ top: 0 })
  }

  function duplicate(invoice: Invoice) {
    const copy = structuredClone(invoice)
    copy.id = crypto.randomUUID()
    copy.number = nextNumber(invoices, settings.prefix)
    copy.status = 'draft'
    copy.issueDate = new Date().toISOString().slice(0, 10)
    copy.dueDate = addDays(copy.issueDate, settings.dueDays || 0)
    setDraft(copy)
    setIsNew(true)
    window.scrollTo({ top: 0 })
  }

  async function remove(invoice: Invoice) {
    if (!window.confirm(`Delete invoice ${invoice.number}? This cannot be undone.`)) return
    try {
      await deleteInvoice(invoice.id)
      setInvoices((list) => list.filter((i) => i.id !== invoice.id))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not delete that invoice.')
    }
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    setSaveError(null)
    try {
      await upsertInvoice(draft)
      if (rememberDetails) {
        const next: InvoiceSettings = {
          ...settings,
          business: draft.business,
          currency: draft.currency,
          template: draft.template,
          accent: draft.accent,
          taxRate: draft.taxRate,
          terms: draft.terms,
          paymentDetails: draft.paymentDetails,
          signature: draft.signature,
          signatureName: draft.signatureName,
        }
        setSettings(next)
        await saveSettings(next)
      }
      setInvoices((list) => {
        const without = list.filter((i) => i.id !== draft.id)
        return [{ ...draft }, ...without].sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))
      })
      setIsNew(false)
      setSavedAt(Date.now())
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this invoice.')
    } finally {
      setSaving(false)
    }
  }

  async function exportAs(kind: 'pdf' | 'png' | 'html', invoice: Invoice | null = documentInvoice) {
    const node = exportRef.current
    if (!node || !invoice) return
    setBusyExport(kind)
    try {
      if (kind === 'pdf') await downloadPdf(node, invoice)
      else if (kind === 'png') await downloadPng(node, invoice)
      else downloadHtml(node, invoice)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'The download failed.')
    } finally {
      setBusyExport('')
    }
  }

  const exportPortal =
    documentInvoice && typeof document !== 'undefined'
      ? createPortal(
          <div className="inv-export">
            <InvoiceDocument ref={exportRef} invoice={documentInvoice} />
          </div>,
          document.body,
        )
      : null

  /* ---------- Editor ---------- */
  if (draft) {
    const dueBeforeIssue = draft.dueDate && draft.dueDate < draft.issueDate
    return (
      <>
        <div className="page-head">
          <div>
            <p className="eyebrow">{isNew ? 'New invoice' : 'Editing'}</p>
            <h1>
              Invoice <em>{draft.number}</em>
            </h1>
            <p className="page-head__sub">Fill in the details on the left — the invoice updates as you type.</p>
          </div>
          <div className="inv-actions">
            <button type="button" className="btn btn--secondary" onClick={() => setDraft(null)}>
              <ArrowLeft size={16} /> Back
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />} {isNew ? 'Create invoice' : 'Save changes'}
            </button>
          </div>
        </div>

        {saveError && (
          <div className="alert alert--error api-banner" role="alert">
            <AlertCircle size={16} />
            <span>{saveError}</span>
            {saveError.includes('SQL script') && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void navigator.clipboard.writeText(templatesSql)}>
                <Copy size={14} /> Copy SQL
              </button>
            )}
            <button type="button" className="api-icon-btn" onClick={() => setSaveError(null)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        )}
        {savedAt > 0 && !saveError && (
          <div className="alert alert--success api-banner" role="status">
            <Check size={16} />
            <span>Invoice saved to your Supabase database.</span>
            <button type="button" className="api-icon-btn" onClick={() => setSavedAt(0)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        )}

        <div className="inv-editor">
          <div className="inv-form">
            <section className="card">
              <h2 className="card__title">Invoice details</h2>
              <div className="inv-grid">
                <label className="inv-field">
                  <span>Invoice number</span>
                  <input className="api-input" value={draft.number} onChange={(e) => update({ number: e.target.value })} />
                </label>
                <label className="inv-field">
                  <span>Status</span>
                  <select className="api-input" value={draft.status} onChange={(e) => update({ status: e.target.value as InvoiceStatus })}>
                    {STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inv-field">
                  <span>Issue date</span>
                  <input className="api-input" type="date" value={draft.issueDate} onChange={(e) => update({ issueDate: e.target.value })} />
                </label>
                <label className="inv-field">
                  <span>Due date</span>
                  <input className="api-input" type="date" value={draft.dueDate} onChange={(e) => update({ dueDate: e.target.value })} />
                  {dueBeforeIssue && <span className="api-inline-error">The due date is before the issue date.</span>}
                </label>
                <label className="inv-field">
                  <span>Currency</span>
                  <select className="api-input" value={draft.currency} onChange={(e) => update({ currency: e.target.value })}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <div className="inv-field inv-field--wide">
                  <span>Template</span>
                  <div className="inv-templates">
                    {TEMPLATES.map((t) => {
                      const locked = !t.legacy && !hasTemplateUpgrade()
                      return (
                        <button
                          key={t.id}
                          type="button"
                          title={locked ? 'Run the templates SQL script to unlock this one' : t.description}
                          className={`inv-tpl inv-tpl--${t.id}${draft.template === t.id ? ' is-active' : ''} inv--accent-${accentForTemplate(t.id, draft.accent)}`}
                          onClick={() => update({ template: t.id, accent: accentForTemplate(t.id, draft.accent) })}
                          disabled={locked}
                        >
                          <span className="inv-tpl__art" aria-hidden="true">
                            <span className="inv-tpl__bar" />
                            <span className="inv-tpl__line" />
                            <span className="inv-tpl__line inv-tpl__line--short" />
                            <span className="inv-tpl__total" />
                          </span>
                          <span className="inv-tpl__name">{t.name}</span>
                          <span className="inv-tpl__desc">{locked ? 'Needs the SQL update' : t.description}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="inv-field inv-field--wide">
                  <span>{isDarkTemplate(draft.template) ? 'Metal tone' : 'Colour'}</span>
                  <div className="inv-accents">
                    {accentsFor(draft.template).map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        title={a.name}
                        aria-label={a.name}
                        aria-pressed={draft.accent === a.id}
                        className={`inv-accent${draft.accent === a.id ? ' is-active' : ''}`}
                        style={{ background: a.color }}
                        onClick={() => update({ accent: a.id as AccentId })}
                        disabled={!hasTemplateUpgrade()}
                      />
                    ))}
                    <span className="api-hint">
                      {!hasTemplateUpgrade()
                        ? 'Colours need the SQL update below.'
                        : isDarkTemplate(draft.template)
                          ? 'Gold, champagne, rose gold or silver on the black page.'
                          : 'Works with every light template.'}
                    </span>
                  </div>
                </div>

                {!hasTemplateUpgrade() && (
                  <div className="lead-note inv-field--wide">
                    <AlertCircle size={15} />
                    <span>
                      Run one more small SQL script in Supabase to unlock the Luxe, Noir, Royal, Onyx, Bold and Compact templates and the colour
                      options (<code>20260928010000_invoice_gold_templates.sql</code>).
                    </span>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void navigator.clipboard.writeText(templatesSql)}>
                      <Copy size={14} /> Copy SQL
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className="card">
              <h2 className="card__title">Your business</h2>
              <div className="inv-grid">
                <ImageField label="Logo" hint="PNG or JPG, shrunk automatically." value={draft.business.logo} onChange={(logo) => update({ business: { ...draft.business, logo } })} />
                <label className="inv-field">
                  <span>Business name</span>
                  <input className="api-input" value={draft.business.name} onChange={(e) => update({ business: { ...draft.business, name: e.target.value } })} />
                </label>
                <label className="inv-field">
                  <span>Email</span>
                  <input className="api-input" type="email" value={draft.business.email} onChange={(e) => update({ business: { ...draft.business, email: e.target.value } })} />
                </label>
                <label className="inv-field">
                  <span>Phone</span>
                  <input className="api-input" value={draft.business.phone} onChange={(e) => update({ business: { ...draft.business, phone: e.target.value } })} />
                </label>
                <label className="inv-field">
                  <span>Website</span>
                  <input className="api-input" value={draft.business.website} onChange={(e) => update({ business: { ...draft.business, website: e.target.value } })} />
                </label>
                <label className="inv-field">
                  <span>Tax / registration number</span>
                  <input className="api-input" value={draft.business.taxId} onChange={(e) => update({ business: { ...draft.business, taxId: e.target.value } })} />
                </label>
                <label className="inv-field inv-field--wide">
                  <span>Address</span>
                  <textarea
                    className="api-input api-textarea"
                    rows={2}
                    value={draft.business.address}
                    onChange={(e) => update({ business: { ...draft.business, address: e.target.value } })}
                  />
                </label>
              </div>
            </section>

            <section className="card">
              <h2 className="card__title">Bill to</h2>
              <div className="inv-grid">
                <label className="inv-field">
                  <span>Client name</span>
                  <input className="api-input" value={draft.client.name} onChange={(e) => update({ client: { ...draft.client, name: e.target.value } })} />
                </label>
                <label className="inv-field">
                  <span>Email</span>
                  <input className="api-input" type="email" value={draft.client.email} onChange={(e) => update({ client: { ...draft.client, email: e.target.value } })} />
                </label>
                <label className="inv-field">
                  <span>Phone</span>
                  <input className="api-input" value={draft.client.phone} onChange={(e) => update({ client: { ...draft.client, phone: e.target.value } })} />
                </label>
                <label className="inv-field inv-field--wide">
                  <span>Address</span>
                  <textarea
                    className="api-input api-textarea"
                    rows={2}
                    value={draft.client.address}
                    onChange={(e) => update({ client: { ...draft.client, address: e.target.value } })}
                  />
                </label>
                <button type="button" className="btn btn--secondary btn--sm inv-clear" onClick={() => update({ client: emptyClient() })}>
                  <X size={14} /> Clear client
                </button>
              </div>
            </section>

            <section className="card">
              <h2 className="card__title">Items</h2>
              <div className="inv-items">
                <div className="inv-items__head">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Rate</span>
                  <span>Amount</span>
                  <span />
                </div>
                {draft.items.map((item) => (
                  <div className="inv-items__row" key={item.id}>
                    <input className="api-input" placeholder="Website design" value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} />
                    <input className="api-input" type="number" min={0} step="any" value={item.qty} onChange={(e) => updateItem(item.id, { qty: Number(e.target.value) })} />
                    <input className="api-input" type="number" min={0} step="any" value={item.rate} onChange={(e) => updateItem(item.id, { rate: Number(e.target.value) })} />
                    <span className="inv-items__amount">{formatMoney((Number(item.qty) || 0) * (Number(item.rate) || 0), draft.currency)}</span>
                    <button
                      type="button"
                      className="api-icon-btn api-icon-btn--danger"
                      onClick={() => update({ items: draft.items.filter((i) => i.id !== item.id) })}
                      aria-label="Remove item"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => update({ items: [...draft.items, newItem()] })}>
                  <Plus size={14} /> Add item
                </button>
              </div>

              <div className="inv-grid inv-grid--totals">
                <label className="inv-field">
                  <span>Tax (%)</span>
                  <input className="api-input" type="number" min={0} step="any" value={draft.taxRate} onChange={(e) => update({ taxRate: Number(e.target.value) })} />
                </label>
                <label className="inv-field">
                  <span>Discount</span>
                  <div className="inv-split">
                    <input className="api-input" type="number" min={0} step="any" value={draft.discount} onChange={(e) => update({ discount: Number(e.target.value) })} />
                    <select className="api-input" value={draft.discountType} onChange={(e) => update({ discountType: e.target.value as 'amount' | 'percent' })}>
                      <option value="amount">{draft.currency}</option>
                      <option value="percent">%</option>
                    </select>
                  </div>
                </label>
                <label className="inv-field">
                  <span>Shipping / extra</span>
                  <input className="api-input" type="number" min={0} step="any" value={draft.shipping} onChange={(e) => update({ shipping: Number(e.target.value) })} />
                </label>
                {totals && (
                  <div className="inv-total-preview">
                    <span>Total due</span>
                    <strong>{formatMoney(totals.total, draft.currency)}</strong>
                  </div>
                )}
              </div>
            </section>

            <section className="card">
              <h2 className="card__title">Notes & signature</h2>
              <div className="inv-grid">
                <label className="inv-field inv-field--wide">
                  <span>Payment details</span>
                  <textarea
                    className="api-input api-textarea"
                    rows={2}
                    placeholder="Bank name, account title, IBAN…"
                    value={draft.paymentDetails}
                    onChange={(e) => update({ paymentDetails: e.target.value })}
                  />
                </label>
                <label className="inv-field inv-field--wide">
                  <span>Notes</span>
                  <textarea className="api-input api-textarea" rows={2} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
                </label>
                <label className="inv-field inv-field--wide">
                  <span>Terms</span>
                  <textarea className="api-input api-textarea" rows={2} value={draft.terms} onChange={(e) => update({ terms: e.target.value })} />
                </label>
                <ImageField label="Signature image" hint="Optional — a photo or scan of your signature." value={draft.signature} onChange={(signature) => update({ signature })} />
                <label className="inv-field">
                  <span>Signed by</span>
                  <input className="api-input" placeholder="Your name" value={draft.signatureName} onChange={(e) => update({ signatureName: e.target.value })} />
                </label>
              </div>
              <label className="lead-check inv-remember">
                <input type="checkbox" checked={rememberDetails} onChange={(e) => setRememberDetails(e.target.checked)} />
                Remember my business details, signature and template for the next invoice
              </label>
            </section>
          </div>

          <aside className="inv-preview">
            <div className="inv-preview__bar">
              <p className="card__title">Live preview</p>
              <div className="inv-downloads">
                <button type="button" className="btn btn--primary btn--sm" onClick={() => void exportAs('pdf')} disabled={busyExport === 'pdf'}>
                  {busyExport === 'pdf' ? <Loader2 size={14} className="spin" /> : <Download size={14} />} PDF
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={printInvoice} title="Opens the browser print window">
                  <Printer size={14} /> Print
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => void exportAs('png')} disabled={busyExport === 'png'}>
                  {busyExport === 'png' ? <Loader2 size={14} className="spin" /> : <ImageIcon size={14} />} PNG
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => void exportAs('html')}>
                  <FileText size={14} /> HTML
                </button>
              </div>
            </div>
            <div className="inv-frame" ref={frameRef} style={{ height: A4_HEIGHT * scale }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <InvoiceDocument invoice={draft} />
              </div>
            </div>
            <p className="api-hint">
              PDF saves an A4 file that looks exactly like this preview. Print opens the browser print window (for dark designs tick “Background
              graphics” there).
            </p>
          </aside>
        </div>
        {exportPortal}
      </>
    )
  }

  /* ---------- List ---------- */
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Billing</p>
          <h1>
            <em>Invoices</em>
          </h1>
          <p className="page-head__sub">Create, save and download invoices for your business.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={startNew} disabled={loading || setupRequired || Boolean(loadError)}>
          <Plus size={16} /> New invoice
        </button>
      </div>

      {saveError && (
        <div className="alert alert--error api-banner" role="alert">
          <AlertCircle size={16} />
          <span>{saveError}</span>
          <button type="button" className="api-icon-btn" onClick={() => setSaveError(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      {setupRequired ? (
        <SetupCard onRetry={() => void load()} checking={loading} />
      ) : loadError ? (
        <div className="alert alert--error api-banner" role="alert">
          <AlertCircle size={16} />
          <span>Couldn’t load your invoices: {loadError}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void load()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : loading ? (
        <div className="card api-loading">
          <Loader2 size={20} className="spin" /> Loading your invoices…
        </div>
      ) : (
        <>
          <section className="inv-stats">
            <article className="card stat">
              <div className="stat__label">
                <span>Invoices</span>
              </div>
              <p className="stat__value">{stats.count}</p>
            </article>
            <article className="card stat">
              <div className="stat__label">
                <span>Awaiting payment</span>
              </div>
              <p className="stat__value">{formatMoney(stats.outstanding, settings.currency)}</p>
            </article>
            <article className="card stat">
              <div className="stat__label">
                <span>Paid</span>
              </div>
              <p className="stat__value">{formatMoney(stats.paid, settings.currency)}</p>
            </article>
          </section>

          <section className="card card--flush">
            <header className="card__head inv-list__head">
              <div>
                <h2 className="card__title">All invoices</h2>
                <p className="card__sub">{filtered.length} shown</p>
              </div>
              <div className="inv-list__tools">
                <div className="api-toggle">
                  {(['all', 'draft', 'sent', 'paid'] as const).map((s) => (
                    <button key={s} type="button" className={statusFilter === s ? 'is-active' : ''} onClick={() => setStatusFilter(s)}>
                      {s === 'all' ? 'All' : STATUSES.find((x) => x.id === s)!.label}
                    </button>
                  ))}
                </div>
                <label className="api-table-search">
                  <Search size={15} />
                  <span className="sr-only">Search invoices</span>
                  <input type="search" placeholder="Search number or client…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
              </div>
            </header>

            {invoices.length === 0 ? (
              <div className="empty">
                <span className="empty__icon">
                  <FileText size={24} />
                </span>
                <h2>No invoices yet</h2>
                <p>Create your first invoice — your business details and signature are remembered for next time.</p>
                <button type="button" className="btn btn--primary" onClick={startNew}>
                  <Plus size={16} /> New invoice
                </button>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Client</th>
                      <th>Issued</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="table__id">{invoice.number}</td>
                        <td>
                          <div className="person__name">{invoice.client.name || '—'}</div>
                          <div className="person__email">{invoice.client.email}</div>
                        </td>
                        <td className="table__muted">{formatDate(invoice.issueDate)}</td>
                        <td className="table__muted">{formatDate(invoice.dueDate)}</td>
                        <td>
                          <span className={`status status--${invoice.status === 'paid' ? 'paid' : invoice.status === 'sent' ? 'pending' : 'refunded'}`}>
                            {STATUSES.find((s) => s.id === invoice.status)!.label}
                          </span>
                        </td>
                        <td className="num table__amount">{formatMoney(calcTotals(invoice).total, invoice.currency)}</td>
                        <td className="num">
                          <div className="inv-row-actions">
                            <button type="button" className="api-icon-btn" title="Download PDF" aria-label={`Download ${invoice.number} as PDF`} onClick={() => setExportTarget(invoice)}>
                              <Download size={15} />
                            </button>
                            <button type="button" className="api-icon-btn" title="Duplicate" aria-label={`Duplicate ${invoice.number}`} onClick={() => duplicate(invoice)}>
                              <Copy size={15} />
                            </button>
                            <button type="button" className="api-icon-btn" title="Edit" aria-label={`Edit ${invoice.number}`} onClick={() => edit(invoice)}>
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              className="api-icon-btn api-icon-btn--danger"
                              title="Delete"
                              aria-label={`Delete ${invoice.number}`}
                              onClick={() => void remove(invoice)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} className="api-table__none">
                          No invoices match your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {exportPortal}
    </>
  )
}
