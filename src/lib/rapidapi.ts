import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export interface KeyValue {
  id: string
  key: string
  value: string
}

export interface ApiEndpoint {
  id: string
  name: string
  method: HttpMethod
  path: string
  query: KeyValue[]
  body: string
  /** Extra UI state saved with the endpoint, e.g. Lead Finder choices */
  settings?: Record<string, unknown>
}

export interface ApiService {
  id: string
  name: string
  host: string
  endpoints: ApiEndpoint[]
  createdAt: string
}

export interface ApiResult {
  status: number
  statusText: string
  contentType: string
  body: string
  size: number
  durationMs: number
  quota: { limit?: string; remaining?: string }
  /** When the response arrived — lets the UI reset its view for each new response */
  receivedAt: number
}

export const newId = (): string => crypto.randomUUID()

export function emptyEndpoint(partial: Partial<ApiEndpoint> = {}): ApiEndpoint {
  return { id: newId(), name: 'New endpoint', method: 'GET', path: '/', query: [], body: '', ...partial }
}

/* ---------- Hosts & URLs ---------- */

export function normaliseHost(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split(/[/?#]/)[0]
}

export function isRapidApiHost(host: string) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.rapidapi\.com$/.test(host)
}

/** "weatherapi-com.p.rapidapi.com" → "Weatherapi Com" */
export function humaniseHost(host: string) {
  const first = host.split('.')[0] ?? host
  return first.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function buildUrl(host: string, path: string, query: KeyValue[]) {
  const url = new URL(`https://${host}${path.startsWith('/') ? path : `/${path}`}`)
  // Guard against paths like "@other-site.com" changing the destination
  if (url.hostname !== host) throw new Error('That path is not valid for this API host.')
  for (const { key, value } of query) {
    if (key.trim()) url.searchParams.append(key.trim(), value)
  }
  return url.toString()
}

export function prettyBody(body: string, contentType: string) {
  const looksJson = contentType.includes('json') || /^\s*[[{]/.test(body)
  if (!looksJson) return body
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

// HTTP/2 responses carry no status text, so fall back to the standard phrase
const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
  404: 'Not Found', 405: 'Method Not Allowed', 408: 'Timeout', 413: 'Payload Too Large', 422: 'Unprocessable',
  429: 'Too Many Requests', 500: 'Server Error', 502: 'Bad Gateway', 503: 'Unavailable', 504: 'Gateway Timeout',
}

export function statusLabel(status: number, statusText: string) {
  return statusText || STATUS_TEXT[status] || ''
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/* ---------- Code-snippet import ---------- */

export interface ParsedSnippet {
  host: string
  method: HttpMethod
  path: string
  query: KeyValue[]
  body: string
}

/** Returns the text between the bracket at `openIndex` and its matching close, respecting quoted strings. */
function balanced(text: string, openIndex: number): string | null {
  const open = text[openIndex]
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : null
  if (!close) return null
  let depth = 0
  let quote: string | null = null
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === open) depth++
    else if (ch === close && --depth === 0) return text.slice(openIndex + 1, i)
  }
  return null
}

function toJsonText(source: string) {
  const src = source.trim()
  try {
    return JSON.stringify(JSON.parse(src), null, 2)
  } catch {
    // Loosen a JS object literal into JSON: quote bare keys, swap single quotes, drop trailing commas
    try {
      const fixed = src
        .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
        .replace(/'((?:[^'\\]|\\.)*)'/g, '"$1"')
        .replace(/,\s*([}\]])/g, '$1')
      return JSON.stringify(JSON.parse(fixed), null, 2)
    } catch {
      return src
    }
  }
}

function objectAfter(text: string, pattern: RegExp) {
  const match = pattern.exec(text)
  if (!match) return null
  const braceIndex = match.index + match[0].length - 1
  const inner = balanced(text, braceIndex)
  return inner === null ? null : `{${inner}}`
}

function extractBody(text: string): string {
  const stringifyAt = text.indexOf('JSON.stringify(')
  if (stringifyAt !== -1) {
    const inner = balanced(text, stringifyAt + 'JSON.stringify'.length)?.trim()
    if (inner) {
      // JSON.stringify(data) → look up `const data = {...}`
      if (/^[A-Za-z_$][\w$]*$/.test(inner)) {
        const obj = objectAfter(text, new RegExp(`(?:const|let|var)\\s+${inner}\\s*=\\s*\\{`))
        if (obj) return toJsonText(obj)
      } else {
        return toJsonText(inner)
      }
    }
  }
  const curlData = text.match(/--data(?:-raw)?\s+'([\s\S]*?)'/)
  if (curlData) return toJsonText(curlData[1])
  const obj = objectAfter(text, /\bdata:\s*\{/) ?? objectAfter(text, /\bpayload\s*=\s*\{/)
  return obj ? toJsonText(obj) : ''
}

function extractExtraParams(text: string): KeyValue[] {
  // Python `querystring = {...}` and axios `params: {...}`
  const obj = objectAfter(text, /\bquerystring\s*=\s*\{/) ?? objectAfter(text, /\bparams:\s*\{/)
  if (!obj) return []
  return [...obj.matchAll(/["']?([\w.-]+)["']?\s*:\s*["']([^"']*)["']/g)].map((m) => ({ id: newId(), key: m[1], value: m[2] }))
}

/** Reads a RapidAPI "Code Snippets" example (fetch, axios, cURL, Python requests…) into a request. */
export function parseSnippet(text: string): ParsedSnippet | null {
  const urlMatch = text.match(/https?:\/\/[a-z0-9.-]+\.rapidapi\.com[^\s'"`\\]*/i)
  if (!urlMatch) return null
  let url: URL
  try {
    url = new URL(urlMatch[0])
  } catch {
    return null
  }

  const hostHeader = text.match(/x-rapidapi-host['"]?\s*[:=,]\s*['"]?([a-z0-9.-]+\.rapidapi\.com)/i)
  const methodMatch =
    text.match(/method['"]?\s*[:=]\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i) ??
    text.match(/(?:--request|-X)\s+['"]?(GET|POST|PUT|PATCH|DELETE)\b/i) ??
    text.match(/\brequest\(\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i) ??
    text.match(/\.(get|post|put|patch|delete)\(\s*['"`]https?:/i)

  const body = extractBody(text)
  const method = (methodMatch?.[1]?.toUpperCase() as HttpMethod | undefined) ?? (body ? 'POST' : 'GET')
  const query = [...url.searchParams].map(([key, value]) => ({ id: newId(), key, value }))
  const known = new Set(query.map((q) => q.key))
  for (const extra of extractExtraParams(text)) if (!known.has(extra.key)) query.push(extra)

  return {
    host: normaliseHost(hostHeader?.[1] ?? url.hostname),
    method,
    path: url.pathname || '/',
    query,
    body: method === 'GET' ? '' : body,
  }
}

/** "/v1/current.json" → "Current" */
export function nameFromPath(path: string) {
  const last = path.split('/').filter(Boolean).pop() ?? ''
  const clean = last.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').trim()
  return clean ? clean.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Root'
}

/* ---------- Sending requests ---------- */

interface SendOptions {
  host: string
  method: HttpMethod
  path: string
  query: KeyValue[]
  body: string
}

async function describeFunctionError(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const data = await error.context.json()
      if (data?.error) return String(data.error)
    } catch {
      // fall through to the generic message
    }
    return `The Supabase proxy returned an error (${error.context.status}).`
  }
  return 'Could not reach the "rapidapi-proxy" function. Make sure it is deployed in Supabase.'
}

/** Sends the request through the "rapidapi-proxy" Supabase Edge Function, which adds the RapidAPI key. */
export async function sendRequest({ host, method, path, query, body }: SendOptions): Promise<ApiResult> {
  if (!isRapidApiHost(host)) throw new Error('The host must be a RapidAPI host ending in .rapidapi.com.')
  buildUrl(host, path, query) // validates the path before anything is sent
  const hasBody = method !== 'GET' && body.trim() !== ''
  const started = performance.now()

  const { data, error } = await supabase.functions.invoke('rapidapi-proxy', {
    body: {
      host,
      method,
      path,
      query: query.filter((q) => q.key.trim()).map((q) => [q.key.trim(), q.value]),
      body: hasBody ? body : undefined,
    },
  })
  if (error) throw new Error(await describeFunctionError(error))

  const text = String(data.body ?? '')
  return {
    status: data.status,
    statusText: data.statusText ?? '',
    contentType: data.contentType ?? '',
    body: text,
    size: new Blob([text]).size,
    durationMs: Math.round(performance.now() - started),
    quota: data.quota ?? {},
    receivedAt: Date.now(),
  }
}
