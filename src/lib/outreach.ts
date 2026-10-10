// Outreach campaigns: the sequence a lead walks through, and the queue of messages it owes.
import { supabase } from './supabase'
import { SetupRequiredError } from './apiStore'
import type { Lead } from './leadStore'

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'done'
export type Channel = 'email' | 'whatsapp'
export type QueueStatus = 'pending' | 'sent' | 'failed' | 'skipped' | 'cancelled'

/** Leads that answered or opted out are left alone. */
export const STOPPED_STATUSES = ['replied', 'won', 'lost', 'unsubscribed']

export interface Campaign {
  id: string
  name: string
  status: CampaignStatus
  source: string
  fromName: string
  signature: string
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
  channel: Channel
  subject: string
  body: string
  personalise: boolean
}

export interface QueueItem {
  id: string
  campaignId: string
  stepId: string
  leadId: string
  channel: Channel
  recipient: string
  subject: string
  body: string
  scheduledFor: string
  status: QueueStatus
  sentAt: string | null
  error: string
}

export interface CampaignCounts {
  pending: number
  sent: number
  failed: number
  waitingWhatsapp: number
}

export const newCampaign = (): Campaign => ({
  id: crypto.randomUUID(),
  name: '',
  status: 'draft',
  source: '',
  fromName: '',
  signature: '',
  dailyCap: 25,
  sendFrom: 10,
  sendTo: 18,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai',
  startedAt: null,
  stoppedAt: null,
  createdAt: new Date().toISOString(),
})

/** A sensible first sequence: email, then WhatsApp, then one follow-up of each. */
export function defaultSteps(campaignId: string): Step[] {
  const make = (day: number, channel: Channel, subject: string, body: string): Step => ({
    id: crypto.randomUUID(),
    campaignId,
    day,
    channel,
    subject,
    body,
    personalise: true,
  })
  return [
    make(
      1,
      'email',
      'Quick idea for {{name}}',
      'Hi {{name}} team,\n\n{{opening}}\n\nI help {{category}} businesses in {{city}} get more customers online. I had a look at your listing and spotted two or three things that could bring in more bookings.\n\nWould it help if I sent them over?',
    ),
    make(
      2,
      'whatsapp',
      '',
      'Hi {{name}} team — I work with {{category}} businesses in {{city}} and had a couple of quick ideas to bring you more customers. Would you like me to send them over?',
    ),
    make(
      4,
      'email',
      'Following up — {{name}}',
      'Hi again,\n\nJust floating this back to the top of your inbox. Happy to send the ideas over with no strings attached — one reply is all it takes.\n\nIf now is not the right time, no problem at all.',
    ),
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
  from_name: string
  signature: string
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
  fromName: row.from_name,
  signature: row.signature,
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
  from_name: campaign.fromName,
  signature: campaign.signature,
  daily_cap: campaign.dailyCap,
  send_from: campaign.sendFrom,
  send_to: campaign.sendTo,
  timezone: campaign.timezone,
})

interface StepRow {
  id: string
  campaign_id: string
  day: number
  channel: Channel
  subject: string
  body: string
  personalise: boolean
}

const fromStep = (row: StepRow): Step => ({
  id: row.id,
  campaignId: row.campaign_id,
  day: row.day,
  channel: row.channel,
  subject: row.subject,
  body: row.body,
  personalise: row.personalise,
})

interface QueueRow {
  id: string
  campaign_id: string
  step_id: string
  lead_id: string
  channel: Channel
  recipient: string
  subject: string
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
  channel: row.channel,
  recipient: row.recipient,
  subject: row.subject,
  body: row.body,
  scheduledFor: row.scheduled_for,
  status: row.status,
  sentAt: row.sent_at,
  error: row.error,
})

export async function fetchCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false })
  if (error) fail(error)
  return (data as CampaignRow[]).map(fromCampaign)
}

export async function fetchSteps(campaignId: string): Promise<Step[]> {
  const { data, error } = await supabase.from('campaign_steps').select('*').eq('campaign_id', campaignId).order('day', { ascending: true })
  if (error) fail(error)
  return (data as StepRow[]).map(fromStep)
}

/** Saves the campaign and replaces its steps with the ones given. */
export async function saveCampaign(campaign: Campaign, steps: Step[]) {
  const { error } = await supabase.from('campaigns').upsert(toCampaign(campaign))
  if (error) fail(error)

  const keep = steps.map((s) => s.id)
  const remove = supabase.from('campaign_steps').delete().eq('campaign_id', campaign.id)
  const { error: cleanError } = keep.length ? await remove.not('id', 'in', `(${keep.join(',')})`) : await remove
  if (cleanError) fail(cleanError)

  const { error: stepError } = await supabase.from('campaign_steps').upsert(
    steps.map((step) => ({
      id: step.id,
      campaign_id: campaign.id,
      day: step.day,
      channel: step.channel,
      subject: step.subject,
      body: step.body,
      personalise: step.personalise,
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

export const contactFor = (lead: Lead, channel: Channel) =>
  channel === 'email' ? (lead.emails[0] ?? '') : waNumber(lead.phones[0] ?? lead.phone ?? '')

/** Which of these leads this campaign can actually reach. */
export function reachable(leads: Lead[], steps: Step[]) {
  const channels = new Set(steps.map((s) => s.channel))
  return leads.filter((lead) => !STOPPED_STATUSES.includes(lead.status) && [...channels].some((c) => contactFor(lead, c)))
}

/**
 * Turns leads + steps into dated messages. Day 1 is due straight away; later days
 * land at the campaign's start hour. The runner still holds everything to the
 * daily cap and the sending window.
 */
export function buildQueue(campaign: Campaign, steps: Step[], leads: Lead[]) {
  const now = new Date()
  const rows: Record<string, unknown>[] = []
  for (const lead of leads) {
    if (STOPPED_STATUSES.includes(lead.status)) continue
    for (const step of steps) {
      const recipient = contactFor(lead, step.channel)
      if (!recipient) continue
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
        channel: step.channel,
        recipient,
        subject: step.subject,
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
    .select('*')
    .eq('campaign_id', campaignId)
    .order('scheduled_for', { ascending: true })
    .limit(2000)
  if (error) fail(error)
  return (data as QueueRow[]).map(fromQueue)
}

/** Every WhatsApp message that is due now, across all running campaigns. */
export async function fetchWhatsappDue(): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from('outreach_queue')
    .select('*')
    .eq('channel', 'whatsapp')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(200)
  if (error) fail(error)
  return (data as QueueRow[]).map(fromQueue)
}

export async function countsFor(campaignIds: string[]): Promise<Record<string, CampaignCounts>> {
  const counts: Record<string, CampaignCounts> = {}
  if (campaignIds.length === 0) return counts
  const { data, error } = await supabase.from('outreach_queue').select('campaign_id, status, channel').in('campaign_id', campaignIds).limit(20000)
  if (error) fail(error)
  for (const id of campaignIds) counts[id] = { pending: 0, sent: 0, failed: 0, waitingWhatsapp: 0 }
  for (const row of (data ?? []) as { campaign_id: string; status: QueueStatus; channel: Channel }[]) {
    const tally = counts[row.campaign_id]
    if (!tally) continue
    if (row.status === 'pending') {
      tally.pending += 1
      if (row.channel === 'whatsapp') tally.waitingWhatsapp += 1
    }
    if (row.status === 'sent') tally.sent += 1
    if (row.status === 'failed') tally.failed += 1
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

export interface RunResult {
  sent: number
  failed: number
  cancelled: number
  waiting: number
  notes: string[]
}

/** Calls the Edge Function and turns whatever went wrong into a sentence worth reading. */
async function callRunner(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('outreach-run', { body })
  if (error) {
    let message = 'Could not reach the "outreach-run" function. Is it deployed in Supabase?'
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

/** Asks the Edge Function to send whatever email is due right now. */
export async function runNow(campaignId?: string): Promise<RunResult> {
  return (await callRunner({ campaignId, force: true })) as RunResult
}

/** Sends one message to the owner so they can see the Gmail account really works. */
export async function sendTestEmail(to: string) {
  await callRunner({ testTo: to })
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
    .replaceAll('{{opening}}', '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
