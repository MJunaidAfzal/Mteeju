import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  AlertCircle,
  Check,
  ChevronDown,
  CloudUpload,
  Code2,
  Copy,
  Database,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import ApiResponse from '../components/ApiResponse'
import LeadFinder from '../components/LeadFinder'
import { isLeadFinderEndpoint } from '../lib/leads'
import {
  SetupRequiredError,
  deleteEndpointRow,
  deleteServiceRow,
  fetchServices,
  insertEndpoints,
  insertService,
  migrateLocalServices,
  updateEndpointRow,
} from '../lib/apiStore'
import setupSql from '../../supabase/migrations/20260919000000_api_services.sql?raw'
import {
  METHODS,
  buildUrl,
  emptyEndpoint,
  humaniseHost,
  isRapidApiHost,
  nameFromPath,
  newId,
  normaliseHost,
  parseSnippet,
  sendRequest,
  type ApiEndpoint,
  type ApiResult,
  type ApiService,
  type HttpMethod,
} from '../lib/rapidapi'
import './Apis.css'

interface Selection {
  serviceId: string
  endpointId: string
}

interface NewApi {
  name: string
  host: string
  endpoint: ApiEndpoint
}

function firstSelection(services: ApiService[]): Selection | null {
  const service = services.find((s) => s.endpoints.length > 0)
  return service ? { serviceId: service.id, endpointId: service.endpoints[0].id } : null
}

/* ---------- Add API dialog ---------- */

interface AddApiDialogProps {
  services: ApiService[]
  onClose: () => void
  onAdd: (api: NewApi) => void
}

function AddApiDialog({ services, onClose, onAdd }: AddApiDialogProps) {
  const [tab, setTab] = useState<'snippet' | 'manual'>('snippet')
  const [snippet, setSnippet] = useState('')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [endpointName, setEndpointName] = useState('')
  const [method, setMethod] = useState<HttpMethod>('GET')
  const [path, setPath] = useState('/')
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => (snippet.trim() ? parseSnippet(snippet) : null), [snippet])
  const targetHost = tab === 'snippet' ? (parsed?.host ?? '') : normaliseHost(host)
  const existing = services.find((s) => s.host === targetHost)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (tab === 'snippet') {
      if (!parsed) {
        setError('No RapidAPI URL found. Copy the whole snippet from the API’s “Code Snippets” tab.')
        return
      }
      onAdd({
        name: name.trim() || existing?.name || humaniseHost(parsed.host),
        host: parsed.host,
        endpoint: emptyEndpoint({
          name: nameFromPath(parsed.path),
          method: parsed.method,
          path: parsed.path,
          query: parsed.query,
          body: parsed.body,
        }),
      })
      return
    }

    const cleanHost = normaliseHost(host)
    if (!isRapidApiHost(cleanHost)) {
      setError('Enter the X-RapidAPI-Host, e.g. weatherapi-com.p.rapidapi.com')
      return
    }
    const cleanPath = path.trim() ? (path.trim().startsWith('/') ? path.trim() : `/${path.trim()}`) : '/'
    onAdd({
      name: name.trim() || existing?.name || humaniseHost(cleanHost),
      host: cleanHost,
      endpoint: emptyEndpoint({ name: endpointName.trim() || nameFromPath(cleanPath), method, path: cleanPath }),
    })
  }

  return (
    <div className="api-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="api-modal__panel" role="dialog" aria-modal="true" aria-labelledby="add-api-title" onSubmit={submit}>
        <header className="api-modal__head">
          <div>
            <h2 id="add-api-title" className="card__title">
              Add an API
            </h2>
            <p className="card__sub">Import straight from RapidAPI, or enter the details yourself.</p>
          </div>
          <button type="button" className="api-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="api-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'snippet'}
            className={tab === 'snippet' ? 'is-active' : ''}
            onClick={() => setTab('snippet')}
          >
            Paste code snippet
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'manual'}
            className={tab === 'manual' ? 'is-active' : ''}
            onClick={() => setTab('manual')}
          >
            Enter manually
          </button>
        </div>

        <div className="api-modal__body">
          {tab === 'snippet' ? (
            <>
              <label className="api-field">
                <span>Code snippet</span>
                <textarea
                  className="api-input api-input--mono api-textarea"
                  rows={8}
                  spellCheck={false}
                  placeholder={'On RapidAPI open the endpoint → Code Snippets → copy (JavaScript fetch, cURL, Python…) and paste it here.'}
                  value={snippet}
                  onChange={(e) => setSnippet(e.target.value)}
                  autoFocus
                />
              </label>

              {snippet.trim() &&
                (parsed ? (
                  <div className="api-detected">
                    <span className={`api-method api-method--${parsed.method.toLowerCase()}`}>{parsed.method}</span>
                    <code>
                      {parsed.host}
                      {parsed.path}
                    </code>
                    <span className="api-detected__meta">
                      {parsed.query.length} param{parsed.query.length === 1 ? '' : 's'}
                      {parsed.body ? ' · JSON body' : ''}
                    </span>
                  </div>
                ) : (
                  <p className="api-inline-error">No RapidAPI URL found in this snippet yet.</p>
                ))}
            </>
          ) : (
            <div className="api-grid-2">
              <label className="api-field api-field--wide">
                <span>X-RapidAPI-Host</span>
                <input
                  className="api-input api-input--mono"
                  placeholder="weatherapi-com.p.rapidapi.com"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="api-field">
                <span>Endpoint name</span>
                <input className="api-input" placeholder="Current weather" value={endpointName} onChange={(e) => setEndpointName(e.target.value)} />
              </label>
              <label className="api-field">
                <span>Method</span>
                <select className="api-input" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label className="api-field api-field--wide">
                <span>Path</span>
                <input className="api-input api-input--mono" placeholder="/current.json" value={path} onChange={(e) => setPath(e.target.value)} />
              </label>
            </div>
          )}

          <label className="api-field">
            <span>API name {existing ? '' : '(optional)'}</span>
            <input
              className="api-input"
              placeholder={existing?.name ?? (targetHost ? humaniseHost(targetHost) : 'e.g. Weather')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={Boolean(existing)}
            />
          </label>
          {existing && <p className="api-hint">This endpoint will be added to your existing “{existing.name}” API.</p>}
          {error && (
            <p className="api-inline-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="api-modal__foot">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            <Plus size={16} /> {existing ? 'Add endpoint' : 'Add API'}
          </button>
        </footer>
      </form>
    </div>
  )
}

/* ---------- Page ---------- */

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** Shown until the api_services / api_endpoints tables exist in Supabase. */
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
        <h2 className="card__title">Set up your database</h2>
        <p className="card__sub">Your APIs are saved in Supabase. Create the two tables once and this page is ready.</p>
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
          <button type="button" className="btn btn--primary" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy SQL'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onRetry} disabled={checking}>
            {checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Check again
          </button>
        </div>
        <p className="api-hint">
          The same script is in <code>supabase/migrations/20260919000000_api_services.sql</code>.
        </p>
      </div>
    </section>
  )
}

export default function Apis({ user }: { user: User }) {
  const userId = user.id
  const [services, setServices] = useState<ApiService[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [movedFromBrowser, setMovedFromBrowser] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [results, setResults] = useState<Record<string, ApiResult>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [tab, setTab] = useState<'params' | 'body'>('params')
  // Endpoints switched from the Lead Finder to the raw request view
  const [rawView, setRawView] = useState<Record<string, boolean>>({})

  // Edits are saved shortly after typing stops: endpoint id -> pending changes + timer
  const pendingRef = useRef(new Map<string, { patch: Partial<ApiEndpoint>; timer: number }>())
  const inFlightRef = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      let list = await fetchServices()
      if (await migrateLocalServices(userId, list)) {
        list = await fetchServices()
        setMovedFromBrowser(true)
      }
      setSetupRequired(false)
      setServices(list)
      setSelected((current) => {
        const stillThere = current && list.some((s) => s.id === current.serviceId && s.endpoints.some((e) => e.id === current.endpointId))
        return stillThere ? current : firstSelection(list)
      })
    } catch (err) {
      if (err instanceof SetupRequiredError) setSetupRequired(true)
      else setLoadError(err instanceof Error ? err.message : 'Could not load your APIs.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    // Loading from Supabase is async; state is only set once the request finishes
    void Promise.resolve().then(load)
  }, [load])

  /** Runs a database write and keeps the Saving / Saved indicator honest. */
  const persist = useCallback(
    async (write: () => Promise<void>) => {
      inFlightRef.current += 1
      setSaveState('saving')
      try {
        await write()
        inFlightRef.current -= 1
        if (inFlightRef.current === 0) setSaveState('saved')
      } catch (err) {
        inFlightRef.current -= 1
        setSaveState('error')
        setSaveError(err instanceof Error ? err.message : 'Could not save your change.')
        void load() // show what is really in the database
      }
    },
    [load],
  )

  const flushEndpoint = useCallback(
    (endpointId: string) => {
      const pending = pendingRef.current.get(endpointId)
      if (!pending) return
      window.clearTimeout(pending.timer)
      pendingRef.current.delete(endpointId)
      void persist(() => updateEndpointRow(endpointId, pending.patch))
    },
    [persist],
  )

  // Save anything still waiting when leaving the page
  useEffect(() => {
    const pending = pendingRef.current
    return () => {
      for (const [id, { patch, timer }] of pending) {
        window.clearTimeout(timer)
        void updateEndpointRow(id, patch).catch(() => undefined)
      }
      pending.clear()
    }
  }, [])

  const service = services.find((s) => s.id === selected?.serviceId)
  const endpoint = service?.endpoints.find((e) => e.id === selected?.endpointId)

  let previewUrl = ''
  if (service && endpoint) {
    try {
      previewUrl = buildUrl(service.host, endpoint.path, endpoint.query)
    } catch {
      previewUrl = ''
    }
  }

  function forgetPending(endpointId: string) {
    const pending = pendingRef.current.get(endpointId)
    if (pending) window.clearTimeout(pending.timer)
    pendingRef.current.delete(endpointId)
  }

  function updateEndpoint(patch: Partial<ApiEndpoint>) {
    if (!service || !endpoint) return
    const id = endpoint.id
    setServices((list) =>
      list.map((s) => (s.id !== service.id ? s : { ...s, endpoints: s.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
    )
    const pending = pendingRef.current.get(id)
    if (pending) window.clearTimeout(pending.timer)
    const merged = { ...pending?.patch, ...patch }
    const timer = window.setTimeout(() => flushEndpoint(id), 600)
    pendingRef.current.set(id, { patch: merged, timer })
    setSaveState('saving')
  }

  function addApi({ name, host, endpoint: ep }: NewApi) {
    const existing = services.find((s) => s.host === host)
    if (existing) {
      setServices((list) => list.map((s) => (s.id === existing.id ? { ...s, endpoints: [...s.endpoints, ep] } : s)))
      setSelected({ serviceId: existing.id, endpointId: ep.id })
      setCollapsed((c) => ({ ...c, [existing.id]: false }))
      void persist(() => insertEndpoints(existing.id, [ep], existing.endpoints.length))
    } else {
      const created: ApiService = { id: newId(), name, host, endpoints: [ep], createdAt: new Date().toISOString() }
      setServices((list) => [...list, created])
      setSelected({ serviceId: created.id, endpointId: ep.id })
      void persist(() => insertService(created))
    }
    setTab(ep.method === 'GET' ? 'params' : 'body')
    setShowAdd(false)
  }

  function addEndpoint(serviceId: string) {
    const ep = emptyEndpoint()
    const position = services.find((s) => s.id === serviceId)?.endpoints.length ?? 0
    setServices((list) => list.map((s) => (s.id === serviceId ? { ...s, endpoints: [...s.endpoints, ep] } : s)))
    setSelected({ serviceId, endpointId: ep.id })
    setCollapsed((c) => ({ ...c, [serviceId]: false }))
    setTab('params')
    void persist(() => insertEndpoints(serviceId, [ep], position))
  }

  function deleteService(target: ApiService) {
    if (!window.confirm(`Remove “${target.name}” and its ${target.endpoints.length} endpoint(s)?`)) return
    for (const e of target.endpoints) forgetPending(e.id)
    const remaining = services.filter((s) => s.id !== target.id)
    setServices(remaining)
    if (selected?.serviceId === target.id) setSelected(firstSelection(remaining))
    void persist(() => deleteServiceRow(target.id))
  }

  function deleteEndpoint() {
    if (!service || !endpoint) return
    if (!window.confirm(`Remove the “${endpoint.name}” endpoint?`)) return
    const id = endpoint.id
    forgetPending(id)
    const remaining = services.map((s) => (s.id === service.id ? { ...s, endpoints: s.endpoints.filter((e) => e.id !== id) } : s))
    setServices(remaining)
    const sibling = remaining.find((s) => s.id === service.id)?.endpoints[0]
    setSelected(sibling ? { serviceId: service.id, endpointId: sibling.id } : firstSelection(remaining))
    void persist(() => deleteEndpointRow(id))
  }

  async function send() {
    if (!service || !endpoint) return
    const id = endpoint.id
    flushEndpoint(id)
    setSending(id)
    setErrors((e) => ({ ...e, [id]: '' }))
    try {
      const result = await sendRequest({
        host: service.host,
        method: endpoint.method,
        path: endpoint.path,
        query: endpoint.query,
        body: endpoint.body,
      })
      setResults((r) => ({ ...r, [id]: result }))
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: err instanceof Error ? err.message : 'The request failed.' }))
    } finally {
      setSending(null)
    }
  }

  const endpointCount = services.reduce((n, s) => n + s.endpoints.length, 0)
  const leadCapable = Boolean(service && endpoint && isLeadFinderEndpoint(service, endpoint))
  const showLeadFinder = leadCapable && !(endpoint && rawView[endpoint.id])
  const bodyAllowed = endpoint ? endpoint.method !== 'GET' : false
  const activeTab = bodyAllowed ? tab : 'params'
  const result = endpoint ? results[endpoint.id] : undefined
  const error = endpoint ? errors[endpoint.id] : ''

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">RapidAPI</p>
          <h1>
            API <em>Hub</em>
          </h1>
          <p className="page-head__sub">Connect your RapidAPI services and call them from one place.</p>
          <div className="api-notes">
            <p className="api-secure-note">
              <ShieldCheck size={14} /> Requests go through your Supabase proxy — your RapidAPI key stays on the server.
            </p>
            {!setupRequired && !loading && !loadError && (
              <p className={`api-save api-save--${saveState}`} role="status">
                {saveState === 'saving' ? (
                  <>
                    <Loader2 size={13} className="spin" /> Saving…
                  </>
                ) : saveState === 'error' ? (
                  <>
                    <AlertCircle size={13} /> Not saved
                  </>
                ) : (
                  <>
                    <Database size={13} /> Saved in Supabase
                  </>
                )}
              </p>
            )}
          </div>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setShowAdd(true)} disabled={loading || setupRequired || Boolean(loadError)}>
          <Plus size={16} /> Add API
        </button>
      </div>

      {movedFromBrowser && (
        <div className="alert alert--success api-banner" role="status">
          <CloudUpload size={16} />
          <span>Your saved APIs were moved from this browser into your Supabase database.</span>
          <button type="button" className="api-icon-btn" onClick={() => setMovedFromBrowser(false)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
      {saveError && (
        <div className="alert alert--error api-banner" role="alert">
          <AlertCircle size={16} />
          <span>Couldn’t save to Supabase: {saveError}</span>
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
          <span>Couldn’t load your APIs from Supabase: {loadError}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void load()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : loading ? (
        <div className="card api-loading">
          <Loader2 size={20} className="spin" /> Loading your APIs…
        </div>
      ) : (
        <div className="api-layout">
          <aside className="card api-list">
            <header className="card__head api-list__head">
              <div>
                <h2 className="card__title">Your APIs</h2>
                <p className="card__sub">
                  {services.length} API{services.length === 1 ? '' : 's'} · {endpointCount} endpoint{endpointCount === 1 ? '' : 's'}
                </p>
              </div>
            </header>

            {services.length === 0 ? (
              <div className="api-list__empty">
                <Plug size={22} />
                <p>No APIs yet.</p>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setShowAdd(true)}>
                  <Plus size={14} /> Add your first API
                </button>
              </div>
            ) : (
              <ul className="api-services">
                {services.map((s) => {
                  const isCollapsed = collapsed[s.id]
                  return (
                    <li key={s.id} className="api-service">
                      <div className="api-service__row">
                        <button
                          type="button"
                          className="api-service__toggle"
                          onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !isCollapsed }))}
                          aria-expanded={!isCollapsed}
                        >
                          <ChevronDown size={16} className={`api-chevron${isCollapsed ? ' is-collapsed' : ''}`} />
                          <span className="api-service__text">
                            <span className="api-service__name">{s.name}</span>
                            <span className="api-service__host">{s.host}</span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="api-icon-btn"
                          onClick={() => addEndpoint(s.id)}
                          aria-label={`Add endpoint to ${s.name}`}
                          title="Add endpoint"
                        >
                          <Plus size={15} />
                        </button>
                        <button
                          type="button"
                          className="api-icon-btn api-icon-btn--danger"
                          onClick={() => deleteService(s)}
                          aria-label={`Remove ${s.name}`}
                          title="Remove API"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>

                      {!isCollapsed && (
                        <ul className="api-endpoints">
                          {s.endpoints.length === 0 && <li className="api-endpoints__none">No endpoints</li>}
                          {s.endpoints.map((e) => {
                            const isActive = selected?.endpointId === e.id
                            return (
                              <li key={e.id}>
                                <button
                                  type="button"
                                  className={`api-endpoint${isActive ? ' is-active' : ''}`}
                                  onClick={() => {
                                    setSelected({ serviceId: s.id, endpointId: e.id })
                                    setTab(e.method === 'GET' ? 'params' : 'body')
                                  }}
                                >
                                  <span className={`api-method api-method--${e.method.toLowerCase()}`}>{e.method}</span>
                                  <span className="api-endpoint__name">{e.name}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>

          <section className="card api-console">
            {!service || !endpoint ? (
              <div className="api-guide">
                <h2 className="card__title">How to add an API</h2>
                <ol>
                  <li>
                    On <strong>rapidapi.com</strong>, open the API you want and <strong>subscribe</strong> to a plan (many have a free Basic plan).
                  </li>
                  <li>
                    Open an endpoint, go to <strong>Code Snippets</strong> and copy the example (JavaScript <em>fetch</em>, cURL or Python all work).
                  </li>
                  <li>
                    Click <strong>Add API</strong> here and paste it — the host, path, parameters and body are filled in for you.
                  </li>
                  <li>
                    Press <strong>Send</strong> — the request goes through your Supabase proxy, which adds your RapidAPI key.
                  </li>
                </ol>
                <button type="button" className="btn btn--primary" onClick={() => setShowAdd(true)}>
                  <Plus size={16} /> Add API
                </button>
              </div>
            ) : (
              <>
                <header className="api-console__head">
                  <div className="api-console__title">
                    <input
                      className="api-title-input"
                      value={endpoint.name}
                      onChange={(e) => updateEndpoint({ name: e.target.value })}
                      aria-label="Endpoint name"
                    />
                    <p className="card__sub">
                      {service.name} · <span className="api-mono">{service.host}</span>
                    </p>
                  </div>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={deleteEndpoint}>
                    <Trash2 size={14} /> Delete
                  </button>
                </header>

                {leadCapable && (
                  <div className="api-toggle lead-mode" role="tablist" aria-label="View">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={showLeadFinder}
                      className={showLeadFinder ? 'is-active' : ''}
                      onClick={() => setRawView((v) => ({ ...v, [endpoint.id]: false }))}
                    >
                      <Target size={14} /> Lead finder
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={!showLeadFinder}
                      className={!showLeadFinder ? 'is-active' : ''}
                      onClick={() => setRawView((v) => ({ ...v, [endpoint.id]: true }))}
                    >
                      <Code2 size={14} /> Raw request
                    </button>
                  </div>
                )}

                {showLeadFinder ? (
                  <LeadFinder
                    key={endpoint.id}
                    service={service}
                    endpoint={endpoint}
                    onSettingsChange={(leadFinder) => updateEndpoint({ settings: { ...endpoint.settings, leadFinder } })}
                    onQueryChange={(value) => {
                      const hasQuery = endpoint.query.some((q) => q.key.trim() === 'query')
                      updateEndpoint({
                        query: hasQuery
                          ? endpoint.query.map((q) => (q.key.trim() === 'query' ? { ...q, value } : q))
                          : [...endpoint.query, { id: newId(), key: 'query', value }],
                      })
                    }}
                  />
                ) : (
                  <>
                    <form
                      className="api-request"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void send()
                      }}
                    >
                      <select
                        className={`api-input api-request__method api-method-text--${endpoint.method.toLowerCase()}`}
                        value={endpoint.method}
                        onChange={(e) => updateEndpoint({ method: e.target.value as HttpMethod })}
                        aria-label="HTTP method"
                      >
                        {METHODS.map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                      <div className="api-request__url">
                        <span className="api-request__host">{service.host}</span>
                        <input
                          className="api-request__path"
                          value={endpoint.path}
                          onChange={(e) => updateEndpoint({ path: e.target.value })}
                          spellCheck={false}
                          aria-label="Path"
                          placeholder="/path"
                        />
                      </div>
                      <button type="submit" className="btn btn--primary api-request__send" disabled={sending === endpoint.id}>
                        {sending === endpoint.id ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                        Send
                      </button>
                    </form>
                    {previewUrl && <p className="api-preview-url">{previewUrl}</p>}

                    <div className="api-tabs api-tabs--inline" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'params'}
                        className={activeTab === 'params' ? 'is-active' : ''}
                        onClick={() => setTab('params')}
                      >
                        Params {endpoint.query.length > 0 && <span className="api-count">{endpoint.query.length}</span>}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'body'}
                        className={activeTab === 'body' ? 'is-active' : ''}
                        onClick={() => setTab('body')}
                        disabled={!bodyAllowed}
                        title={bodyAllowed ? undefined : 'GET requests have no body'}
                      >
                        Body
                      </button>
                    </div>

                    {activeTab === 'params' ? (
                      <div className="api-params">
                        {endpoint.query.length === 0 && <p className="api-hint">No query parameters. Add one if the endpoint needs it.</p>}
                        {endpoint.query.map((q) => (
                          <div key={q.id} className="api-param">
                            <input
                              className="api-input api-input--mono"
                              placeholder="key"
                              value={q.key}
                              onChange={(e) =>
                                updateEndpoint({ query: endpoint.query.map((x) => (x.id === q.id ? { ...x, key: e.target.value } : x)) })
                              }
                            />
                            <input
                              className="api-input api-input--mono"
                              placeholder="value"
                              value={q.value}
                              onChange={(e) =>
                                updateEndpoint({ query: endpoint.query.map((x) => (x.id === q.id ? { ...x, value: e.target.value } : x)) })
                              }
                            />
                            <button
                              type="button"
                              className="api-icon-btn api-icon-btn--danger"
                              onClick={() => updateEndpoint({ query: endpoint.query.filter((x) => x.id !== q.id) })}
                              aria-label="Remove parameter"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm api-params__add"
                          onClick={() => updateEndpoint({ query: [...endpoint.query, { id: newId(), key: '', value: '' }] })}
                        >
                          <Plus size={14} /> Add parameter
                        </button>
                      </div>
                    ) : (
                      <div className="api-body">
                        <textarea
                          className="api-input api-input--mono api-textarea"
                          rows={8}
                          spellCheck={false}
                          placeholder='{ "key": "value" }'
                          value={endpoint.body}
                          onChange={(e) => updateEndpoint({ body: e.target.value })}
                        />
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            try {
                              updateEndpoint({ body: JSON.stringify(JSON.parse(endpoint.body), null, 2) })
                            } catch {
                              setErrors((e) => ({ ...e, [endpoint.id]: 'The body is not valid JSON.' }))
                            }
                          }}
                        >
                          Format JSON
                        </button>
                      </div>
                    )}

                    <div className="api-divider" />

                    {error ? (
                      <p className="api-inline-error api-inline-error--box" role="alert">
                        {error}
                      </p>
                    ) : null}
                    {result ? (
                      <ApiResponse key={`${endpoint.id}-${result.receivedAt}`} result={result} fileName={`${service.name}-${endpoint.name}`} />
                    ) : (
                      !error && <p className="api-hint api-response__empty">Press Send to see the response here.</p>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {showAdd && <AddApiDialog services={services} onClose={() => setShowAdd(false)} onAdd={addApi} />}
    </>
  )
}
