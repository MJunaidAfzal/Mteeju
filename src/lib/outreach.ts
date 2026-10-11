// Outreach campaigns: the sequence a lead walks through, and the queue of WhatsApp
// messages it owes. Nothing is sent on its own — every message waits for one click.
import { supabase } from './supabase'
import { SetupRequiredError } from './apiStore'
import type { Lead } from './leadStore'

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done'
export type QueueStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'cancelled'

/** Leads that answered or opted out are left alone. */
export const STOPPED_STATUSES = ['replied', 'won', 'lost', 'unsubscribed']

export interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  source: string
  signature: string
  autoSend: boolean
  templateName: string
  templateLang: string
  templateParams: string
  dailyCap: number
  sendFrom: number
  sendTo: number
  timezone: string
  startedAt: string | null
  stoppedAt: string | null
  createdAt: string
}

export interface Step {
  id: string
  campaignId: string
  day: number
  body: string
}

export interface QueueItem {
  id: string
  campaignId: string
  stepId: string
  leadId: string
  recipient: string
  body: string
  scheduledFor: string
  status: QueueStatus
  sentAt: string | null
  error: string
}

export interface CampaignCounts {
  pending: number
  sent: number
  skipped: number
}

export const newCampaign = (): Campaign => ({
  id: crypto.randomUUID(),
  name: '',
  status: 'draft',
  source: '',
  signature: '',
  autoSend: false,
  templateName: '',
  templateLang: 'en_US',
  templateParams: '{{name}}',
  dailyCap: 25,
  sendFrom: 10,
  sendTo: 18,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai',
  startedAt: null,
  stoppedAt: null,
  createdAt: new Date().toISOString(),
})

/** A sensible first sequence: an opener, then one follow-up a couple of days later. */
export function defaultSteps(campaignId: string): Step[] {
  const make = (day: number, body: string): Step => ({ id: crypto.randomUUID(), campaignId, day, body })
  return [
    make(
      1,
      'Hi {{name}} team — I work with {{category}} businesses in {{city}} and had a couple of quick ideas to bring you more customers. Would you like me to send them over?',
    ),
    make(3, 'Hi again — just checking you saw my last message. Happy to send the ideas across, no strings attached.'),
  ]
}

/* ---------- Supabase ---------- */

function fail(error: { code?: string; message: string }): never {
  if (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message)) {
    throw new SetupRequiredError('The campaign tables do not exist in Supabase yet.')
  }
  throw new Error(error.message)
}

interface CampaignRow {
  id: string
  name: string
  status: CampaignStatus
  source: string
  signature: string
  auto_send: boolean
  template_name: string
  template_lang: string
  template_params: string
  daily_cap: number
  send_from: number
  send_to: number
  timezone: string
  started_at: string | null
  stopped_at: string | null
  created_at: string
}

const fromCampaign = (row: CampaignRow): Campaign => ({
  id: row.id,
  name: row.name,
  status: row.status,
  source: row.source,
  signature: row.signature,
  autoSend: row.auto_send ?? false,
  templateName: row.template_name ?? '',
  templateLang: row.template_lang ?? 'en_US',
  templateParams: row.template_params ?? '{{name}}',
  dailyCap: row.daily_cap,
  sendFrom: row.send_from,
  sendTo: row.send_to,
  timezone: row.timezone,
  startedAt: row.started_at,
  stoppedAt: row.stopped_at,
  createdAt: row.created_at,
})

const toCampaign = (campaign: Campaign) => ({
  id: campaign.id,
  name: campaign.name,
  status: campaign.status,
  source: campaign.source,
  signature: campaign.signature,
  auto_send: campaign.autoSend,
  template_name: campaign.templateName,
  template_lang: campaign.templateLang,
  template_params: campaign.templateParams,
  daily_cap: campaign.dailyCap,
  send_from: campaign.sendFrom,
  send_to: campaign.sendTo,
  timezone: campaign.timezone,
})

interface StepRow {
  id: string
  campaign_id: string
  day: number
  body: string
}

const fromStep = (row: StepRow): Step => ({
  id: row.id,
  campaignId: row.campaign_id,
  day: row.day,
  body: row.body,
})

interface QueueRow {
  id: string
  campaign_id: string
  step_id: string
  lead_id: string
  recipient: string
  body: string
  scheduled_for: string
  status: QueueStatus
  sent_at: string | null
  error: string
}

const fromQueue = (row: QueueRow): QueueItem => ({
  id: row.id,
  campaignId: row.campaign_id,
  stepId: row.step_id,
  leadId: row.lead_id,
  recipient: row.recipient,
  body: row.body,
  scheduledFor: row.scheduled_for,
  status: row.status,
  sentAt: row.sent_at,
  error: row.error,
})

const QUEUE_COLUMNS = 'id, campaign_id, step_id, lead_id, recipient, body, scheduled_for, status, sent_at, error'

export async function fetchCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false })
  if (error) fail(error)
  return (data as CampaignRow[]).map(fromCampaign)
}

export async function fetchSteps(campaignId: string): Promise<Step[]> {
  const { data, error } = await supabase
    .from('campaign_steps')
    .select('id, campaign_id, day, body')
    .eq('campaign_id', campaignId)
    .order('day', { ascending: true })
  if (error) fail(error)
  return (data as StepRow[]).map(fromStep)
}

/** True when the Cloud API columns have not been added to the database yet. */
const missingApiColumns = (error: { code?: string; message: string }) =>
  error.code === 'PGRST204' || error.code === '42703' || /auto_send|template_name|template_lang|template_params/.test(error.message)

/** Saves the campaign and replaces its steps with the ones given. */
export async function saveCampaign(campaign: Campaign, steps: Step[]) {
  const { error } = await supabase.from('campaigns').upsert(toCampaign(campaign))
  if (error) {
    // The automatic-sending migration is optional: save the rest rather than refuse.
    if (!missingApiColumns(error)) fail(error)
    const row: Record<string, unknown> = { ...toCampaign(campaign) }
    for (const column of ['auto_send', 'template_name', 'template_lang', 'template_params']) delete row[column]
    const { error: retry } = await supabase.from('campaigns').upsert(row)
    if (retry) fail(retry)
  }

  const keep = steps.map((s) => s.id)
  const remove = supabase.from('campaign_steps').delete().eq('campaign_id', campaign.id)
  const { error: cleanError } = keep.length ? await remove.not('id', 'in', `(${keep.join(',')})`) : await remove
  if (cleanError) fail(cleanError)

  const { error: stepError } = await supabase.from('campaign_steps').upsert(
    steps.map((step) => ({
      id: step.id,
      campaign_id: campaign.id,
      day: step.day,
      channel: 'whatsapp',
      body: step.body,
    })),
  )
  if (stepError) fail(stepError)
}

export async function deleteCampaign(id: string) {
  const { error } = await supabase.from('campaigns').delete().eq('id', id)
  if (error) fail(error)
}

export async function setCampaignStatus(id: string, status: CampaignStatus) {
  const patch: Record<string, unknown> = { status }
  if (status === 'running') patch.started_at = new Date().toISOString()
  if (status === 'done') patch.stopped_at = new Date().toISOString()
  const { error } = await supabase.from('campaigns').update(patch).eq('id', id)
  if (error) fail(error)
}

/** Digits only, the way wa.me wants a number. */
export const waNumber = (phone: string) => phone.replace(/\D/g, '')

/** The WhatsApp number this lead can be reached on, if it has one. */
export const contactFor = (lead: Lead) => waNumber(lead.phones[0] ?? lead.phone ?? '')

/** Which of these leads a campaign can actually reach. */
export function reachable(leads: Lead[]) {
  return leads.filter((lead) => !STOPPED_STATUSES.includes(lead.status) && contactFor(lead))
}

/** The hour of the day where the campaign owner lives, so messages do not go out at 3am. */
export function localHour(timezone: string) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(new Date()))
  } catch {
    return new Date().getHours()
  }
}

/** True while the campaign is inside the hours its owner chose. */
export const inSendingWindow = (campaign: Campaign) => {
  const hour = localHour(campaign.timezone)
  return hour >= campaign.sendFrom && hour < campaign.sendTo
}

/**
 * Turns leads + steps into dated messages. Day 1 is due straight away; later days
 * land at the campaign's start hour. The daily cap and the sending window are
 * applied later, when the due list is read.
 */
export function buildQueue(campaign: Campaign, steps: Step[], leads: Lead[]) {
  const now = new Date()
  const rows: Record<string, unknown>[] = []
  for (const lead of leads) {
    if (STOPPED_STATUSES.includes(lead.status)) continue
    const recipient = contactFor(lead)
    if (!recipient) continue
    for (const step of steps) {
      const when = new Date(now)
      if (step.day > 1) {
        when.setDate(when.getDate() + (step.day - 1))
        when.setHours(campaign.sendFrom, 0, 0, 0)
      }
      rows.push({
        id: crypto.randomUUID(),
        campaign_id: campaign.id,
        step_id: step.id,
        lead_id: lead.id,
        channel: 'whatsapp',
        recipient,
        body: step.body,
        scheduled_for: when.toISOString(),
        status: 'pending',
      })
    }
  }
  return rows
}

/** Adds any missing messages for this campaign; leads already queued are skipped. */
export async function queueLeads(campaign: Campaign, steps: Step[], leads: Lead[]): Promise<number> {
  const rows = buildQueue(campaign, steps, leads)
  let added = 0
  for (let i = 0; i < rows.length; i += 400) {
    const { data, error } = await supabase
      .from('outreach_queue')
      .upsert(rows.slice(i, i + 400), { onConflict: 'step_id,lead_id', ignoreDuplicates: true })
      .select('id')
    if (error) fail(error)
    added += (data ?? []).length
  }
  return added
}

export async function fetchQueue(campaignId: string): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from('outreach_queue')
    .select(QUEUE_COLUMNS)
    .eq('campaign_id', campaignId)
    .order('scheduled_for', { ascending: true })
    .limit(2000)
  if (error) fail(error)
  return (data as QueueRow[]).map(fromQueue)
}

/** How many messages each campaign has already sent today, in its own time zone. */
async function sentToday(campaigns: Campaign[]): Promise<Record<string, number>> {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const tally: Record<string, number> = {}
  for (const campaign of campaigns) tally[campaign.id] = 0

  const { data, error } = await supabase
    .from('outreach_queue')
    .select('campaign_id')
    .in('campaign_id', Object.keys(tally))
    .eq('status', 'sent')
    .gte('sent_at', since.toISOString())
    .limit(5000)
  if (error) fail(error)
  for (const row of (data ?? []) as { campaign_id: string }[]) {
    if (tally[row.campaign_id] !== undefined) tally[row.campaign_id] += 1
  }
  return tally
}

/**
 * Every message that should be sent right now: running campaigns only, inside their
 * sending hours, and never more than the daily cap each one allows.
 */
export async function fetchDue(campaigns: Campaign[]): Promise<QueueItem[]> {
  // Campaigns that send themselves through the Cloud API never queue up for a click.
  const open = campaigns.filter((c) => c.status === 'running' && !c.autoSend && inSendingWindow(c))
  if (open.length === 0) return []

  const { data, error } = await supabase
    .from('outreach_queue')
    .select(QUEUE_COLUMNS)
    .in(
      'campaign_id',
      open.map((c) => c.id),
    )
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(500)
  if (error) fail(error)

  const already = await sentToday(open)
  const room: Record<string, number> = {}
  for (const campaign of open) room[campaign.id] = Math.max(0, campaign.dailyCap - (already[campaign.id] ?? 0))

  const due: QueueItem[] = []
  for (const row of (data ?? []) as QueueRow[]) {
    if ((room[row.campaign_id] ?? 0) <= 0) continue
    room[row.campaign_id] -= 1
    due.push(fromQueue(row))
  }
  return due
}

export async function countsFor(campaignIds: string[]): Promise<Record<string, CampaignCounts>> {
  const counts: Record<string, CampaignCounts> = {}
  if (campaignIds.length === 0) return counts
  const { data, error } = await supabase.from('outreach_queue').select('campaign_id, status').in('campaign_id', campaignIds).limit(20000)
  if (error) fail(error)
  for (const id of campaignIds) counts[id] = { pending: 0, sent: 0, skipped: 0 }
  for (const row of (data ?? []) as { campaign_id: string; status: QueueStatus }[]) {
    const tally = counts[row.campaign_id]
    if (!tally) continue
    if (row.status === 'pending') tally.pending += 1
    if (row.status === 'sent') tally.sent += 1
    if (row.status === 'skipped') tally.skipped += 1
  }
  return counts
}

export async function markQueueItem(id: string, status: QueueStatus) {
  const patch: Record<string, unknown> = { status }
  if (status === 'sent') patch.sent_at = new Date().toISOString()
  const { error } = await supabase.from('outreach_queue').update(patch).eq('id', id)
  if (error) fail(error)
}

/** Cancels everything still waiting — used when a campaign is stopped for good. */
export async function cancelPending(campaignId: string) {
  const { error } = await supabase.from('outreach_queue').update({ status: 'cancelled' }).eq('campaign_id', campaignId).eq('status', 'pending')
  if (error) fail(error)
}

/** A campaign with nothing left to send has finished. */
export async function finishIfDone(campaignId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('outreach_queue')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
  if (error) fail(error)
  if ((count ?? 0) > 0) return false
  await setCampaignStatus(campaignId, 'done')
  return true
}

/* ---------- Automatic sending (Meta WhatsApp Cloud API) ---------- */

export interface RunResult {
  sent: number
  failed: number
  cancelled: number
  waiting: number
  notes: string[]
}

/** Calls the Edge Function and turns whatever went wrong into a sentence worth reading. */
async function callSender(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('whatsapp-send', { body })
  if (error) {
    let message = 'Could not reach the "whatsapp-send" function. Is it deployed in Supabase?'
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
  return data
}

/** Sends everything the automatic campaigns owe right now. */
export async function runAuto(campaignId?: string): Promise<RunResult> {
  return (await callSender({ campaignId, force: true })) as RunResult
}

/** One template message to a number of your own, to prove the setup works. */
export async function sendApiTest(to: string, templateName: string, templateLang: string) {
  await callSender({ testTo: to, templateName, templateLang })
}

/** Fills {{name}} and friends so the portal shows what will actually be sent. */
export function render(text: string, lead: Lead) {
  return text
    .replaceAll('{{name}}', lead.name)
    .replaceAll('{{category}}', lead.category || 'business')
    .replaceAll('{{city}}', lead.city || lead.country || 'your area')
    .replaceAll('{{rating}}', lead.rating === null ? '' : String(lead.rating))
    .replaceAll('{{reviews}}', lead.reviews === null ? '' : String(lead.reviews))
    .replaceAll('{{website}}', lead.website)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The exact text that goes into WhatsApp: the message, then the campaign's sign-off. */
export function compose(body: string, lead: Lead | undefined, signature: string) {
  const text = lead ? render(body, lead) : body.trim()
  return signature.trim() ? `${text}\n\n${signature.trim()}` : text
}
