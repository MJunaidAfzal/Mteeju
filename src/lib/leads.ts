// Lead Finder: turns country / city / niche choices into Google Maps searches and collects unique leads.
import countries from '../data/countries.json'
import { sendRequest, type ApiEndpoint, type ApiResult, type ApiService, type KeyValue } from './rapidapi'
import { findRecords, flatten, type Row } from './tableize'

export interface Country {
  code: string
  name: string
}

export interface City {
  name: string
  region: string
  lat?: number
  lng?: number
}

export interface LeadSettings {
  country: string
  /** null = all cities in the country, largest first */
  city: City | null
  niche: string
  count: number
  minRating: number
  minReviews: number
  needPhone: boolean
  needWebsite: boolean
}

export const DEFAULT_SETTINGS: LeadSettings = {
  country: '',
  city: null,
  niche: '',
  count: 20,
  minRating: 0,
  minReviews: 0,
  needPhone: false,
  needWebsite: false,
}

export const COUNTRIES = countries as Country[]
export const countryName = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code

export const NICHE_SUGGESTIONS = [
  'Restaurants',
  'Dentists',
  'Real estate agents',
  'Gyms',
  'Beauty salons',
  'Plumbers',
  'Lawyers',
  'Hotels',
  'Cafes',
  'Car repair',
  'Clinics',
  'Marketing agencies',
]

export const MAX_LEADS = 500
const MAX_REQUESTS = 25

/** The Google Map Scraper "Search Places" endpoint (query + optional lat/long). */
export function isLeadFinderEndpoint(service: ApiService, endpoint: ApiEndpoint) {
  return /google-?map/i.test(service.host) && /places\/search/i.test(endpoint.path)
}

export function readSettings(endpoint: ApiEndpoint): LeadSettings {
  const saved = (endpoint.settings?.leadFinder ?? {}) as Partial<LeadSettings>
  return { ...DEFAULT_SETTINGS, ...saved }
}

/* ---------- Cities (loaded per country from /public/geo/cities) ---------- */

const cityCache = new Map<string, Promise<City[]>>()

export function loadCities(code: string): Promise<City[]> {
  let cached = cityCache.get(code)
  if (!cached) {
    cached = fetch(`/geo/cities/${code}.json`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: [string, string, number, number][]) => rows.map(([name, region, lat, lng]) => ({ name, region, lat, lng })))
      .catch(() => [])
    cityCache.set(code, cached)
  }
  return cached
}

/* ---------- Search plan ---------- */

export function buildQuery(niche: string, place: string) {
  return `${niche.trim()} in ${place}`
}

export function placeLabel(city: City | null, country: string) {
  if (!city) return countryName(country)
  return [city.name, city.region && city.region !== city.name ? city.region : '', countryName(country)].filter(Boolean).join(', ')
}

interface SearchTarget {
  query: string
  lat?: number
  lng?: number
  area: string
}

/** Points around a city centre (km offsets in 8 directions, widening rings) so each search surfaces different places. */
function pointsAround(lat: number, lng: number, max: number) {
  const points = [{ lat, lng }]
  const dirs = [0, 90, 180, 270, 45, 135, 225, 315]
  for (const km of [4, 9, 15]) {
    for (const deg of dirs) {
      const rad = (deg * Math.PI) / 180
      const dLat = (km * Math.cos(rad)) / 111
      const dLng = (km * Math.sin(rad)) / (111 * Math.cos((lat * Math.PI) / 180))
      points.push({ lat: Number((lat + dLat).toFixed(5)), lng: Number((lng + dLng).toFixed(5)) })
    }
  }
  return points.slice(0, max)
}

export const hasFilters = (s: LeadSettings) => s.minRating > 0 || s.minReviews > 0 || s.needPhone || s.needWebsite

/** How many searches to plan: ~20 places per search, some repeats, more when filters drop places. */
export function requestBudget(settings: LeadSettings) {
  const base = Math.ceil(settings.count / 8) + 1
  return Math.min(MAX_REQUESTS, Math.max(2, hasFilters(settings) ? Math.ceil(base * 1.75) : base))
}

async function planTargets(settings: LeadSettings): Promise<SearchTarget[]> {
  const budget = requestBudget(settings)
  const country = countryName(settings.country)
  const { city, niche } = settings

  if (city) {
    const query = buildQuery(niche, placeLabel(city, settings.country))
    // A typed-in place has no coordinates: one search is all we can do
    if (city.lat === undefined || city.lng === undefined) return [{ query, area: city.name }]
    return pointsAround(city.lat, city.lng, budget).map((p) => ({ query, lat: p.lat, lng: p.lng, area: city.name }))
  }

  // Whole country: spread the searches over its largest cities
  const cities = (await loadCities(settings.country)).slice(0, budget)
  if (cities.length === 0) return [{ query: buildQuery(niche, country), area: country }]
  return cities.map((c) => ({ query: buildQuery(niche, `${c.name}, ${country}`), lat: c.lat, lng: c.lng, area: c.name }))
}

/* ---------- Reading results ---------- */

type FieldKind = 'id' | 'name' | 'rating' | 'reviews' | 'phone' | 'website' | 'address' | 'category'

const FIELD_PATTERNS: Record<FieldKind, RegExp[]> = {
  id: [/^(place_?id|business_?id|google_?id|cid|data_?id|id)$/i],
  name: [/^(name|title|business_?name|place_?name)$/i],
  rating: [/^(rating|stars|score|total_?score|average_?rating|avg_?rating)$/i, /(^|\.)rating$/i],
  reviews: [/reviews?_?(count|total|number)/i, /^(user_)?ratings?_?(total|count)$/i, /^reviews$/i, /^review_?count$/i],
  phone: [/phone/i, /^tel(ephone)?$/i],
  website: [/website/i, /^(site|domain|web_?url|url_?website)$/i],
  address: [/full_?address/i, /^address$/i, /address/i],
  category: [/^(category|main_?category|type|business_?type)$/i, /categor/i],
}

const toNumber = (v: unknown) => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s]/g, ''))
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

const VALIDATORS: Partial<Record<FieldKind, (v: unknown) => boolean>> = {
  rating: (v) => {
    const n = toNumber(v)
    return n >= 0 && n <= 5
  },
  reviews: (v) => toNumber(v) >= 0,
  phone: (v) => typeof v === 'string' && /\d{5,}/.test(v.replace(/\D/g, '')),
  website: (v) => typeof v === 'string' && /^https?:\/\//i.test(v) && !/google\.[a-z.]+\/maps/i.test(v),
}

/** Finds which column holds each kind of value, by name and by what the values look like. */
function detectFields(rows: Row[]) {
  const keys = [...new Set(rows.slice(0, 20).flatMap((r) => Object.keys(r)))]
  const found: Partial<Record<FieldKind, string>> = {}
  for (const kind of Object.keys(FIELD_PATTERNS) as FieldKind[]) {
    const valid = VALIDATORS[kind]
    for (const pattern of FIELD_PATTERNS[kind]) {
      const key = keys.find((k) => pattern.test(k) && (!valid || rows.some((r) => valid(r[k]))))
      if (key) {
        found[kind] = key
        break
      }
    }
  }
  return found
}

/* ---------- Running a search ---------- */

export interface LeadProgress {
  done: number
  total: number
  found: number
  area: string
}

/** Why the search stopped */
export type LeadStop = 'enough' | 'exhausted' | 'budget' | 'cancelled' | 'error'

export interface LeadRun {
  result: ApiResult
  leads: Row[]
  requested: number
  requestsUsed: number
  stop: LeadStop
  skippedFilters: string[]
  partialError?: string
}

function apiError(result: ApiResult) {
  try {
    const data = JSON.parse(result.body)
    if (data?.message) return String(data.message)
    if (data?.error) return String(data.error)
  } catch {
    // not JSON
  }
  return `The API answered ${result.status}.`
}

export async function runLeadSearch(
  service: ApiService,
  endpoint: ApiEndpoint,
  settings: LeadSettings,
  onProgress: (p: LeadProgress) => void,
  signal: { cancelled: boolean },
): Promise<LeadRun> {
  const targets = await planTargets(settings)
  const gridMode = Boolean(settings.city && settings.city.lat !== undefined)
  // Keep any other params the endpoint has; query/lat/long are set per search
  const baseQuery = endpoint.query.filter((q) => !['query', 'lat', 'long'].includes(q.key.trim()))

  const all = new Map<string, Row>()
  let fields: ReturnType<typeof detectFields> = {}
  let requestsUsed = 0
  let totalMs = 0
  let lastResult: ApiResult | null = null
  let emptyStreak = 0
  let partialError: string | undefined
  let exhausted = false

  const matching = () => {
    const rows = [...all.values()]
    return rows.filter((r) => {
      if (settings.minRating > 0 && fields.rating && !(toNumber(r[fields.rating]) >= settings.minRating)) return false
      if (settings.minReviews > 0 && fields.reviews && !(toNumber(r[fields.reviews]) >= settings.minReviews)) return false
      if (settings.needPhone && fields.phone && !VALIDATORS.phone!(r[fields.phone])) return false
      if (settings.needWebsite && fields.website && !VALIDATORS.website!(r[fields.website])) return false
      return true
    })
  }

  for (const target of targets) {
    if (signal.cancelled || matching().length >= settings.count) break
    onProgress({ done: requestsUsed, total: targets.length, found: matching().length, area: target.area })

    const query: KeyValue[] = [...baseQuery, { id: 'q', key: 'query', value: target.query }]
    if (target.lat !== undefined && target.lng !== undefined) {
      query.push({ id: 'lat', key: 'lat', value: String(target.lat) }, { id: 'long', key: 'long', value: String(target.lng) })
    }

    let result: ApiResult
    try {
      result = await sendRequest({ host: service.host, method: 'GET', path: endpoint.path, query, body: '' })
    } catch (err) {
      if (requestsUsed === 0) throw err
      partialError = err instanceof Error ? err.message : 'A search failed.'
      break
    }
    requestsUsed += 1
    totalMs += result.durationMs
    lastResult = result
    if (result.status < 200 || result.status >= 300) {
      if (requestsUsed === 1) throw new Error(apiError(result))
      partialError = apiError(result)
      break
    }

    const records = findRecords(result.body).map((r) => flatten(r))
    fields = detectFields([...all.values(), ...records])
    let added = 0
    for (const record of records) {
      const id = fields.id ? String(record[fields.id] ?? '') : ''
      const key = id || `${record[fields.name ?? 'name'] ?? ''}|${record[fields.address ?? 'address'] ?? ''}`
      if (!key || key === '|' || all.has(key)) continue
      all.set(key, gridMode ? record : { ...record, search_area: target.area })
      added += 1
    }
    // Two searches in a row with nothing new: this area has no more places for the query
    emptyStreak = added === 0 ? emptyStreak + 1 : 0
    if (gridMode && emptyStreak >= 2) {
      exhausted = true
      break
    }
  }

  const leads = matching().slice(0, settings.count)
  onProgress({ done: requestsUsed, total: targets.length, found: leads.length, area: '' })

  const skippedFilters: string[] = []
  if (settings.minRating > 0 && !fields.rating) skippedFilters.push('minimum rating')
  if (settings.minReviews > 0 && !fields.reviews) skippedFilters.push('minimum reviews')
  if (settings.needPhone && !fields.phone) skippedFilters.push('has phone')
  if (settings.needWebsite && !fields.website) skippedFilters.push('has website')

  // Put the most useful columns first
  const lead = (r: Row): Row => {
    const first: Row = {}
    for (const kind of ['name', 'category', 'rating', 'reviews', 'phone', 'website', 'address'] as FieldKind[]) {
      const key = fields[kind]
      if (key && key in r) first[key] = r[key]
    }
    return { ...first, ...r }
  }
  const ordered = leads.map(lead)
  const body = JSON.stringify({ leads: ordered })

  return {
    result: {
      status: lastResult?.status ?? 200,
      statusText: lastResult?.statusText ?? '',
      contentType: 'application/json',
      body,
      size: new Blob([body]).size,
      durationMs: totalMs,
      quota: lastResult?.quota ?? {},
      receivedAt: Date.now(),
    },
    leads: ordered,
    requested: settings.count,
    requestsUsed,
    stop: signal.cancelled
      ? 'cancelled'
      : partialError
        ? 'error'
        : ordered.length >= settings.count
          ? 'enough'
          : exhausted || targets.length <= 1 || requestsUsed < targets.length
            ? 'exhausted'
            : 'budget',
    skippedFilters,
    partialError,
  }
}
