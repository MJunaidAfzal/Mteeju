// Saved leads: CSV import, filtering and contact enrichment.
import { supabase } from './supabase'
import { SetupRequiredError } from './apiStore'

export type LeadStatus = 'new' | 'enriched' | 'no_contacts' | 'contacted' | 'replied' | 'won' | 'lost' | 'unsubscribed'

export interface Lead {
  id: string
  name: string
  category: string
  phone: string
  website: string
  address: string
  city: string
  country: string
  rating: number | null
  reviews: number | null
  businessId: string
  source: string
  status: LeadStatus
  emails: string[]
  phones: string[]
  socials: Record<string, string>
  notes: string
  enrichedAt: string | null
  createdAt?: string
}

export const LEAD_STATUSES: { id: LeadStatus; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'enriched', label: 'Enriched' },
  { id: 'no_contacts', label: 'No contacts' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'replied', label: 'Replied' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'unsubscribed', label: 'Unsubscribed' },
]

export const SOCIAL_ORDER = ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'youtube', 'whatsapp', 'telegram']

/* ---------- CSV ---------- */

/** Splits CSV text into rows, honouring quotes, escaped quotes and newlines inside fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const clean = text.replace(/^﻿/, '')
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else field += char
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)
  return rows
}

export type LeadField = 'name' | 'category' | 'phone' | 'website' | 'address' | 'city' | 'country' | 'rating' | 'reviews' | 'businessId' | 'emails' | 'skip'

export const FIELD_LABELS: { id: LeadField; label: string }[] = [
  { id: 'name', label: 'Business name' },
  { id: 'category', label: 'Category' },
  { id: 'phone', label: 'Phone' },
  { id: 'website', label: 'Website' },
  { id: 'emails', label: 'Email' },
  { id: 'address', label: 'Address' },
  { id: 'city', label: 'City' },
  { id: 'country', label: 'Country' },
  { id: 'rating', label: 'Rating' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'businessId', label: 'Google business ID' },
  { id: 'skip', label: '— Skip this column —' },
]

const MATCHERS: { field: LeadField; patterns: RegExp[] }[] = [
  { field: 'businessId', patterns: [/^(business[\s_-]?id|google[\s_-]?id|place[\s_-]?id|cid|data[\s_-]?id|^id$)/i] },
  { field: 'name', patterns: [/^(name|business|title|company)/i] },
  { field: 'category', patterns: [/^(categor|type|industry)/i] },
  { field: 'emails', patterns: [/e-?mail/i] },
  { field: 'phone', patterns: [/phone|mobile|tel|contact number/i] },
  { field: 'website', patterns: [/web|site|url|domain/i] },
  { field: 'city', patterns: [/^(city|town|search area|area)/i] },
  { field: 'country', patterns: [/^countr/i] },
  { field: 'address', patterns: [/address|street|location/i] },
  { field: 'rating', patterns: [/rating|stars|score/i] },
  { field: 'reviews', patterns: [/review/i] },
]

/** Guesses which lead field each CSV column holds, from its header. */
export function guessMapping(headers: string[]): LeadField[] {
  const used = new Set<LeadField>()
  return headers.map((header) => {
    const clean = header.trim()
    for (const { field, patterns } of MATCHERS) {
      if (used.has(field) && field !== 'skip') continue
      if (patterns.some((p) => p.test(clean))) {
        used.add(field)
        return field
      }
    }
    return 'skip'
  })
}

const asNumber = (value: string) => {
  const n = Number(String(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Builds leads from CSV rows using the column mapping. */
export function rowsToLeads(rows: string[][], mapping: LeadField[], source: string): Lead[] {
  const [, ...body] = rows
  const leads: Lead[] = []
  for (const row of body) {
    const lead: Lead = {
      id: crypto.randomUUID(),
      name: '',
      category: '',
      phone: '',
      website: '',
      address: '',
      city: '',
      country: '',
      rating: null,
      reviews: null,
      businessId: '',
      source,
      status: 'new',
      emails: [],
      phones: [],
      socials: {},
      notes: '',
      enrichedAt: null,
    }
    mapping.forEach((field, i) => {
      const value = (row[i] ?? '').trim()
      if (!value || field === 'skip') return
      if (field === 'rating') lead.rating = asNumber(value)
      else if (field === 'reviews') lead.reviews = asNumber(value)
      else if (field === 'emails') lead.emails = value.split(/[,;\s]+/).filter((e) => e.includes('@'))
      else lead[field] = value
    })
    if (!lead.name && !lead.businessId) continue
    if (lead.phone) lead.phones = [lead.phone]
    leads.push(lead)
  }
  return leads
}

/** Place name from a file like "leads-cafe-abu-dhabi-united-arab-emirates.csv". */
export function guessSource(fileName: string) {
  return fileName.replace(/\.csv$/i, '').replace(/[-_]+/g, ' ').trim()
}

export function leadsToCsv(leads: Lead[]) {
  const columns = ['Name', 'Category', 'Phone', 'Emails', 'Website', 'Address', 'City', 'Country', 'Rating', 'Reviews', 'Status', ...SOCIAL_ORDER.map((s) => s[0].toUpperCase() + s.slice(1)), 'Source', 'Business ID']
  const escape = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
  const lines = [columns.join(',')]
  for (const lead of leads) {
    lines.push(
      [
        lead.name,
        lead.category,
        lead.phones.join(' / ') || lead.phone,
        lead.emails.join(' / '),
        lead.website,
        lead.address,
        lead.city,
        lead.country,
        lead.rating ?? '',
        lead.reviews ?? '',
        lead.status,
        ...SOCIAL_ORDER.map((s) => lead.socials[s] ?? ''),
        lead.source,
        lead.businessId,
      ]
        .map((v) => escape(String(v ?? '')))
        .join(','),
    )
  }
  return '﻿' + lines.join('\r\n')
}

/* ---------- Supabase ---------- */

function fail(error: { code?: string; message: string }): never {
  if (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message)) {
    throw new SetupRequiredError('The leads table does not exist in Supabase yet.')
  }
  throw new Error(error.message)
}

interface LeadRow {
  id: string
  name: string
  category: string
  phone: string
  website: string
  address: string
  city: string
  country: string
  rating: string | number | null
  reviews: number | null
  business_id: string
  source: string
  status: LeadStatus
  emails: string[] | null
  phones: string[] | null
  socials: Record<string, string> | null
  notes: string
  enriched_at: string | null
  created_at: string
}

const fromRow = (row: LeadRow): Lead => ({
  id: row.id,
  name: row.name,
  category: row.category,
  phone: row.phone,
  website: row.website,
  address: row.address,
  city: row.city,
  country: row.country,
  rating: row.rating === null ? null : Number(row.rating),
  reviews: row.reviews,
  businessId: row.business_id,
  source: row.source,
  status: row.status,
  emails: row.emails ?? [],
  phones: row.phones ?? [],
  socials: row.socials ?? {},
  notes: row.notes ?? '',
  enrichedAt: row.enriched_at,
  createdAt: row.created_at,
})

const toRow = (lead: Lead) => ({
  id: lead.id,
  name: lead.name,
  category: lead.category,
  phone: lead.phone,
  website: lead.website,
  address: lead.address,
  city: lead.city,
  country: lead.country,
  rating: lead.rating,
  reviews: lead.reviews,
  business_id: lead.businessId,
  source: lead.source,
  status: lead.status,
  emails: lead.emails,
  phones: lead.phones,
  socials: lead.socials,
  notes: lead.notes,
})

export async function fetchLeads(): Promise<Lead[]> {
  const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(5000)
  if (error) fail(error)
  return (data as LeadRow[]).map(fromRow)
}

/** Inserts the rows, silently skipping ones already imported. Returns how many were added. */
export async function importLeads(leads: Lead[]): Promise<number> {
  let added = 0
  for (let i = 0; i < leads.length; i += 200) {
    const slice = leads.slice(i, i + 200).map(toRow)
    const { data, error } = await supabase.from('leads').upsert(slice, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true }).select('id')
    if (error) fail(error)
    added += (data ?? []).length
  }
  return added
}

export async function updateLead(id: string, patch: Partial<Lead>) {
  const row: Record<string, unknown> = {}
  if (patch.status !== undefined) row.status = patch.status
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.emails !== undefined) row.emails = patch.emails
  if (patch.phones !== undefined) row.phones = patch.phones
  if (patch.socials !== undefined) row.socials = patch.socials
  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('leads').update(row).eq('id', id)
  if (error) fail(error)
}

export async function deleteLeads(ids: string[]) {
  const { error } = await supabase.from('leads').delete().in('id', ids)
  if (error) fail(error)
}

export interface EnrichResult {
  updated: number
  withEmail: number
  withSocial: number
  /** Leads with no website anywhere — emails are read from the website, so these stay empty. */
  noWebsite?: number
  notes: string[]
}

/** Sends up to 200 lead ids to the enrichment function; it writes the contacts back itself. */
export async function enrichLeads(leadIds: string[]): Promise<EnrichResult> {
  const { data, error } = await supabase.functions.invoke('leads-enrich', { body: { leadIds } })
  if (error) {
    let message = 'Could not reach the "leads-enrich" function. Is it deployed in Supabase?'
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json()
        if (payload?.error) message = String(payload.error)
      } catch {
        // keep the generic message
      }
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(String(data.error))
  return data as EnrichResult
}
