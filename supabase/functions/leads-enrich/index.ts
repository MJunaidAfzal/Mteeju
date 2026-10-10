// Supabase Edge Function: fills in emails, extra phones and social profiles for saved leads.
//
// Uses two RapidAPI services with the RAPIDAPI_KEY secret (the same one the API proxy uses):
//   1. local-business-data      /business-details  — by Google business id, 20 per request
//   2. website-contacts-scraper /scrape-contacts   — by website domain, 20 per request
//
// Deploy: Dashboard → Edge Functions → Deploy a new function → Via Editor (name: leads-enrich)
//         or  npx supabase functions deploy leads-enrich

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const BUSINESS_HOST = 'local-business-data.p.rapidapi.com'
const CONTACTS_HOST = 'website-contacts-scraper.p.rapidapi.com'
const BATCH = 20
const MAX_LEADS = 200

interface Lead {
  id: string
  name: string
  website: string
  phone: string
  business_id: string
  emails: string[]
  phones: string[]
  socials: Record<string, string>
}

interface Contacts {
  emails: string[]
  phones: string[]
  socials: Record<string, string>
}

const SOCIAL_KEYS = ['facebook', 'instagram', 'linkedin', 'twitter', 'x', 'tiktok', 'youtube', 'pinterest', 'snapchat', 'whatsapp', 'telegram']

const empty = (): Contacts => ({ emails: [], phones: [], socials: {} })

/** The two APIs return emails as strings or as objects — accept both. */
function asList(value: unknown): string[] {
  if (!value) return []
  const items = Array.isArray(value) ? value : [value]
  return items
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        return String(obj.value ?? obj.email ?? obj.number ?? obj.phone ?? '')
      }
      return ''
    })
    .map((s) => s.trim())
    .filter(Boolean)
}

function readSocials(source: Record<string, unknown>): Record<string, string> {
  const socials: Record<string, string> = {}
  for (const key of SOCIAL_KEYS) {
    const raw = source[key] ?? source[`${key}_url`] ?? source[`${key}Url`]
    const [first] = asList(raw)
    if (first) socials[key === 'x' ? 'twitter' : key] = first
  }
  return socials
}

function merge(into: Contacts, from: Contacts) {
  into.emails = [...new Set([...into.emails, ...from.emails])]
  into.phones = [...new Set([...into.phones, ...from.phones])]
  into.socials = { ...from.socials, ...into.socials }
}

const rootDomain = (website: string) => {
  try {
    return new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

async function callRapid(host: string, path: string, key: string) {
  const res = await fetch(`https://${host}${path}`, { headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': host } })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {
    data = {}
  }
  if (!res.ok) {
    const message = (data.message as string) ?? (data.error as string) ?? `${host} returned ${res.status}.`
    throw new Error(message)
  }
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return json({ error: 'You must be signed in to enrich leads.' }, 401)

  const key = Deno.env.get('RAPIDAPI_KEY')
  if (!key) return json({ error: 'The RAPIDAPI_KEY secret is not set in Supabase.' }, 500)

  let payload: { leadIds?: string[] }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  const ids = (payload.leadIds ?? []).slice(0, MAX_LEADS)
  if (ids.length === 0) return json({ error: 'No leads were given.' }, 400)

  const { data: rows, error } = await supabase
    .from('leads')
    .select('id, name, website, phone, business_id, emails, phones, socials')
    .in('id', ids)
  if (error) return json({ error: error.message }, 400)

  const leads = (rows ?? []) as Lead[]
  const found = new Map<string, Contacts>(leads.map((l) => [l.id, empty()]))
  // Map exports often leave the website out; Google knows it, so keep whatever the first call returns.
  const foundSite = new Map<string, string>()
  const siteOf = (lead: Lead) => rootDomain(lead.website || foundSite.get(lead.id) || '')
  const notes: string[] = []

  // ---- 1. Google business details (emails + socials in one call)
  const withBusiness = leads.filter((l) => l.business_id?.trim())
  for (let i = 0; i < withBusiness.length; i += BATCH) {
    const slice = withBusiness.slice(i, i + BATCH)
    const query = slice.map((l) => encodeURIComponent(l.business_id.trim())).join('%2C')
    try {
      const data = await callRapid(BUSINESS_HOST, `/business-details?business_id=${query}&extract_emails_and_contacts=true`, key)
      const list = (data.data ?? []) as Record<string, unknown>[]
      list.forEach((item, index) => {
        const lead = slice.find((l) => l.business_id.trim() === String(item.business_id ?? item.place_id ?? '')) ?? slice[index]
        if (!lead) return
        const contacts = (item.emails_and_contacts ?? {}) as Record<string, unknown>
        const site = String(item.website ?? item.site ?? '')
        if (site) foundSite.set(lead.id, site)
        merge(found.get(lead.id)!, {
          emails: asList(contacts.emails),
          phones: [...asList(contacts.phones), ...asList(item.phone_number)],
          socials: { ...readSocials(item), ...readSocials(contacts) },
        })
      })
    } catch (err) {
      notes.push(err instanceof Error ? err.message : 'Business lookup failed.')
    }
  }

  // ---- 2. Website scrape for anything still missing an email
  const needSite = leads.filter((l) => found.get(l.id)!.emails.length === 0 && siteOf(l))
  const domains = [...new Set(needSite.map(siteOf))]
  for (let i = 0; i < domains.length; i += BATCH) {
    const slice = domains.slice(i, i + BATCH)
    try {
      const data = await callRapid(CONTACTS_HOST, `/scrape-contacts?query=${slice.map(encodeURIComponent).join('%2C')}`, key)
      const list = (data.data ?? []) as Record<string, unknown>[]
      for (const item of list) {
        const domain = String(item.domain ?? item.query ?? '').replace(/^www\./, '')
        for (const lead of needSite.filter((l) => siteOf(l) === domain)) {
          merge(found.get(lead.id)!, {
            emails: asList(item.emails),
            phones: asList(item.phone_numbers ?? item.phones),
            socials: readSocials(item),
          })
        }
      }
    } catch (err) {
      notes.push(err instanceof Error ? err.message : 'Website lookup failed.')
    }
  }

  // ---- 3. Save what was found
  let withEmail = 0
  let withSocial = 0
  let updated = 0
  let noWebsite = 0
  for (const lead of leads) {
    const contacts = found.get(lead.id)!
    const emails = [...new Set([...(lead.emails ?? []), ...contacts.emails])]
    const phones = [...new Set([...(lead.phones ?? []), ...contacts.phones, ...(lead.phone ? [lead.phone] : [])])]
    const socials = { ...contacts.socials, ...(lead.socials ?? {}) }
    const website = lead.website || foundSite.get(lead.id) || ''
    const hasAny = emails.length > 0 || Object.keys(socials).length > 0
    if (!website) noWebsite += 1

    const { error: updateError } = await supabase
      .from('leads')
      .update({ emails, phones, socials, website, enriched_at: new Date().toISOString(), status: hasAny ? 'enriched' : 'no_contacts' })
      .eq('id', lead.id)
    if (updateError) {
      notes.push(updateError.message)
      continue
    }
    updated += 1
    if (emails.length) withEmail += 1
    if (Object.keys(socials).length) withSocial += 1
  }

  return json({ updated, withEmail, withSocial, noWebsite, notes: [...new Set(notes)].slice(0, 3) })
})
