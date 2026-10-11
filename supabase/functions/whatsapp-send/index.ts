// Teeju — sends the due WhatsApp messages of "automatic" campaigns through the
// official Meta Cloud API. Campaigns left on manual are never touched here.
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   WHATSAPP_TOKEN     permanent access token of the system user that owns the number
//   WHATSAPP_PHONE_ID  the Phone number ID from WhatsApp → API setup (not the number itself)
//
// Deploy: Dashboard → Edge Functions → Deploy a new function → Via Editor (name: whatsapp-send)
//
// Optional hourly run: Integrations → Cron → new job → 0 * * * *
//   select net.http_post(
//     url := 'https://<project-ref>.supabase.co/functions/v1/whatsapp-send',
//     headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>', 'Content-Type', 'application/json'),
//     body := '{}'::jsonb
//   );
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const GRAPH = 'https://graph.facebook.com/v21.0'
const MAX_PER_RUN = 200
/** Leads that have answered or opted out never get another message. */
const STOPPED = ['replied', 'won', 'lost', 'unsubscribed']

interface Campaign {
  id: string
  name: string
  status: string
  daily_cap: number
  send_from: number
  send_to: number
  timezone: string
  template_name: string
  template_lang: string
  template_params: string
}

interface QueueRow {
  id: string
  campaign_id: string
  lead_id: string
  recipient: string
}

interface Lead {
  id: string
  name: string
  category: string
  city: string
  country: string
  website: string
  rating: number | null
  reviews: number | null
  status: string
}

/**
 * True when the caller is the scheduler rather than a person. The platform has already
 * checked the token's signature, so reading its claims here is enough.
 */
function claimsServiceRole(token: string) {
  try {
    const [, payload] = token.split('.')
    if (!payload) return false
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return claims?.role === 'service_role'
  } catch {
    return false
  }
}

/** The hour of the day where the campaign owner lives, so messages do not go out at 3am. */
function localHour(timezone: string) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(new Date()))
  } catch {
    return new Date().getUTCHours()
  }
}

function fill(text: string, lead: Lead) {
  return text
    .replaceAll('{{name}}', lead.name)
    .replaceAll('{{category}}', lead.category || 'business')
    .replaceAll('{{city}}', lead.city || lead.country || 'your area')
    .replaceAll('{{rating}}', lead.rating === null ? '' : String(lead.rating))
    .replaceAll('{{reviews}}', lead.reviews === null ? '' : String(lead.reviews))
    .replaceAll('{{website}}', lead.website)
    .trim()
}

/** "{{name}}, {{city}}" → one template parameter per entry, in order. */
const paramsFor = (recipe: string, lead: Lead) =>
  recipe
    .split(',')
    .map((part) => fill(part, lead))
    .filter((part) => part.length > 0)

/** One template message. Meta answers with the error text when it refuses. */
async function sendTemplate(token: string, phoneId: string, to: string, campaign: Campaign, params: string[]) {
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: campaign.template_name,
        language: { code: campaign.template_lang || 'en_US' },
        ...(params.length
          ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] }
          : {}),
      },
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(data?.error?.message ?? `WhatsApp refused it (${res.status}).`))
  return String(data?.messages?.[0]?.id ?? '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  const isCron = serviceKey !== '' && claimsServiceRole(token)

  // The cron runs as the service role and sees every owner's campaigns; a person
  // signed into the portal only ever sees their own, through their own token.
  const supabase = isCron
    ? createClient(url, serviceKey)
    : createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })

  let payload: { campaignId?: string; force?: boolean; testTo?: string; templateName?: string; templateLang?: string } = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }
  // "Send now" from the portal may ignore the sending window; the cron never does.
  const force = !isCron && payload.force === true

  const waToken = Deno.env.get('WHATSAPP_TOKEN')
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID')
  if (!waToken || !phoneId) {
    return json({ error: 'Set the WHATSAPP_TOKEN and WHATSAPP_PHONE_ID secrets in Supabase first.' }, 400)
  }

  // "Send one to myself" — proves the number, the token and the template all work.
  if (payload.testTo) {
    const digits = payload.testTo.replace(/\D/g, '')
    if (!digits) return json({ error: 'Give the number to test with, including the country code.' }, 400)
    if (!payload.templateName) return json({ error: 'Give the template name to test with.' }, 400)
    try {
      await sendTemplate(
        waToken,
        phoneId,
        digits,
        { template_name: payload.templateName, template_lang: payload.templateLang || 'en_US' } as Campaign,
        ['Teeju'],
      )
      return json({ test: true, to: digits })
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : 'WhatsApp refused the message.' }, 400)
    }
  }

  let query = supabase.from('campaigns').select('*').eq('status', 'running').eq('auto_send', true)
  if (payload.campaignId) query = query.eq('id', payload.campaignId)
  const { data: campaignRows, error: campaignError } = await query
  if (campaignError) return json({ error: campaignError.message }, 400)

  const campaigns = (campaignRows ?? []) as Campaign[]
  let sent = 0
  let failed = 0
  let cancelled = 0
  let waiting = 0
  const notes: string[] = []

  for (const campaign of campaigns) {
    if (!campaign.template_name) {
      notes.push(`"${campaign.name}" has no template name yet.`)
      waiting += 1
      continue
    }
    const hour = localHour(campaign.timezone)
    if (!force && (hour < campaign.send_from || hour >= campaign.send_to)) {
      waiting += 1
      continue
    }

    // Today's cap, counted from what this campaign has already sent.
    const since = new Date()
    since.setHours(0, 0, 0, 0)
    const { count: already } = await supabase
      .from('outreach_queue')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('status', 'sent')
      .gte('sent_at', since.toISOString())
    const room = Math.min(campaign.daily_cap - (already ?? 0), MAX_PER_RUN)
    if (room <= 0) {
      waiting += 1
      continue
    }

    const { data: dueRows, error: dueError } = await supabase
      .from('outreach_queue')
      .select('id, campaign_id, lead_id, recipient')
      .eq('campaign_id', campaign.id)
      .eq('channel', 'whatsapp')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(room)
    if (dueError) {
      notes.push(dueError.message)
      continue
    }
    const due = (dueRows ?? []) as QueueRow[]
    if (due.length === 0) continue

    const { data: leadRows } = await supabase
      .from('leads')
      .select('id, name, category, city, country, website, rating, reviews, status')
      .in('id', [...new Set(due.map((row) => row.lead_id))])
    const leads = new Map(((leadRows ?? []) as Lead[]).map((lead) => [lead.id, lead]))

    for (const row of due) {
      const lead = leads.get(row.lead_id)
      // The lead answered, or was marked done, while this message waited in the queue.
      if (!lead || STOPPED.includes(lead.status)) {
        await supabase.from('outreach_queue').update({ status: 'cancelled', error: 'The lead is no longer in the campaign.' }).eq('id', row.id)
        cancelled += 1
        continue
      }
      try {
        await sendTemplate(waToken, phoneId, row.recipient, campaign, paramsFor(campaign.template_params, lead))
        await supabase.from('outreach_queue').update({ status: 'sent', sent_at: new Date().toISOString(), error: '' }).eq('id', row.id)
        if (lead.status !== 'contacted') await supabase.from('leads').update({ status: 'contacted' }).eq('id', lead.id)
        sent += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The message could not be sent.'
        await supabase.from('outreach_queue').update({ status: 'failed', error: message.slice(0, 300) }).eq('id', row.id)
        notes.push(message)
        failed += 1
        // A bad token or a rejected template fails for every lead — stop instead of burning the queue.
        if (/token|permission|template|authenticat/i.test(message)) break
      }
    }
  }

  // A campaign with nothing left to send is finished.
  for (const campaign of campaigns) {
    const { count } = await supabase
      .from('outreach_queue')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('status', 'pending')
    if ((count ?? 0) === 0) {
      await supabase.from('campaigns').update({ status: 'done', stopped_at: new Date().toISOString() }).eq('id', campaign.id)
    }
  }

  return json({ sent, failed, cancelled, waiting, notes: [...new Set(notes)].slice(0, 3) })
})
