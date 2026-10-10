// Supabase Edge Function: publishes a saved social post to its connected accounts.
//
// Deploy (Dashboard → Edge Functions → Deploy a new function → Via Editor), or:
//   npx supabase functions deploy social-publish
//
// Works today for: telegram (bot), discord (webhook), webhook (any URL — Zapier / Make / n8n),
// facebook (Page access token) and instagram (Business account + access token).
// X, LinkedIn, Threads, TikTok and YouTube need their own developer apps; those
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

interface Media {
  url: string
  type?: string
}

interface PostRow {
  id: string
  content: string
  media: Media[]
  account_ids: string[]
  tags: string | null
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

const GRAPH = 'https://graph.facebook.com/v24.0'

/** Calls the Meta Graph API and returns its JSON, or throws Meta's own error message. */
async function graph(path: string, token: string, params?: Record<string, string>) {
  const res = params
    ? await fetch(`${GRAPH}/${path}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }) })
    : await fetch(`${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) throw new Error(data.error?.message ?? `Meta returned ${res.status}.`)
  return data
}

const isVideo = (item?: Media) => item?.type === 'video'

// With a Page access token, "me" is the Page itself.
async function publishFacebook(account: Account, text: string, media: Media[], test: boolean): Promise<Result> {
  const token = account.config.pageToken?.trim()
  if (!token) return { accountId: account.id, ok: false, error: 'Page access token is missing.' }

  // Testing only checks the token, so nothing appears on the public Page
  if (test) {
    await graph('me?fields=id,name', token)
    return { accountId: account.id, ok: true }
  }

  const first = media[0]
  const data = !first
    ? await graph('me/feed', token, { message: text })
    : isVideo(first)
      ? await graph('me/videos', token, { file_url: first.url, description: text })
      : await graph('me/photos', token, { url: first.url, caption: text })

  const id = data.post_id ?? data.id
  return { accountId: account.id, ok: true, link: id ? `https://www.facebook.com/${id}` : undefined }
}

async function publishInstagram(account: Account, text: string, media: Media[], test: boolean): Promise<Result> {
  const token = account.config.accessToken?.trim()
  const userId = account.config.igUserId?.trim()
  if (!token || !userId) return { accountId: account.id, ok: false, error: 'Instagram user ID or access token is missing.' }

  if (test) {
    await graph(`${userId}?fields=username`, token)
    return { accountId: account.id, ok: true }
  }

  const first = media[0]
  if (!first) return { accountId: account.id, ok: false, error: 'Instagram posts need an image or a video.' }

  const container = await graph(
    `${userId}/media`,
    token,
    isVideo(first) ? { media_type: 'REELS', video_url: first.url, caption: text } : { image_url: first.url, caption: text },
  )

  // Instagram downloads the file first; videos can take a while
  for (let attempt = 0; attempt < 30; attempt++) {
    const { status_code: status } = await graph(`${container.id}?fields=status_code`, token)
    if (status === 'FINISHED') break
    if (status === 'ERROR' || status === 'EXPIRED') return { accountId: account.id, ok: false, error: 'Instagram could not process the media file.' }
    if (attempt === 29) return { accountId: account.id, ok: false, error: 'Instagram is still processing the media. Try again shortly.' }
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }

  const published = await graph(`${userId}/media_publish`, token, { creation_id: container.id })
  const { permalink } = await graph(`${published.id}?fields=permalink`, token).catch(() => ({ permalink: undefined }))
  return { accountId: account.id, ok: true, link: permalink }
}

const NEEDS_APP = 'This network needs its own developer app and approved API access before posts can be sent.'

async function publishTo(account: Account, text: string, media: Media[], test = false): Promise<Result> {
  try {
    switch (account.platform) {
      case 'telegram':
        return await publishTelegram(account, text, media)
      case 'discord':
        return await publishDiscord(account, text, media)
      case 'webhook':
        return await publishWebhook(account, text, media)
      case 'facebook':
        return await publishFacebook(account, text, media, test)
      case 'instagram':
        return await publishInstagram(account, text, media, test)
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
    const result = await publishTo(account as Account, payload.test.text || 'Test message from Teeju 👋', [], true)
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

  // Same text the composer previews: the post, then its hashtags
  const tags = row.tags?.trim()
  const text = tags ? `${row.content}\n\n${tags}` : row.content

  const results: Result[] = []
  for (const account of (accounts ?? []) as Account[]) {
    results.push(await publishTo(account, text, Array.isArray(row.media) ? row.media : []))
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
