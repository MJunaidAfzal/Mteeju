// Invoices stored in Supabase (tables: invoices, invoice_settings).
import { supabase } from './supabase'
import { SetupRequiredError } from './apiStore'

export type InvoiceStatus = 'draft' | 'sent' | 'paid'
export type TemplateId = 'classic' | 'modern' | 'minimal' | 'luxe' | 'bold' | 'compact'
export type AccentId = 'forest' | 'gold' | 'maroon' | 'navy' | 'charcoal' | 'plum'
export type DiscountType = 'amount' | 'percent'

export interface Business {
  name: string
  email: string
  phone: string
  address: string
  website: string
  taxId: string
  /** Data URL of the uploaded logo */
  logo: string
}

export interface Client {
  name: string
  email: string
  phone: string
  address: string
}

export interface InvoiceItem {
  id: string
  description: string
  qty: number
  rate: number
}

export interface Invoice {
  id: string
  number: string
  status: InvoiceStatus
  template: TemplateId
  accent: AccentId
  issueDate: string
  dueDate: string
  currency: string
  business: Business
  client: Client
  items: InvoiceItem[]
  taxRate: number
  discount: number
  discountType: DiscountType
  shipping: number
  notes: string
  terms: string
  paymentDetails: string
  /** Data URL of the signature image */
  signature: string
  signatureName: string
  createdAt?: string
}

export interface InvoiceSettings {
  business: Business
  currency: string
  template: TemplateId
  accent: AccentId
  taxRate: number
  terms: string
  paymentDetails: string
  signature: string
  signatureName: string
  prefix: string
  dueDays: number
}

export const TEMPLATES: { id: TemplateId; name: string; description: string; legacy?: boolean }[] = [
  { id: 'classic', name: 'Classic', description: 'Full-width colour band across the header', legacy: true },
  { id: 'modern', name: 'Modern', description: 'Gradient side bar with a large total', legacy: true },
  { id: 'minimal', name: 'Minimal', description: 'Plenty of white space, fine rules', legacy: true },
  { id: 'luxe', name: 'Luxe', description: 'Black paper with gold lettering — premium look' },
  { id: 'bold', name: 'Bold', description: 'Oversized header block and striped rows' },
  { id: 'compact', name: 'Compact', description: 'Tighter layout, fits long item lists' },
]

export const ACCENTS: { id: AccentId; name: string; color: string }[] = [
  { id: 'forest', name: 'Forest', color: '#173b2f' },
  { id: 'gold', name: 'Gold', color: '#a8801f' },
  { id: 'maroon', name: 'Maroon', color: '#6b1e2d' },
  { id: 'navy', name: 'Navy', color: '#1f3352' },
  { id: 'charcoal', name: 'Charcoal', color: '#232323' },
  { id: 'plum', name: 'Plum', color: '#4a2545' },
]

/** Luxe is always black & gold, so the colour picker does not apply to it. */
export const usesAccent = (template: TemplateId) => template !== 'luxe'

// Whether the invoices table has the newer template/accent options
let templatesUpgraded = true
export const hasTemplateUpgrade = () => templatesUpgraded
const LEGACY_TEMPLATES = new Set<TemplateId>(['classic', 'modern', 'minimal'])

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'AED', 'SAR', 'INR', 'CAD', 'AUD', 'TRY', 'MYR', 'SGD', 'BDT', 'ZAR']

export const emptyBusiness = (): Business => ({ name: '', email: '', phone: '', address: '', website: '', taxId: '', logo: '' })
export const emptyClient = (): Client => ({ name: '', email: '', phone: '', address: '' })

export const newItem = (): InvoiceItem => ({ id: crypto.randomUUID(), description: '', qty: 1, rate: 0 })

export const DEFAULT_SETTINGS: InvoiceSettings = {
  business: emptyBusiness(),
  currency: 'USD',
  template: 'classic',
  accent: 'forest',
  taxRate: 0,
  terms: 'Payment is due within 14 days of the invoice date.',
  paymentDetails: '',
  signature: '',
  signatureName: '',
  prefix: 'INV-',
  dueDays: 14,
}

const today = () => new Date().toISOString().slice(0, 10)

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function blankInvoice(settings: InvoiceSettings, number: string): Invoice {
  const issueDate = today()
  return {
    id: crypto.randomUUID(),
    number,
    status: 'draft',
    template: settings.template,
    accent: settings.accent,
    issueDate,
    dueDate: addDays(issueDate, settings.dueDays || 0),
    currency: settings.currency,
    business: { ...settings.business },
    client: emptyClient(),
    items: [newItem()],
    taxRate: settings.taxRate,
    discount: 0,
    discountType: 'amount',
    shipping: 0,
    notes: '',
    terms: settings.terms,
    paymentDetails: settings.paymentDetails,
    signature: settings.signature,
    signatureName: settings.signatureName,
  }
}

/* ---------- Money ---------- */

export interface Totals {
  subtotal: number
  discountValue: number
  taxValue: number
  total: number
}

export function calcTotals(invoice: Invoice): Totals {
  const subtotal = invoice.items.reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0)
  const discountValue = invoice.discountType === 'percent' ? (subtotal * (Number(invoice.discount) || 0)) / 100 : Number(invoice.discount) || 0
  const taxable = Math.max(0, subtotal - discountValue)
  const taxValue = (taxable * (Number(invoice.taxRate) || 0)) / 100
  return { subtotal, discountValue, taxValue, total: taxable + taxValue + (Number(invoice.shipping) || 0) }
}

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount || 0)
  } catch {
    return `${currency} ${(amount || 0).toFixed(2)}`
  }
}

export function formatDate(date: string) {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00`)
  return Number.isNaN(d.getTime()) ? date : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
}

/** "INV-0007" → "INV-0008", based on the highest number already used. */
export function nextNumber(invoices: Invoice[], prefix: string) {
  const clean = prefix || 'INV-'
  let highest = 0
  for (const invoice of invoices) {
    const match = invoice.number.match(/(\d+)\s*$/)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `${clean}${String(highest + 1).padStart(4, '0')}`
}

/* ---------- Images (logo & signature) ---------- */

/** Reads an image file and shrinks it so invoices stay small enough to store. */
export function readImage(file: File, maxSize = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file (PNG or JPG).'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That image could not be read.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That image could not be read.'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(String(reader.result))
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/* ---------- Supabase ---------- */

function fail(error: { code?: string; message: string }): never {
  if (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message)) {
    throw new SetupRequiredError('The invoice tables do not exist in Supabase yet.')
  }
  throw new Error(error.message)
}

interface InvoiceRow {
  id: string
  number: string
  status: InvoiceStatus
  template: TemplateId
  accent: AccentId | null
  issue_date: string
  due_date: string | null
  currency: string
  business: Partial<Business> | null
  client: Partial<Client> | null
  items: InvoiceItem[] | null
  tax_rate: string | number
  discount: string | number
  discount_type: DiscountType
  shipping: string | number
  notes: string | null
  terms: string | null
  payment_details: string | null
  signature: string | null
  signature_name: string | null
  created_at: string
}

const fromRow = (row: InvoiceRow): Invoice => ({
  id: row.id,
  number: row.number,
  status: row.status,
  template: row.template,
  accent: row.accent ?? 'forest',
  issueDate: row.issue_date,
  dueDate: row.due_date ?? '',
  currency: row.currency,
  business: { ...emptyBusiness(), ...(row.business ?? {}) },
  client: { ...emptyClient(), ...(row.client ?? {}) },
  items: (row.items ?? []).map((i) => ({ ...newItem(), ...i })),
  taxRate: Number(row.tax_rate) || 0,
  discount: Number(row.discount) || 0,
  discountType: row.discount_type,
  shipping: Number(row.shipping) || 0,
  notes: row.notes ?? '',
  terms: row.terms ?? '',
  paymentDetails: row.payment_details ?? '',
  signature: row.signature ?? '',
  signatureName: row.signature_name ?? '',
  createdAt: row.created_at,
})

const toRow = (invoice: Invoice) => {
  const totals = calcTotals(invoice)
  return {
    id: invoice.id,
    number: invoice.number.trim(),
    status: invoice.status,
    // Older databases only know the first three templates
    template: templatesUpgraded || LEGACY_TEMPLATES.has(invoice.template) ? invoice.template : 'classic',
    ...(templatesUpgraded ? { accent: invoice.accent } : {}),
    issue_date: invoice.issueDate,
    due_date: invoice.dueDate || null,
    currency: invoice.currency,
    business: invoice.business,
    client: invoice.client,
    items: invoice.items,
    tax_rate: invoice.taxRate,
    discount: invoice.discount,
    discount_type: invoice.discountType,
    shipping: invoice.shipping,
    notes: invoice.notes,
    terms: invoice.terms,
    payment_details: invoice.paymentDetails,
    signature: invoice.signature,
    signature_name: invoice.signatureName,
    subtotal: Number(totals.subtotal.toFixed(2)),
    total: Number(totals.total.toFixed(2)),
  }
}

export async function fetchInvoices(): Promise<Invoice[]> {
  const [{ data, error }, probe] = await Promise.all([
    supabase.from('invoices').select('*').order('issue_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('invoices').select('accent').limit(1),
  ])
  // A missing "accent" column means the template upgrade script has not been run yet
  if (probe.error && (probe.error.code === '42703' || /accent/i.test(probe.error.message))) templatesUpgraded = false
  else if (!probe.error) templatesUpgraded = true
  if (error) fail(error)
  return (data as InvoiceRow[]).map(fromRow)
}

export async function upsertInvoice(invoice: Invoice) {
  const { error } = await supabase.from('invoices').upsert(toRow(invoice))
  if (error) {
    if (error.code === '23505') throw new Error(`Invoice number ${invoice.number} is already used. Choose another number.`)
    fail(error)
  }
}

export async function deleteInvoice(id: string) {
  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) fail(error)
}

export async function fetchSettings(): Promise<InvoiceSettings> {
  const { data, error } = await supabase.from('invoice_settings').select('data').maybeSingle()
  if (error) fail(error)
  const saved = (data?.data ?? {}) as Partial<InvoiceSettings>
  return { ...DEFAULT_SETTINGS, ...saved, business: { ...emptyBusiness(), ...(saved.business ?? {}) } }
}

export async function saveSettings(settings: InvoiceSettings) {
  const { error } = await supabase.from('invoice_settings').upsert({ user_id: (await supabase.auth.getUser()).data.user?.id, data: settings })
  if (error) fail(error)
}
