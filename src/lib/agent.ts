// The Teeju assistant: what it knows, what it can do, and how a turn is run.
import { supabase } from './supabase'
import { fetchServices } from './apiStore'
import { sendRequest } from './rapidapi'
import { isLeadFinderEndpoint, loadCities, countryName, runLeadSearch, COUNTRIES, type LeadSettings } from './leads'
import { findRecords, flatten } from './tableize'
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

export type PageId = 'dashboard' | 'apis' | 'invoices'

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

The portal has three pages:
- Dashboard: a greeting and the Supabase connection status.
- APIs: saved RapidAPI services. Requests go through a secure Supabase proxy. The Google Map Scraper endpoint has a Lead Finder that searches a country/city for a niche and collects business leads (name, phone, website, rating...).
- Invoices: create, save, edit and download invoices. Nine templates (classic, modern, minimal, luxe, bold, compact, noir, royal, onyx — the last four are black & gold) and colour options. Invoices are saved in the user's own Supabase database and can be downloaded as PDF, PNG or HTML.

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
        needs_phone: { type: 'boolean' },
        needs_website: { type: 'boolean' },
      },
      required: ['niche', 'country'],
    },
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
      properties: { page: { type: 'string', enum: ['dashboard', 'apis', 'invoices'] } },
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
        const [invoices, services] = await Promise.all([fetchInvoices().catch(() => [] as Invoice[]), fetchServices().catch(() => [])])
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
        needPhone: Boolean(arg(args, 'needs_phone', false)),
        needWebsite: Boolean(arg(args, 'needs_website', false)),
      }
      return {
        title: `Find ${settings.count} leads`,
        danger: false,
        lines: [
          `${settings.niche} in ${city ? `${city.name}, ` : ''}${countryName(country.code)}`,
          settings.minRating ? `Rating ${settings.minRating}+` : '',
          settings.minReviews ? `${settings.minReviews}+ reviews` : '',
          settings.needPhone ? 'Must have a phone' : '',
          settings.needWebsite ? 'Must have a website' : '',
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
