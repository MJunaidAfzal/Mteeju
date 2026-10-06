// Supabase Edge Function: publishes a saved social post to its connected accounts.
//
// Deploy (Dashboard → Edge Functions → Deploy a new function → Via Editor), or:
//   npx supabase functions deploy social-publish
//
// Works today for: telegram (bot), discord (webhook), webhook (any URL — Zapier / Make / n8n).
// Facebook, Instagram, X, LinkedIn, TikTok and YouTube need their own developer apps; those
// accounts are reported back as "not connected" instead of silently appearing to succeed.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

interface Account {
  id: string
  platform: string
  label: string
  handle: string
  config: Record<string, string>
  active: boolean
}

interface PostRow {
  id: string
  content: string
  media: { url: string; type?: string }[]
  account_ids: string[]
  status: string
}

interface Result {
  accountId: string
  ok: boolean
  error?: string
  link?: string
}

async function publishTelegram(account: Account, text: string, media: { url: string }[]): Promise<Result> {
  const token = account.config.botToken?.trim()
  const chatId = account.config.chatId?.trim()
  if (!token || !chatId) return { accountId: account.id, ok: false, error: 'Bot token or chat ID is missing.' }

  const photo = media[0]?.url
  const url = photo
    ? `https://api.telegram.org/bot${token}/sendPhoto`
    : `https://api.telegram.org/bot${token}/sendMessage`
  const body = photo ? { chat_id: chatId, photo, caption: text.slice(0, 1024) } : { chat_id: chatId, text }

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) return { accountId: account.id, ok: false, error: data.description ?? `Telegram returned ${res.status}.` }

  const messageId = data.result?.message_id
  const channel = chatId.startsWith('@') ? chatId.slice(1) : ''
  return { accountId: account.id, ok: true, link: channel && messageId ? `https://t.me/${channel}/${messageId}` : undefined }
}

async function publishDiscord(account: Account, text: string, media: { url: string }[]): Promise<Result> {
  const webhook = account.config.webhookUrl?.trim()
  if (!webhook) return { accountId: account.id, ok: false, error: 'Webhook URL is missing.' }

  const content = media.length ? `${text}\n${media.map((m) => m.url).join('\n')}` : text
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  })
  if (!res.ok) return { accountId: account.id, ok: false, error: `Discord returned ${res.status}.` }
  return { accountId: account.id, ok: true }
}

async function publishWebhook(account: Account, text: string, media: { url: string }[]): Promise<Result> {
  const url = account.config.url?.trim()
  if (!url) return { accountId: account.id, ok: false, error: 'Webhook URL is missing.' }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: account.platform, handle: account.handle, text, media, sentAt: new Date().toISOString() }),
  })
  if (!res.ok) return { accountId: account.id, ok: false, error: `The webhook returned ${res.status}.` }
  return { accountId: account.id, ok: true }
}

const NEEDS_APP = 'This network needs its own developer app and approved API access before posts can be sent.'

async function publishTo(account: Account, text: string, media: { url: string }[]): Promise<Result> {
  try {
    switch (account.platform) {
      case 'telegram':
        return await publishTelegram(account, text, media)
      case 'discord':
        return await publishDiscord(account, text, media)
      case 'webhook':
        return await publishWebhook(account, text, media)
      default:
        return { accountId: account.id, ok: false, error: NEEDS_APP }
    }
  } catch (err) {
    return { accountId: account.id, ok: false, error: err instanceof Error ? err.message : 'The request failed.' }
  }
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
  if (!user) return json({ error: 'You must be signed in to publish.' }, 401)

  let payload: { postId?: string; test?: { accountId: string; text: string } }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }

  // "Send test message" from the Accounts tab
  if (payload.test?.accountId) {
    const { data: account, error } = await supabase.from('social_accounts').select('*').eq('id', payload.test.accountId).maybeSingle()
    if (error) return json({ error: error.message }, 400)
    if (!account) return json({ error: 'That account was not found.' }, 404)
    const result = await publishTo(account as Account, payload.test.text || 'Test message from Teeju 👋', [])
    return result.ok ? json({ ok: true }) : json({ error: result.error ?? 'The test failed.' }, 400)
  }

  if (!payload.postId) return json({ error: 'No post was given.' }, 400)

  const { data: post, error: postError } = await supabase.from('social_posts').select('*').eq('id', payload.postId).maybeSingle()
  if (postError) return json({ error: postError.message }, 400)
  if (!post) return json({ error: 'That post was not found.' }, 404)

  const row = post as PostRow
  const ids = Array.isArray(row.account_ids) ? row.account_ids : []
  if (ids.length === 0) return json({ error: 'This post has no accounts selected.' }, 400)

  const { data: accounts, error: accountsError } = await supabase.from('social_accounts').select('*').in('id', ids)
  if (accountsError) return json({ error: accountsError.message }, 400)

  const results: Result[] = []
  for (const account of (accounts ?? []) as Account[]) {
    results.push(await publishTo(account, row.content, Array.isArray(row.media) ? row.media : []))
  }
  for (const id of ids) {
    if (!results.some((r) => r.accountId === id)) results.push({ accountId: id, ok: false, error: 'That account no longer exists.' })
  }

  const okCount = results.filter((r) => r.ok).length
  const status = okCount === 0 ? 'failed' : okCount === results.length ? 'published' : 'partial'

  const { error: updateError } = await supabase
    .from('social_posts')
    .update({ status, results, published_at: okCount > 0 ? new Date().toISOString() : null })
    .eq('id', row.id)
  if (updateError) return json({ error: updateError.message }, 400)

  return json({ status, results, published: okCount, total: results.length })
})
