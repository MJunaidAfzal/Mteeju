// The Teeju assistant: what it knows, what it can do, and how a turn is run.
import { supabase } from './supabase'
import { fetchServices } from './apiStore'
import { sendRequest } from './rapidapi'
import { isLeadFinderEndpoint, loadCities, countryName, runLeadSearch, COUNTRIES, type LeadSettings, type Presence } from './leads'
import { findRecords, flatten } from './tableize'
import { fetchLeads } from './leadStore'
import { countsFor, fetchCampaigns, fetchDue } from './outreach'
import {
  ACCENTS,
  TEMPLATES,
  accentForTemplate,
  addDays,
  blankInvoice,
  calcTotals,
  deleteInvoice,
  fetchInvoices,
  fetchSettings,
  formatMoney,
  newItem,
  nextNumber,
  upsertInvoice,
  type AccentId,
  type Invoice,
  type InvoiceStatus,
  type TemplateId,
} from './invoices'

export type PageId = 'dashboard' | 'apis' | 'invoices' | 'social' | 'leads' | 'outreach'

export interface AgentContext {
  /** Opens a page in the portal */
  navigate: (page: PageId) => void
  /** Renders an invoice off-screen and downloads it */
  download: (invoice: Invoice, format: 'pdf' | 'png' | 'html') => Promise<void>
  userName: string
}

export interface GeminiPart {
  text?: string
  functionCall?: { name: string; id?: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> }
}

export interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/* ---------- What the assistant knows about the portal ---------- */

export const SYSTEM_PROMPT = `You are the Teeju assistant, built into the Teeju business portal. You help the owner get things done inside the portal.

The portal has these pages:
- Dashboard: a greeting and the Supabase connection status.
- APIs: saved RapidAPI services. Requests go through a secure Supabase proxy, so the RapidAPI key never reaches the browser. Each service holds endpoints the owner can call, and the response can be read as a table, as JSON or saved as CSV. The Google Map Scraper endpoint has a Lead Finder: pick a country, a city and a niche, set how many leads and optional filters (minimum rating, minimum reviews, has/has no phone, has/has no website), and it runs several Google Maps searches around the city — a grid of points out to 25km and then the towns within 45km — up to 40 requests, collecting unique businesses. Results can be saved straight to the Leads page.
- Invoices: create, save, edit and download invoices. Nine templates (classic, modern, minimal, luxe, bold, compact, noir, royal, onyx — the last four are black & gold) and colour options. Invoices are saved in the user's own Supabase database and can be downloaded as PDF, PNG or HTML.
- Social: write a post, preview it per network, schedule it on a calendar and track accounts and insights.
- Leads: the saved list of businesses. Import a CSV (or save a Lead Finder run), then "enrich" them — that visits each website to find emails, extra phone numbers and social profiles, and costs one RapidAPI credit per business. Rows can be filtered by status, source and contact details, searched, exported as CSV, deleted, and each lead has a status: new, enriched, no_contacts, contacted, replied, won, lost, unsubscribed. The table is paged, 25 rows a page by default.
- Outreach: campaigns that work through those leads over several days. Every message is a WhatsApp message — there is no email anywhere in the portal.

How Outreach works, in detail:
- A campaign picks a set of leads (all of them, or one source/file), and has steps: "on day 1 send this", "on day 3 send this". New campaigns start with a five-step sequence over ten days (days 1, 3, 5, 7, 10) offering a free demo website.
- A message can contain {{name}}, {{category}}, {{city}}, {{rating}}, {{reviews}} and {{website}}; each is filled in with that lead's own details. The campaign's sign-off is added to the end of every message.
- Each campaign has a daily cap, a sending window (from hour / to hour) and a time zone. Only leads with a phone number can be reached.
- Normally nothing sends itself: due messages appear in the portal, the "Next up" card shows the one on deck, and one click (or the Enter key; S skips) opens WhatsApp with the message already typed. The owner presses send inside WhatsApp, and the portal ticks it off. This needs them to be logged in at web.whatsapp.com.
- A campaign can instead be switched to automatic, which delivers it through Meta's official WhatsApp Cloud API with an approved template — that needs the WHATSAPP_TOKEN and WHATSAPP_PHONE_ID secrets in Supabase and the whatsapp-send Edge Function. Automatic campaigns never appear in the click list.
- Leads marked replied, won, lost or unsubscribed are dropped from every campaign. A campaign with nothing left to send finishes on its own.
- Safe pace: 30-50 new WhatsApp chats a day, more than that risks the number being banned.

How to behave:
- Use the tools to actually do the work. Never say a task is done unless a tool returned success.
- Reply in the same language the user writes in (English, Urdu or Roman Urdu). Keep answers short — two or three sentences unless asked for detail.
- When a task finishes, state clearly what was done, including names, numbers and totals from the tool result.
- If something fails or information is missing, say so plainly and ask one short question.
- Saving an invoice, changing one, deleting one, or running a lead search all need the user's confirmation; the portal shows a confirm card automatically, so simply call the tool and then report what happened.
- Money amounts: use the invoice's own currency. Today's date is available in the tool results; never invent data.`

/* ---------- Tools ---------- */

const item = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'What is being charged for' },
    qty: { type: 'number', description: 'Quantity (default 1)' },
    rate: { type: 'number', description: 'Price per unit' },
  },
  required: ['description', 'rate'],
}

export const TOOL_DECLARATIONS = [
  {
    name: 'portal_overview',
    description: 'Summary of the portal: counts of invoices, saved APIs, money paid and outstanding. Use it for questions like "how are things going".',
  },
  {
    name: 'list_invoices',
    description: 'List saved invoices, newest first. Filter by status or search by number, client name or email.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'sent', 'paid'] },
        search: { type: 'string', description: 'Text to match against invoice number, client name or email' },
        limit: { type: 'number', description: 'How many to return (default 10)' },
      },
    },
  },
  {
    name: 'create_invoice',
    description: 'Create a new invoice for a client. The user confirms before it is saved.',
    parameters: {
      type: 'object',
      properties: {
        client_name: { type: 'string' },
        client_email: { type: 'string' },
        client_phone: { type: 'string' },
        client_address: { type: 'string' },
        items: { type: 'array', items: item, description: 'The lines being billed' },
        currency: { type: 'string', description: 'Three-letter code, e.g. PKR, USD, AED' },
        tax_rate: { type: 'number', description: 'Tax percentage, e.g. 5' },
        discount: { type: 'number' },
        discount_type: { type: 'string', enum: ['amount', 'percent'] },
        shipping: { type: 'number' },
        template: { type: 'string', enum: TEMPLATES.map((t) => t.id) },
        accent: { type: 'string', enum: ACCENTS.map((a) => a.id).concat(['champagne', 'rose', 'silver']) },
        due_in_days: { type: 'number', description: 'Days until the invoice is due' },
        status: { type: 'string', enum: ['draft', 'sent', 'paid'] },
        notes: { type: 'string' },
      },
      required: ['client_name', 'items'],
    },
  },
  {
    name: 'update_invoice',
    description: 'Change a saved invoice: its status, template, colour, tax, due date, or add more items. The user confirms first.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'string', description: 'Invoice number, e.g. INV-0003' },
        status: { type: 'string', enum: ['draft', 'sent', 'paid'] },
        template: { type: 'string', enum: TEMPLATES.map((t) => t.id) },
        accent: { type: 'string' },
        tax_rate: { type: 'number' },
        due_in_days: { type: 'number' },
        add_items: { type: 'array', items: item },
        notes: { type: 'string' },
      },
      required: ['number'],
    },
  },
  {
    name: 'delete_invoice',
    description: 'Delete a saved invoice. Always confirmed by the user first.',
    parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] },
  },
  {
    name: 'download_invoice',
    description: 'Download a saved invoice as a file.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'string' },
        format: { type: 'string', enum: ['pdf', 'png', 'html'], description: 'Default pdf' },
      },
      required: ['number'],
    },
  },
  {
    name: 'find_leads',
    description: 'Find business leads from Google Maps for a niche in a country/city, using the saved Google Map Scraper API. Uses RapidAPI quota, so the user confirms first.',
    parameters: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'e.g. dentists, gyms, restaurants' },
        country: { type: 'string', description: 'Country name, e.g. Pakistan' },
        city: { type: 'string', description: 'City name; leave out to search the whole country' },
        count: { type: 'number', description: 'How many leads to collect (default 20)' },
        min_rating: { type: 'number' },
        min_reviews: { type: 'number' },
        phone: { type: 'string', enum: ['any', 'yes', 'no'], description: '"yes" = only places with a phone, "no" = only places without one' },
        website: { type: 'string', enum: ['any', 'yes', 'no'], description: '"yes" = only places with a website, "no" = only places without one' },
      },
      required: ['niche', 'country'],
    },
  },
  {
    name: 'list_leads',
    description:
      'The saved leads: how many there are, how they break down by status and by source, and a few examples. Use it for questions like "how many leads do I have" or "how many have a phone number".',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'enriched', 'no_contacts', 'contacted', 'replied', 'won', 'lost', 'unsubscribed'] },
        source: { type: 'string', description: 'The file or search a lead came from' },
        search: { type: 'string', description: 'Text to match against name, category, city, email or phone' },
        limit: { type: 'number', description: 'How many examples to return (default 10)' },
      },
    },
  },
  {
    name: 'list_campaigns',
    description:
      'The outreach campaigns with their status, pacing and progress: how many messages are sent, waiting, and ready to send on WhatsApp right now. Use it for "what is running" or "how many messages are waiting".',
  },
  {
    name: 'list_apis',
    description: 'List the RapidAPI services and endpoints saved in the portal.',
  },
  {
    name: 'call_api_endpoint',
    description: 'Run one saved API endpoint and return a short summary of the response.',
    parameters: {
      type: 'object',
      properties: {
        api: { type: 'string', description: 'Saved API name or host' },
        endpoint: { type: 'string', description: 'Endpoint name or path' },
        params: { type: 'object', description: 'Query parameters as key/value pairs' },
      },
      required: ['api', 'endpoint'],
    },
  },
  {
    name: 'open_page',
    description: 'Open a page of the portal for the user.',
    parameters: {
      type: 'object',
      properties: { page: { type: 'string', enum: ['dashboard', 'apis', 'invoices', 'social', 'leads', 'outreach'] } },
      required: ['page'],
    },
  },
]

/** Tools that change data or spend quota — these wait for the user's confirmation. */
export const CONFIRM_TOOLS = new Set(['create_invoice', 'update_invoice', 'delete_invoice', 'find_leads'])
export const DANGER_TOOLS = new Set(['delete_invoice'])

export interface PreparedTool {
  /** Shown on the confirm card */
  title: string
  lines: string[]
  danger: boolean
  run: () => Promise<Record<string, unknown>>
}

/** Accepts 'yes' / 'no' / 'any', and the older true/false form */
const presence = (value: unknown): Presence => (value === true || value === 'yes' ? 'yes' : value === 'no' ? 'no' : 'any')

const arg = <T>(args: Record<string, unknown> | undefined, key: string, fallback: T): T =>
  args && args[key] !== undefined && args[key] !== null ? (args[key] as T) : fallback

const short = (invoice: Invoice) => ({
  number: invoice.number,
  client: invoice.client.name,
  status: invoice.status,
  issued: invoice.issueDate,
  due: invoice.dueDate,
  total: formatMoney(calcTotals(invoice).total, invoice.currency),
  template: invoice.template,
})

async function findInvoice(number: string) {
  const list = await fetchInvoices()
  const wanted = String(number).trim().toLowerCase()
  const found = list.find((i) => i.number.toLowerCase() === wanted) ?? list.find((i) => i.number.toLowerCase().includes(wanted))
  return { list, found }
}

function itemsFrom(raw: unknown): Invoice['items'] {
  const rows = Array.isArray(raw) ? raw : []
  return rows.map((r) => {
    const row = (r ?? {}) as Record<string, unknown>
    return { ...newItem(), description: String(row.description ?? ''), qty: Number(row.qty ?? 1) || 1, rate: Number(row.rate ?? 0) || 0 }
  })
}

/** Builds what a tool will do. Tools needing confirmation show `title`/`lines` first. */
export async function prepareTool(name: string, args: Record<string, unknown> | undefined, ctx: AgentContext): Promise<PreparedTool> {
  switch (name) {
    case 'portal_overview':
      return simple(async () => {
        const [invoices, services, leads, campaigns] = await Promise.all([
          fetchInvoices().catch(() => [] as Invoice[]),
          fetchServices().catch(() => []),
          fetchLeads().catch(() => []),
          fetchCampaigns().catch(() => []),
        ])
        const due = await fetchDue(campaigns).catch(() => [])
        let paid = 0
        let outstanding = 0
        for (const inv of invoices) {
          const total = calcTotals(inv).total
          if (inv.status === 'paid') paid += total
          else if (inv.status === 'sent') outstanding += total
        }
        const currency = invoices[0]?.currency ?? 'USD'
        return {
          today: new Date().toISOString().slice(0, 10),
          user: ctx.userName,
          invoices: invoices.length,
          drafts: invoices.filter((i) => i.status === 'draft').length,
          paid_total: formatMoney(paid, currency),
          awaiting_payment: formatMoney(outstanding, currency),
          saved_apis: services.map((s) => s.name),
          recent_invoices: invoices.slice(0, 5).map(short),
          leads: leads.length,
          leads_not_enriched: leads.filter((l) => !l.enrichedAt).length,
          leads_replied: leads.filter((l) => l.status === 'replied').length,
          campaigns_running: campaigns.filter((c) => c.status === 'running').length,
          whatsapp_ready_to_send: due.length,
        }
      })

    case 'list_invoices':
      return simple(async () => {
        const list = await fetchInvoices()
        const status = args?.status as InvoiceStatus | undefined
        const search = String(arg(args, 'search', '')).toLowerCase()
        const filtered = list.filter((i) => {
          if (status && i.status !== status) return false
          if (!search) return true
          return `${i.number} ${i.client.name} ${i.client.email}`.toLowerCase().includes(search)
        })
        return { count: filtered.length, invoices: filtered.slice(0, Number(arg(args, 'limit', 10))).map(short) }
      })

    case 'create_invoice': {
      const settings = await fetchSettings()
      const existing = await fetchInvoices()
      const template = arg(args, 'template', settings.template) as TemplateId
      const invoice: Invoice = {
        ...blankInvoice(settings, nextNumber(existing, settings.prefix)),
        template,
        accent: accentForTemplate(template, arg(args, 'accent', settings.accent) as AccentId),
        currency: String(arg(args, 'currency', settings.currency)).toUpperCase(),
        status: arg(args, 'status', 'draft') as InvoiceStatus,
        client: {
          name: String(arg(args, 'client_name', '')),
          email: String(arg(args, 'client_email', '')),
          phone: String(arg(args, 'client_phone', '')),
          address: String(arg(args, 'client_address', '')),
        },
        items: itemsFrom(args?.items),
        taxRate: Number(arg(args, 'tax_rate', settings.taxRate)) || 0,
        discount: Number(arg(args, 'discount', 0)) || 0,
        discountType: arg(args, 'discount_type', 'amount') as 'amount' | 'percent',
        shipping: Number(arg(args, 'shipping', 0)) || 0,
        notes: String(arg(args, 'notes', '')),
      }
      const days = args?.due_in_days === undefined ? settings.dueDays : Number(args.due_in_days)
      invoice.dueDate = addDays(invoice.issueDate, Number.isFinite(days) ? days : 14)
      const totals = calcTotals(invoice)
      return {
        title: `Create invoice ${invoice.number}`,
        danger: false,
        lines: [
          `Client: ${invoice.client.name || '—'}`,
          ...invoice.items.map((i) => `${i.qty} × ${i.description || 'Item'} — ${formatMoney(i.qty * i.rate, invoice.currency)}`),
          invoice.taxRate ? `Tax: ${invoice.taxRate}%` : '',
          `Total: ${formatMoney(totals.total, invoice.currency)}`,
          `Template: ${invoice.template}${invoice.status !== 'draft' ? ` · ${invoice.status}` : ''}`,
        ].filter(Boolean),
        run: async () => {
          await upsertInvoice(invoice)
          ctx.navigate('invoices')
          return { saved: true, ...short(invoice) }
        },
      }
    }

    case 'update_invoice': {
      const { found } = await findInvoice(String(arg(args, 'number', '')))
      if (!found) return missing(`No invoice found with number ${arg(args, 'number', '')}.`)
      const updated: Invoice = { ...found, client: { ...found.client }, business: { ...found.business }, items: [...found.items] }
      const changes: string[] = []
      if (args?.status) {
        updated.status = args.status as InvoiceStatus
        changes.push(`Status → ${updated.status}`)
      }
      if (args?.template) {
        updated.template = args.template as TemplateId
        updated.accent = accentForTemplate(updated.template, updated.accent)
        changes.push(`Template → ${updated.template}`)
      }
      if (args?.accent) {
        updated.accent = accentForTemplate(updated.template, args.accent as AccentId)
        changes.push(`Colour → ${updated.accent}`)
      }
      if (args?.tax_rate !== undefined) {
        updated.taxRate = Number(args.tax_rate) || 0
        changes.push(`Tax → ${updated.taxRate}%`)
      }
      if (args?.due_in_days !== undefined) {
        updated.dueDate = addDays(updated.issueDate, Number(args.due_in_days) || 0)
        changes.push(`Due → ${updated.dueDate}`)
      }
      if (args?.notes !== undefined) {
        updated.notes = String(args.notes)
        changes.push('Notes updated')
      }
      const added = itemsFrom(args?.add_items)
      if (added.length) {
        updated.items = [...updated.items, ...added]
        changes.push(...added.map((i) => `Added: ${i.qty} × ${i.description} — ${formatMoney(i.qty * i.rate, updated.currency)}`))
      }
      if (changes.length === 0) return missing('Nothing to change was given.')
      return {
        title: `Update ${updated.number}`,
        danger: false,
        lines: [...changes, `New total: ${formatMoney(calcTotals(updated).total, updated.currency)}`],
        run: async () => {
          await upsertInvoice(updated)
          ctx.navigate('invoices')
          return { updated: true, ...short(updated) }
        },
      }
    }

    case 'delete_invoice': {
      const { found } = await findInvoice(String(arg(args, 'number', '')))
      if (!found) return missing(`No invoice found with number ${arg(args, 'number', '')}.`)
      return {
        title: `Delete ${found.number}`,
        danger: true,
        lines: [`Client: ${found.client.name || '—'}`, `Total: ${formatMoney(calcTotals(found).total, found.currency)}`, 'This cannot be undone.'],
        run: async () => {
          await deleteInvoice(found.id)
          return { deleted: true, number: found.number }
        },
      }
    }

    case 'download_invoice':
      return simple(async () => {
        const { found } = await findInvoice(String(arg(args, 'number', '')))
        if (!found) return { error: `No invoice found with number ${arg(args, 'number', '')}.` }
        const format = arg(args, 'format', 'pdf') as 'pdf' | 'png' | 'html'
        await ctx.download(found, format)
        return { downloaded: true, number: found.number, format }
      })

    case 'find_leads': {
      const services = await fetchServices().catch(() => [])
      const match = services
        .flatMap((s) => s.endpoints.map((e) => ({ service: s, endpoint: e })))
        .find((pair) => isLeadFinderEndpoint(pair.service, pair.endpoint))
      if (!match) return missing('The Google Map Scraper API is not saved in the APIs page yet, so leads cannot be searched.')

      const countryInput = String(arg(args, 'country', '')).trim().toLowerCase()
      const country =
        COUNTRIES.find((c) => c.name.toLowerCase() === countryInput) ??
        COUNTRIES.find((c) => c.code.toLowerCase() === countryInput) ??
        COUNTRIES.find((c) => c.name.toLowerCase().includes(countryInput))
      if (!country) return missing(`"${arg(args, 'country', '')}" is not a country I recognise.`)

      const cityName = String(arg(args, 'city', '')).trim()
      let city: LeadSettings['city'] = null
      if (cityName) {
        const cities = await loadCities(country.code)
        city = cities.find((c) => c.name.toLowerCase() === cityName.toLowerCase()) ?? { name: cityName, region: '' }
      }
      const settings: LeadSettings = {
        country: country.code,
        city,
        niche: String(arg(args, 'niche', '')),
        count: Math.max(1, Math.min(500, Number(arg(args, 'count', 20)) || 20)),
        minRating: Number(arg(args, 'min_rating', 0)) || 0,
        minReviews: Number(arg(args, 'min_reviews', 0)) || 0,
        phone: presence(args?.phone ?? args?.needs_phone),
        website: presence(args?.website ?? args?.needs_website),
      }
      return {
        title: `Find ${settings.count} leads`,
        danger: false,
        lines: [
          `${settings.niche} in ${city ? `${city.name}, ` : ''}${countryName(country.code)}`,
          settings.minRating ? `Rating ${settings.minRating}+` : '',
          settings.minReviews ? `${settings.minReviews}+ reviews` : '',
          settings.phone === 'any' ? '' : settings.phone === 'yes' ? 'Must have a phone' : 'Must have no phone',
          settings.website === 'any' ? '' : settings.website === 'yes' ? 'Must have a website' : 'Must have no website',
          'This uses your RapidAPI quota.',
        ].filter(Boolean),
        run: async () => {
          const run = await runLeadSearch(match.service, match.endpoint, settings, () => undefined, { cancelled: false })
          ctx.navigate('apis')
          return {
            found: run.leads.length,
            requested: run.requested,
            searches_used: run.requestsUsed,
            sample: run.leads.slice(0, 5),
            note: run.partialError ?? (run.stop === 'exhausted' ? 'No more matching places were found.' : undefined),
          }
        },
      }
    }

    case 'list_leads':
      return simple(async () => {
        const all = await fetchLeads()
        const search = String(arg(args, 'search', '')).toLowerCase()
        const status = args?.status as string | undefined
        const source = args?.source ? String(args.source).toLowerCase() : ''
        const matching = all.filter((lead) => {
          if (status && lead.status !== status) return false
          if (source && !lead.source.toLowerCase().includes(source)) return false
          if (!search) return true
          return `${lead.name} ${lead.category} ${lead.city} ${lead.emails.join(' ')} ${lead.phone}`.toLowerCase().includes(search)
        })
        const tally = (pick: (l: (typeof all)[number]) => string) => {
          const counts: Record<string, number> = {}
          for (const lead of matching) {
            const key = pick(lead) || '—'
            counts[key] = (counts[key] ?? 0) + 1
          }
          return counts
        }
        return {
          total_saved: all.length,
          matching: matching.length,
          by_status: tally((l) => l.status),
          by_source: tally((l) => l.source),
          with_phone: matching.filter((l) => l.phones.length > 0 || l.phone).length,
          with_email: matching.filter((l) => l.emails.length > 0).length,
          not_enriched_yet: matching.filter((l) => !l.enrichedAt).length,
          examples: matching.slice(0, Number(arg(args, 'limit', 10))).map((l) => ({
            name: l.name,
            category: l.category,
            city: l.city,
            phone: l.phones[0] ?? l.phone,
            website: l.website,
            status: l.status,
            source: l.source,
          })),
        }
      })

    case 'list_campaigns':
      return simple(async () => {
        const campaigns = await fetchCampaigns()
        const [counts, due] = await Promise.all([countsFor(campaigns.map((c) => c.id)), fetchDue(campaigns)])
        return {
          ready_to_send_now: due.length,
          campaigns: campaigns.map((c) => ({
            name: c.name,
            status: c.status,
            sends: c.autoSend ? 'automatically through the WhatsApp Cloud API' : 'by hand, one click each',
            leads: c.source || 'every lead',
            per_day: c.dailyCap,
            hours: `${c.sendFrom}:00-${c.sendTo}:00 ${c.timezone}`,
            sent: counts[c.id]?.sent ?? 0,
            waiting: counts[c.id]?.pending ?? 0,
            skipped: counts[c.id]?.skipped ?? 0,
          })),
        }
      })

    case 'list_apis':
      return simple(async () => {
        const services = await fetchServices()
        return {
          apis: services.map((s) => ({ name: s.name, host: s.host, endpoints: s.endpoints.map((e) => ({ name: e.name, method: e.method, path: e.path })) })),
        }
      })

    case 'call_api_endpoint':
      return simple(async () => {
        const services = await fetchServices()
        const apiText = String(arg(args, 'api', '')).toLowerCase()
        const service = services.find((s) => s.name.toLowerCase().includes(apiText) || s.host.toLowerCase().includes(apiText))
        if (!service) return { error: `No saved API matches "${arg(args, 'api', '')}".` }
        const endpointText = String(arg(args, 'endpoint', '')).toLowerCase()
        const endpoint =
          service.endpoints.find((e) => e.name.toLowerCase().includes(endpointText) || e.path.toLowerCase().includes(endpointText)) ?? service.endpoints[0]
        if (!endpoint) return { error: `"${service.name}" has no saved endpoints.` }

        const extra = (args?.params ?? {}) as Record<string, unknown>
        const query = [...endpoint.query]
        for (const [key, value] of Object.entries(extra)) {
          const existing = query.find((q) => q.key === key)
          if (existing) existing.value = String(value)
          else query.push({ id: `${key}`, key, value: String(value) })
        }
        const result = await sendRequest({ host: service.host, method: endpoint.method, path: endpoint.path, query, body: endpoint.body })
        const records = findRecords(result.body).slice(0, 3).map((r) => flatten(r))
        return {
          status: result.status,
          api: service.name,
          endpoint: endpoint.name,
          records_found: findRecords(result.body).length,
          sample: records,
          body: records.length ? undefined : result.body.slice(0, 600),
        }
      })

    case 'open_page':
      return simple(async () => {
        const page = arg(args, 'page', 'dashboard') as PageId
        ctx.navigate(page)
        return { opened: page }
      })

    default:
      return missing(`Unknown tool: ${name}`)
  }
}

const simple = (run: () => Promise<Record<string, unknown>>): PreparedTool => ({ title: '', lines: [], danger: false, run })
const missing = (message: string): PreparedTool => ({ title: '', lines: [], danger: false, run: async () => ({ error: message }) })

/* ---------- Talking to the model ---------- */

export async function askModel(contents: GeminiContent[]): Promise<GeminiContent> {
  const { data, error } = await supabase.functions.invoke('ai-agent', {
    body: { contents, tools: [{ functionDeclarations: TOOL_DECLARATIONS }], systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } },
  })
  if (error) {
    let message = 'Could not reach the assistant. Is the "ai-agent" function deployed in Supabase?'
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json()
        if (body?.error) message = String(body.error)
      } catch {
        // keep the generic message
      }
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(String(data.error))
  return (data?.content ?? { role: 'model', parts: [] }) as GeminiContent
}
