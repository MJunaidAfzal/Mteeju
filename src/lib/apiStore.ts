// Saves RapidAPI services and endpoints in Supabase (tables: api_services, api_endpoints).
import { supabase } from './supabase'
import { newId, type ApiEndpoint, type ApiService, type HttpMethod, type KeyValue } from './rapidapi'

interface EndpointRow {
  id: string
  name: string
  method: HttpMethod
  path: string
  query: { key: string; value: string }[] | null
  body: string | null
  position: number
  settings?: Record<string, unknown> | null
}

interface ServiceRow {
  id: string
  name: string
  host: string
  created_at: string
  api_endpoints: EndpointRow[] | null
}

/** The tables haven't been created yet — the SQL setup script needs to be run. */
export class SetupRequiredError extends Error {}

// Whether api_endpoints has the "settings" column (added by the second SQL script)
let settingsColumn = true
export const hasSettingsColumn = () => settingsColumn

const isMissingSettingsColumn = (error: { code?: string; message: string }) =>
  error.code === '42703' || /settings/i.test(error.message)

function fail(error: { code?: string; message: string }): never {
  if (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message)) {
    throw new SetupRequiredError('The API tables do not exist in Supabase yet.')
  }
  throw new Error(error.message)
}

// Query rows keep an id in the UI only (for React keys); the database stores plain { key, value }
const queryToDb = (query: KeyValue[]) => query.map(({ key, value }) => ({ key, value }))
const queryFromDb = (query: EndpointRow['query']): KeyValue[] => (query ?? []).map(({ key, value }) => ({ id: newId(), key, value }))

function endpointToRow(serviceId: string, endpoint: ApiEndpoint, position: number) {
  return {
    id: endpoint.id,
    service_id: serviceId,
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    query: queryToDb(endpoint.query),
    body: endpoint.body,
    position,
    ...(settingsColumn && endpoint.settings ? { settings: endpoint.settings } : {}),
  }
}

function selectServices(withSettings: boolean) {
  const endpointColumns = `id, name, method, path, query, body, position${withSettings ? ', settings' : ''}`
  return supabase
    .from('api_services')
    .select(`id, name, host, created_at, api_endpoints(${endpointColumns})`)
    .order('created_at')
    .order('position', { referencedTable: 'api_endpoints' })
    .order('created_at', { referencedTable: 'api_endpoints' })
}

export async function fetchServices(): Promise<ApiService[]> {
  let { data, error } = await selectServices(true)
  if (error && isMissingSettingsColumn(error)) {
    // Second SQL script not run yet — everything still works, choices just aren't remembered
    settingsColumn = false
    ;({ data, error } = await selectServices(false))
  } else if (!error) {
    settingsColumn = true
  }
  if (error) fail(error)

  return (data as unknown as ServiceRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    host: s.host,
    createdAt: s.created_at,
    endpoints: (s.api_endpoints ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      method: e.method,
      path: e.path,
      query: queryFromDb(e.query),
      body: e.body ?? '',
      settings: e.settings ?? {},
    })),
  }))
}

export async function insertEndpoints(serviceId: string, endpoints: ApiEndpoint[], startPosition: number) {
  if (endpoints.length === 0) return
  const { error } = await supabase.from('api_endpoints').insert(endpoints.map((e, i) => endpointToRow(serviceId, e, startPosition + i)))
  if (error) fail(error)
}

export async function insertService(service: ApiService) {
  const { error } = await supabase.from('api_services').insert({ id: service.id, name: service.name, host: service.host })
  if (error) fail(error)
  await insertEndpoints(service.id, service.endpoints, 0)
}

export async function updateEndpointRow(id: string, patch: Partial<Omit<ApiEndpoint, 'id'>>) {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.method !== undefined) row.method = patch.method
  if (patch.path !== undefined) row.path = patch.path
  if (patch.query !== undefined) row.query = queryToDb(patch.query)
  if (patch.body !== undefined) row.body = patch.body
  if (patch.settings !== undefined && settingsColumn) row.settings = patch.settings
  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('api_endpoints').update(row).eq('id', id)
  if (error) fail(error)
}

export async function deleteServiceRow(id: string) {
  // Its endpoints are removed by the database (on delete cascade)
  const { error } = await supabase.from('api_services').delete().eq('id', id)
  if (error) fail(error)
}

export async function deleteEndpointRow(id: string) {
  const { error } = await supabase.from('api_endpoints').delete().eq('id', id)
  if (error) fail(error)
}

// One move per user at a time, even if the page asks twice (React dev mode runs effects twice)
const migrations = new Map<string, Promise<boolean>>()

/**
 * One-time move of services saved by the earlier browser-only version into Supabase.
 * The browser copy is deleted only after everything has been saved. Returns true if anything moved.
 */
export function migrateLocalServices(userId: string, existing: ApiService[]): Promise<boolean> {
  let running = migrations.get(userId)
  if (!running) {
    running = moveLocalServices(userId, existing).finally(() => migrations.delete(userId))
    migrations.set(userId, running)
  }
  return running
}

async function moveLocalServices(userId: string, existing: ApiService[]): Promise<boolean> {
  const storageKey = `teeju.rapidapi.services.${userId}`
  let local: ApiService[] = []
  try {
    local = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
  } catch {
    local = []
  }

  const byHost = new Map(existing.map((s) => [s.host, s]))
  for (const service of Array.isArray(local) ? local : []) {
    if (!service?.host) continue
    const endpoints = (service.endpoints ?? []).map((e) => ({ ...e, id: newId(), query: e.query ?? [], body: e.body ?? '' }))
    const match = byHost.get(service.host)
    if (match) {
      // Skip endpoints that are already saved (same method + path)
      const known = new Set(match.endpoints.map((e) => `${e.method} ${e.path}`))
      const fresh = endpoints.filter((e) => !known.has(`${e.method} ${e.path}`))
      await insertEndpoints(match.id, fresh, match.endpoints.length)
      match.endpoints.push(...fresh)
    } else {
      const created: ApiService = { id: newId(), name: service.name || service.host, host: service.host, endpoints, createdAt: new Date().toISOString() }
      await insertService(created)
      byHost.set(created.host, created)
    }
  }

  try {
    localStorage.removeItem(storageKey)
    // Leftovers from the old browser-key mode
    localStorage.removeItem(`teeju.rapidapi.key.${userId}`)
    localStorage.removeItem(`teeju.rapidapi.mode.${userId}`)
  } catch {
    // Storage unavailable — nothing to clean up
  }
  return local.length > 0
}
