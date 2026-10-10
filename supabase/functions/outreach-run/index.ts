// Supabase Edge Function: sends the email messages that are due in the outreach queue.
//
// WhatsApp rows are never touched here — those wait in the portal for a one-click send.
//
// Secrets it needs:
//   GMAIL_USER          the Gmail address that sends (use a separate account, not your personal one)
//   GMAIL_APP_PASSWORD  the 16-character app password from Google (not your Gmail password)
//   GEMINI_API_KEY      optional; only used for the {{opening}} line
//
// Deploy: Dashboard → Edge Functions → Deploy a new function → Via Editor (name: outreach-run)
//
// Run it every hour (Dashboard → Integrations → Cron → Create job, or SQL):
//   select cron.schedule('teeju-outreach', '0 * * * *', $$
//     select net.http_post(
//       url := 'https://<project-ref>.supabase.co/functions/v1/outreach-run',
//       headers := '{"Content-Type":"application/json","Authorization":"Bearer <service-role-key>"}'::jsonb,
//       body := '{}'::jsonb
//     );
//   $$);

import { createClient } from 'npm:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']
const MAX_PER_RUN = 60
/** Leads that have answered or opted out never get another message. */
const STOPPED = ['replied', 'won', 'lost', 'unsubscribed']

interface Campaign {
  id: string
  user_id: string
  name: string
  status: string
  from_name: string
  signature: string
  daily_cap: number
  send_from: number
  send_to: number
  timezone: string
}

interface QueueRow {
  id: string
  lead_id: string
  recipient: string
  subject: string
  body: string
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

/** The hour of the day where the campaign owner lives, so messages do not arrive at 3am. */
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
}

/** One sentence about this particular business, so the message does not read like a blast. */
async function aiOpening(lead: Lead, key: string): Promise<string> {
  const prompt =
    'Write ONE short opening sentence (maximum 20 words) for a friendly cold outreach message to a local business. ' +
    'Use a real detail from the facts below. No greeting, no sign-off, no emoji, no quotation marks, no placeholders.\n\n' +
    `Business: ${lead.name}\nType: ${lead.category || 'local business'}\nCity: ${lead.city || lead.country}\n` +
    `Rating: ${lead.rating ?? 'unknown'} from ${lead.reviews ?? 0} reviews\nWebsite: ${lead.website || 'none'}`

  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 80 },
        }),
      })
      if (!res.ok) continue
      const data = await res.json()
      const line = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim().replace(/^["']|["']$/g, '')
      if (line) return line.split('\n')[0]
    } catch {
      // try the next model
    }
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
  // The hourly cron calls this with the service role key; a person calls it from the portal.
  // The key may arrive as the exact secret or as a signed token that claims the service_role.
  const isCron = (serviceKey !== '' && token === serviceKey) || claimsServiceRole(token)

  const supabase = isCron
    ? createClient(url, serviceKey)
    : createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })

  if (!isCron) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return json({ error: 'You must be signed in to run a campaign.' }, 401)
  }

  let payload: { campaignId?: string; force?: boolean; testTo?: string } = {}
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }
  // "Send now" from the portal may ignore the sending window; the cron never does.
  const force = !isCron && payload.force === true

  const gmailUser = Deno.env.get('GMAIL_USER')
  const gmailPassword = Deno.env.get('GMAIL_APP_PASSWORD')
  const geminiKey = Deno.env.get('GEMINI_API_KEY') ?? ''

  // "Send a test email to myself" — proves the Gmail secrets work before a campaign runs.
  if (payload.testTo) {
    if (!gmailUser || !gmailPassword) {
      return json({ error: 'Set the GMAIL_USER and GMAIL_APP_PASSWORD secrets in Supabase first.' }, 400)
    }
    const client = new SMTPClient({
      connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: gmailUser, password: gmailPassword } },
    })
    try {
      await client.send({
        from: gmailUser,
        to: payload.testTo,
        subject: 'Teeju — your sending account works',
        content: 'This is the test message from your Teeju portal. Gmail is connected and campaigns can send.',
        html: '<p>This is the test message from your Teeju portal.</p><p>Gmail is connected and campaigns can send.</p>',
      })
      return json({ test: true, to: payload.testTo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gmail refused the message.'
      return json({ error: `Gmail refused it: ${message.slice(0, 200)}` }, 400)
    } finally {
      try {
        await client.close()
      } catch {
        // the connection may already be gone
      }
    }
  }

  let query = supabase.from('campaigns').select('*').eq('status', 'running')
  if (payload.campaignId) query = query.eq('id', payload.campaignId)
  const { data: campaignRows, error: campaignError } = await query
  if (campaignError) return json({ error: campaignError.message }, 400)

  const campaigns = (campaignRows ?? []) as Campaign[]
  if (campaigns.length === 0) return json({ sent: 0, failed: 0, cancelled: 0, waiting: 0, notes: ['No campaign is running.'] })

  let sent = 0
  let failed = 0
  let cancelled = 0
  let waiting = 0
  const notes: string[] = []
  let mailer: SMTPClient | null = null

  for (const campaign of campaigns) {
    const hour = localHour(campaign.timezone)
    if (!force && (hour < campaign.send_from || hour >= campaign.send_to)) {
      waiting += 1
      continue
    }

    // Daily cap, counted over the last 24 hours.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('outreach_queue')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('status', 'sent')
      .gte('sent_at', since)
    const room = Math.min(campaign.daily_cap - (count ?? 0), MAX_PER_RUN - sent)
    if (room <= 0) {
      waiting += 1
      continue
    }

    const { data: dueRows, error: dueError } = await supabase
      .from('outreach_queue')
      .select('id, lead_id, recipient, subject, body')
      .eq('campaign_id', campaign.id)
      .eq('channel', 'email')
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

    if (!gmailUser || !gmailPassword) {
      return json({ error: 'Set the GMAIL_USER and GMAIL_APP_PASSWORD secrets in Supabase before sending email.' }, 400)
    }

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

      let body = fill(row.body, lead)
      if (body.includes('{{opening}}')) {
        const opening = geminiKey ? await aiOpening(lead, geminiKey) : ''
        body = body.replaceAll('{{opening}}', opening)
      }
      if (campaign.signature) body = `${body}\n\n${campaign.signature}`
      body = `${body}\n\nIf you would rather not hear from me, reply with "stop" and I will not write again.`

      try {
        if (!mailer) {
          mailer = new SMTPClient({
            connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: gmailUser, password: gmailPassword } },
          })
        }
        await mailer.send({
          from: campaign.from_name ? `${campaign.from_name} <${gmailUser}>` : gmailUser,
          to: row.recipient,
          subject: fill(row.subject, lead) || 'Hello',
          content: body,
          html: body.split('\n').map((line) => (line.trim() === '' ? '<br>' : `<p style="margin:0 0 10px">${line}</p>`)).join(''),
        })
        await supabase.from('outreach_queue').update({ status: 'sent', sent_at: new Date().toISOString(), body, error: '' }).eq('id', row.id)
        if (!STOPPED.includes(lead.status) && lead.status !== 'contacted') {
          await supabase.from('leads').update({ status: 'contacted' }).eq('id', lead.id)
        }
        sent += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The email could not be sent.'
        await supabase.from('outreach_queue').update({ status: 'failed', error: message.slice(0, 300) }).eq('id', row.id)
        notes.push(message)
        failed += 1
        // Gmail refused the login — stop now instead of burning through the queue.
        if (/auth|credential|password|username/i.test(message)) break
      }
    }
  }

  if (mailer) {
    try {
      await mailer.close()
    } catch {
      // the connection may already be gone
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
