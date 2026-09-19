import { useEffect, useMemo, useRef, useState } from 'react'
import 'flag-icons/css/flag-icons.min.css'
import './LeadFinder.css'
import { AlertCircle, Check, Copy, Info, Loader2, MapPin, Search, Square } from 'lucide-react'
import Combobox, { type ComboOption } from './Combobox'
import ApiResponse from './ApiResponse'
import { hasSettingsColumn } from '../lib/apiStore'
import type { ApiEndpoint, ApiService } from '../lib/rapidapi'
import {
  COUNTRIES,
  MAX_LEADS,
  NICHE_SUGGESTIONS,
  buildQuery,
  countryName,
  hasFilters,
  loadCities,
  placeLabel,
  readSettings,
  requestBudget,
  runLeadSearch,
  type City,
  type LeadProgress,
  type LeadRun,
  type LeadSettings,
} from '../lib/leads'
import settingsSql from '../../supabase/migrations/20260919010000_api_endpoint_settings.sql?raw'

const Flag = ({ code }: { code: string }) => <span className={`fi fi-${code.toLowerCase()} lead-flag`} aria-hidden="true" />

const COUNTRY_OPTIONS: ComboOption[] = COUNTRIES.map((c) => ({ value: c.code, label: c.name, icon: <Flag code={c.code} /> }))
const ALL_CITIES = 'all'
const RATING_OPTIONS = [0, 3, 3.5, 4, 4.5]
const REVIEW_OPTIONS = [0, 10, 50, 100, 500]
const COUNT_PRESETS = [20, 50, 100, 200]

interface LeadFinderProps {
  service: ApiService
  endpoint: ApiEndpoint
  onSettingsChange: (settings: LeadSettings) => void
  onQueryChange: (query: string) => void
}

export default function LeadFinder({ service, endpoint, onSettingsChange, onQueryChange }: LeadFinderProps) {
  const [settings, setSettings] = useState<LeadSettings>(() => readSettings(endpoint))
  const [cities, setCities] = useState<{ code: string; list: City[] }>({ code: '', list: [] })
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<LeadProgress | null>(null)
  const [run, setRun] = useState<LeadRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sqlCopied, setSqlCopied] = useState(false)
  const signalRef = useRef({ cancelled: false })

  // Load the chosen country's cities (one small file per country)
  useEffect(() => {
    if (!settings.country) return
    let stale = false
    void loadCities(settings.country).then((list) => {
      if (!stale) setCities({ code: settings.country, list })
    })
    return () => {
      stale = true
    }
  }, [settings.country])

  const citiesLoading = Boolean(settings.country) && cities.code !== settings.country
  const cityOptions = useMemo<ComboOption[]>(
    () => (cities.code === settings.country ? cities.list.map((c, i) => ({ value: String(i), label: c.name, sub: c.region })) : []),
    [cities, settings.country],
  )
  const selectedCityValue = (() => {
    const city = settings.city
    if (!city) return settings.country ? ALL_CITIES : ''
    const index = cities.list.findIndex((c) => c.name === city.name && c.region === city.region)
    return index >= 0 && cities.code === settings.country ? String(index) : `custom:${city.name}`
  })()

  function update(patch: Partial<LeadSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    onSettingsChange(next)
  }

  const niche = settings.niche.trim()
  const canRun = Boolean(settings.country && niche && settings.count > 0) && !running
  const place = settings.country ? placeLabel(settings.city, settings.country) : ''
  const preview = settings.country && niche ? buildQuery(niche, place) : ''
  const budget = requestBudget(settings)
  const typedPlace = settings.city !== null && settings.city.lat === undefined
  const maxSearches = typedPlace ? 1 : budget

  async function find() {
    if (!canRun) return
    signalRef.current = { cancelled: false }
    setRunning(true)
    setError(null)
    setRun(null)
    setProgress(null)
    onQueryChange(preview)
    try {
      const result = await runLeadSearch(service, endpoint, settings, setProgress, signalRef.current)
      setRun(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The search failed.')
    } finally {
      setRunning(false)
    }
  }

  async function copySql() {
    try {
      await navigator.clipboard.writeText(settingsSql)
      setSqlCopied(true)
      window.setTimeout(() => setSqlCopied(false), 1800)
    } catch {
      // Clipboard blocked; the file path is shown too
    }
  }

  const found = run?.leads.length ?? 0

  return (
    <div className="lead">
      <div className="lead-grid">
        <Combobox
          label="Country"
          options={COUNTRY_OPTIONS}
          value={settings.country}
          onChange={(code) => update({ country: code, city: null })}
          placeholder="Select a country"
          display={settings.country ? { label: countryName(settings.country), icon: <Flag code={settings.country} /> } : null}
          emptyText="No country matches"
          disabled={running}
        />

        <Combobox
          label="City"
          options={cityOptions}
          value={selectedCityValue}
          onChange={(value) => update({ city: value === ALL_CITIES ? null : (cities.list[Number(value)] ?? null) })}
          onCustom={(name) => update({ city: { name, region: '' } })}
          pinned={[
            {
              value: ALL_CITIES,
              label: 'All cities',
              sub: 'Spread the search over the largest cities',
              icon: <MapPin size={15} className="lead-pin" />,
            },
          ]}
          placeholder={settings.country ? 'All cities' : 'Select a country first'}
          display={
            !settings.country
              ? null
              : settings.city
                ? {
                    label: settings.city.name,
                    sub: settings.city.region || (typedPlace ? 'Typed place' : undefined),
                    icon: <MapPin size={15} className="lead-pin" />,
                  }
                : { label: 'All cities', sub: 'Largest first', icon: <MapPin size={15} className="lead-pin" /> }
          }
          loading={citiesLoading}
          disabled={!settings.country || running}
          emptyText="No city matches — keep typing to use your own"
        />

        <label className="lead-field lead-field--wide">
          <span>Niche</span>
          <input
            className="api-input"
            placeholder="e.g. dentists, coffee shops, real estate agents"
            value={settings.niche}
            onChange={(e) => update({ niche: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && void find()}
            disabled={running}
          />
        </label>
        <div className="lead-chips lead-field--wide" aria-label="Niche suggestions">
          {NICHE_SUGGESTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={`lead-chip${settings.niche.toLowerCase() === n.toLowerCase() ? ' is-active' : ''}`}
              onClick={() => update({ niche: n })}
              disabled={running}
            >
              {n}
            </button>
          ))}
        </div>

        <label className="lead-field">
          <span>How many leads</span>
          <input
            className="api-input"
            type="number"
            min={1}
            max={MAX_LEADS}
            value={settings.count}
            onChange={(e) => update({ count: Math.max(1, Math.min(MAX_LEADS, Math.round(Number(e.target.value) || 1))) })}
            disabled={running}
          />
        </label>
        <div className="lead-field">
          <span>Quick pick</span>
          <div className="lead-presets">
            {COUNT_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`lead-chip${settings.count === n ? ' is-active' : ''}`}
                onClick={() => update({ count: n })}
                disabled={running}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <fieldset className="lead-filters" disabled={running}>
        <legend>Filters</legend>
        <label className="lead-field">
          <span>Minimum rating</span>
          <select className="api-input" value={settings.minRating} onChange={(e) => update({ minRating: Number(e.target.value) })}>
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r === 0 ? 'Any rating' : `${r.toFixed(1)} ★ and up`}
              </option>
            ))}
          </select>
        </label>
        <label className="lead-field">
          <span>Minimum reviews</span>
          <select className="api-input" value={settings.minReviews} onChange={(e) => update({ minReviews: Number(e.target.value) })}>
            {REVIEW_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r === 0 ? 'Any number' : `${r}+ reviews`}
              </option>
            ))}
          </select>
        </label>
        <label className="lead-check">
          <input type="checkbox" checked={settings.needPhone} onChange={(e) => update({ needPhone: e.target.checked })} />
          Has a phone number
        </label>
        <label className="lead-check">
          <input type="checkbox" checked={settings.needWebsite} onChange={(e) => update({ needWebsite: e.target.checked })} />
          Has a website
        </label>
      </fieldset>

      <div className="lead-run">
        <div className="lead-run__info">
          {preview ? (
            <p>
              Searching <strong>“{preview}”</strong>
            </p>
          ) : (
            <p className="api-hint">Choose a country and enter a niche to start.</p>
          )}
          <p className="api-hint">
            Uses up to {maxSearches} API request{maxSearches === 1 ? '' : 's'} · each request returns about 20 places
            {typedPlace ? ' · pick a city from the list to search more widely' : ''}
          </p>
        </div>
        {running ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              signalRef.current.cancelled = true
            }}
          >
            <Square size={14} /> Stop
          </button>
        ) : (
          <button type="button" className="btn btn--primary lead-run__go" onClick={() => void find()} disabled={!canRun}>
            <Search size={16} /> Find leads
          </button>
        )}
      </div>

      {running && progress && (
        <div className="lead-progress" role="status">
          <div className="lead-progress__bar">
            <span style={{ width: `${Math.min(100, (progress.found / settings.count) * 100)}%` }} />
          </div>
          <p>
            <Loader2 size={14} className="spin" /> Search {Math.min(progress.done + 1, progress.total)} of up to {progress.total}
            {progress.area ? ` · ${progress.area}` : ''} · <strong>{progress.found}</strong> of {settings.count} leads found
          </p>
        </div>
      )}

      {error && (
        <p className="api-inline-error api-inline-error--box" role="alert">
          {error}
        </p>
      )}

      {run && (
        <>
          <div className={`lead-summary${found >= run.requested ? ' is-complete' : ''}`}>
            <p>
              Found <strong>{found}</strong> of {run.requested} leads · {run.requestsUsed} search{run.requestsUsed === 1 ? '' : 'es'} used
            </p>
            {run.stop === 'cancelled' && <p>Stopped — showing the leads found so far.</p>}
            {run.stop === 'exhausted' && (
              <p>
                <Info size={14} /> Google Maps had no more matching places for this search. Try “All cities”, a bigger city, a broader niche or fewer
                filters.
              </p>
            )}
            {run.stop === 'budget' && (
              <p>
                <Info size={14} /> Used all {run.requestsUsed} planned searches
                {hasFilters(settings) ? ' — your filters removed some places' : ''}. Search again with a higher number, “All cities” or fewer filters to
                find more.
              </p>
            )}
            {run.partialError && (
              <p>
                <AlertCircle size={14} /> Stopped early: {run.partialError}
              </p>
            )}
            {run.skippedFilters.length > 0 && (
              <p>
                <Info size={14} /> Not applied because the API didn’t return that information: {run.skippedFilters.join(', ')}.
              </p>
            )}
          </div>
          {found > 0 && <ApiResponse key={run.result.receivedAt} result={run.result} fileName={`leads-${settings.niche}-${place}`} />}
        </>
      )}

      {!hasSettingsColumn() && (
        <div className="lead-note">
          <Info size={15} />
          <span>
            To remember these choices next time, run one more small SQL script in Supabase (<code>20260919010000_api_endpoint_settings.sql</code>).
          </span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void copySql()}>
            {sqlCopied ? <Check size={14} /> : <Copy size={14} />} {sqlCopied ? 'Copied' : 'Copy SQL'}
          </button>
        </div>
      )}
    </div>
  )
}
