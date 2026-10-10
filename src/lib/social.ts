// Social media manager: connected accounts, posts, scheduling and publishing.
import { supabase } from './supabase'
import { SetupRequiredError } from './apiStore'

export type PlatformId =
  | 'telegram'
  | 'discord'
  | 'webhook'
  | 'facebook'
  | 'instagram'
  | 'x'
  | 'linkedin'
  | 'threads'
  | 'tiktok'
  | 'youtube'

export type PostStatus = 'draft' | 'scheduled' | 'published' | 'partial' | 'failed'

export interface PlatformField {
  key: string
  label: string
  placeholder: string
  help?: string
  secret?: boolean
}

export interface Platform {
  id: PlatformId
  name: string
  colour: string
  limit: number
  /** Publishing works today without an approved developer app */
  live: boolean
  handlePlaceholder: string
  fields: PlatformField[]
  setup?: string
}

export const PLATFORMS: Platform[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    colour: '#229ED9',
    limit: 4096,
    live: true,
    handlePlaceholder: '@yourchannel',
    fields: [
      { key: 'botToken', label: 'Bot token', placeholder: '123456:ABC-DEF…', secret: true, help: 'Create a bot with @BotFather and paste its token.' },
      { key: 'chatId', label: 'Channel or chat ID', placeholder: '@yourchannel or -1001234567890', help: 'Add the bot to the channel as an admin first.' },
    ],
  },
  {
    id: 'discord',
    name: 'Discord',
    colour: '#5865F2',
    limit: 2000,
    live: true,
    handlePlaceholder: '#announcements',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        placeholder: 'https://discord.com/api/webhooks/…',
        secret: true,
        help: 'Channel → Edit Channel → Integrations → Webhooks → New Webhook.',
      },
    ],
  },
  {
    id: 'webhook',
    name: 'Webhook',
    colour: '#6B7280',
    limit: 10000,
    live: true,
    handlePlaceholder: 'Zapier / Make / n8n',
    fields: [{ key: 'url', label: 'Endpoint URL', placeholder: 'https://hooks.zapier.com/…', help: 'Teeju posts JSON: { platform, handle, text, media, sentAt }.' }],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    colour: '#1877F2',
    limit: 63206,
    live: true,
    handlePlaceholder: 'Your Page name',
    fields: [
      {
        key: 'pageToken',
        label: 'Page access token',
        placeholder: 'EAAG…',
        secret: true,
        help: 'From your Meta app: the access_token of your Page in /me/accounts. Needs pages_manage_posts.',
      },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    colour: '#E1306C',
    limit: 2200,
    live: true,
    handlePlaceholder: '@yourbrand',
    fields: [
      {
        key: 'igUserId',
        label: 'Instagram user ID',
        placeholder: '1784…',
        help: 'The instagram_business_account id of the Facebook Page linked to your Business or Creator account.',
      },
      {
        key: 'accessToken',
        label: 'Access token',
        placeholder: 'EAAG…',
        secret: true,
        help: 'The linked Page’s access token, with instagram_content_publish. Every post needs an image or a video.',
      },
    ],
  },
  {
    id: 'x',
    name: 'X',
    colour: '#111111',
    limit: 280,
    live: false,
    handlePlaceholder: '@yourbrand',
    fields: [{ key: 'bearer', label: 'API bearer token', placeholder: 'AAAA…', secret: true }],
    setup: 'Posting needs a paid X API plan.',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    colour: '#0A66C2',
    limit: 3000,
    live: false,
    handlePlaceholder: 'Company page',
    fields: [{ key: 'accessToken', label: 'Access token', placeholder: 'AQV…', secret: true }],
    setup: 'Needs LinkedIn Marketing API access.',
  },
  { id: 'threads', name: 'Threads', colour: '#000000', limit: 500, live: false, handlePlaceholder: '@yourbrand', fields: [], setup: 'Needs a Meta app with Threads API access.' },
  { id: 'tiktok', name: 'TikTok', colour: '#FE2C55', limit: 2200, live: false, handlePlaceholder: '@yourbrand', fields: [], setup: 'Needs TikTok Content Posting API approval.' },
  { id: 'youtube', name: 'YouTube', colour: '#FF0000', limit: 5000, live: false, handlePlaceholder: 'Your channel', fields: [], setup: 'Needs a Google Cloud project with the YouTube Data API.' },
]

export const platform = (id: string) => PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[2]

export interface SocialAccount {
  id: string
  platform: PlatformId
  label: string
  handle: string
  config: Record<string, string>
  active: boolean
  createdAt?: string
}

export interface MediaItem {
  url: string
  type: 'image' | 'video'
}

export interface PostResult {
  accountId: string
  ok: boolean
  error?: string
  link?: string
}

export interface SocialPost {
  id: string
  content: string
  media: MediaItem[]
  accountIds: string[]
  tags: string
  scheduledAt: string | null
  status: PostStatus
  results: PostResult[]
  publishedAt: string | null
  createdAt?: string
}

export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Published',
  partial: 'Partly sent',
  failed: 'Failed',
}

export const emptyPost = (): SocialPost => ({
  id: crypto.randomUUID(),
  content: '',
  media: [],
  accountIds: [],
  tags: '',
  scheduledAt: null,
  status: 'draft',
  results: [],
  publishedAt: null,
})

/* ---------- Helpers ---------- */

/** The tightest character limit among the chosen accounts. */
export function limitFor(accounts: SocialAccount[], ids: string[]) {
  const limits = ids.map((id) => accounts.find((a) => a.id === id)).filter(Boolean).map((a) => platform(a!.platform).limit)
  return limits.length ? Math.min(...limits) : 10000
}

export const countChars = (text: string, tags: string) => `${text}${tags.trim() ? `\n\n${tags.trim()}` : ''}`.length

export const fullText = (post: Pick<SocialPost, 'content' | 'tags'>) => `${post.content}${post.tags.trim() ? `\n\n${post.tags.trim()}` : ''}`

export function formatWhen(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

/** "2026-10-06T14:30" for a datetime-local input, in the viewer's own timezone. */
export function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null)

export const isDue = (post: SocialPost) => post.status === 'scheduled' && Boolean(post.scheduledAt) && new Date(post.scheduledAt!).getTime() <= Date.now()

/* ---------- Supabase ---------- */

function fail(error: { code?: string; message: string }): never {
  if (error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message)) {
    throw new SetupRequiredError('The social tables do not exist in Supabase yet.')
  }
  throw new Error(error.message)
}

interface AccountRow {
  id: string
  platform: PlatformId
  label: string
  handle: string
  config: Record<string, string> | null
  active: boolean
  created_at: string
}

interface PostRow {
  id: string
  content: string
  media: MediaItem[] | null
  account_ids: string[] | null
  tags: string | null
  scheduled_at: string | null
  status: PostStatus
  results: PostResult[] | null
  published_at: string | null
  created_at: string
}

const accountFrom = (row: AccountRow): SocialAccount => ({
  id: row.id,
  platform: row.platform,
  label: row.label,
  handle: row.handle,
  config: row.config ?? {},
  active: row.active,
  createdAt: row.created_at,
})

const postFrom = (row: PostRow): SocialPost => ({
  id: row.id,
  content: row.content ?? '',
  media: Array.isArray(row.media) ? row.media : [],
  accountIds: Array.isArray(row.account_ids) ? row.account_ids : [],
  tags: row.tags ?? '',
  scheduledAt: row.scheduled_at,
  status: row.status,
  results: Array.isArray(row.results) ? row.results : [],
  publishedAt: row.published_at,
  createdAt: row.created_at,
})

export async function fetchAccounts(): Promise<SocialAccount[]> {
  const { data, error } = await supabase.from('social_accounts').select('*').order('created_at')
  if (error) fail(error)
  return (data as AccountRow[]).map(accountFrom)
}

export async function saveAccount(account: SocialAccount) {
  const { error } = await supabase.from('social_accounts').upsert({
    id: account.id,
    platform: account.platform,
    label: account.label,
    handle: account.handle,
    config: account.config,
    active: account.active,
  })
  if (error) fail(error)
}

export async function deleteAccount(id: string) {
  const { error } = await supabase.from('social_accounts').delete().eq('id', id)
  if (error) fail(error)
}

export async function fetchPosts(): Promise<SocialPost[]> {
  const { data, error } = await supabase
    .from('social_posts')
    .select('*')
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) fail(error)
  return (data as PostRow[]).map(postFrom)
}

export async function savePost(post: SocialPost) {
  const { error } = await supabase.from('social_posts').upsert({
    id: post.id,
    content: post.content,
    media: post.media,
    account_ids: post.accountIds,
    tags: post.tags,
    scheduled_at: post.scheduledAt,
    status: post.status,
    results: post.results,
    published_at: post.publishedAt,
  })
  if (error) fail(error)
}

export async function deletePost(id: string) {
  const { error } = await supabase.from('social_posts').delete().eq('id', id)
  if (error) fail(error)
}

/* ---------- Media uploads ---------- */

const MEDIA_BUCKET = 'social-media'

/** Instagram only accepts JPEG pictures, so PNG, WebP and the like are converted first. */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not prepare the image.')
  // JPEG has no transparency
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('This browser could not prepare the image.'))), 'image/jpeg', 0.92),
  )
}

/** Stores a picture or video in Supabase Storage and returns its public link. */
export async function uploadMedia(file: File): Promise<MediaItem> {
  const isVideo = file.type.startsWith('video/')
  if (!isVideo && !file.type.startsWith('image/')) throw new Error(`"${file.name}" is not an image or a video.`)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('You must be signed in to upload.')

  const asIs = isVideo || file.type === 'image/jpeg' || file.type === 'image/gif'
  const body = asIs ? file : await toJpeg(file)
  const named = file.name.split('.').pop()?.toLowerCase() ?? ''
  const extension = asIs ? (/^[a-z0-9]{1,5}$/.test(named) ? named : isVideo ? 'mp4' : 'jpg') : 'jpg'
  const path = `${user.id}/${crypto.randomUUID()}.${extension}`

  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, { contentType: asIs ? file.type : 'image/jpeg', cacheControl: '31536000' })
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new Error('Uploads need the "social-media" storage bucket. Run supabase/migrations/20261010000000_social_media_storage.sql in Supabase → SQL Editor.')
    }
    throw new Error(error.message)
  }
  return { url: supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl, type: isVideo ? 'video' : 'image' }
}

/* ---------- Publishing ---------- */

async function callPublish(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('social-publish', { body })
  if (error) {
    let message = 'Could not reach the "social-publish" function. Is it deployed in Supabase?'
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
  return data as { status: PostStatus; results: PostResult[]; published: number; total: number }
}

export const publishPost = (postId: string) => callPublish({ postId })

export const testAccount = (accountId: string, text = 'Test message from Teeju 👋') => callPublish({ test: { accountId, text } })

/* ---------- Writing help (uses the assistant's Gemini function) ---------- */

/** A small JPEG of a picture or video frame, base64 without the data: prefix. */
function snapshot(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, 1024 / Math.max(width, height, 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
}

async function imageShot(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('The picture could not be opened.')
  const bitmap = await createImageBitmap(await res.blob())
  const shot = snapshot(bitmap, bitmap.width, bitmap.height)
  bitmap.close()
  return shot
}

/** Three frames from the start, middle and end stand in for the whole video. */
async function videoShots(url: string) {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.preload = 'auto'
  const wait = (event: 'loadeddata' | 'seeked') =>
    new Promise<void>((resolve, reject) => {
      video.addEventListener(event, () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error('The video could not be opened.')), { once: true })
      window.setTimeout(() => reject(new Error('The video took too long to open.')), 15000)
    })

  const loaded = wait('loadeddata')
  video.src = url
  await loaded

  const shots: string[] = []
  const duration = Number.isFinite(video.duration) ? video.duration : 0
  for (const at of duration > 1 ? [0.1, 0.5, 0.9] : [0]) {
    const seeked = wait('seeked')
    video.currentTime = duration * at
    await seeked
    shots.push(snapshot(video, video.videoWidth, video.videoHeight))
  }
  video.removeAttribute('src')
  video.load()
  return shots
}

/** What the assistant gets to look at: up to three files; ones the browser cannot open are left out. */
async function mediaShots(media: MediaItem[]) {
  const shots: string[] = []
  for (const item of media.slice(0, 3)) {
    try {
      if (item.type === 'video') shots.push(...(await videoShots(item.url)))
      else shots.push(await imageShot(item.url))
    } catch {
      // usually a link on another site that does not allow reading its files
    }
  }
  return shots
}

/** Writes or rewrites the post. With media attached, the assistant looks at it first; `sawMedia` says whether it could. */
export async function writeWithAi(instruction: string, draft: string, media: MediaItem[] = []): Promise<{ text: string; sawMedia: boolean }> {
  const shots = await mediaShots(media)
  const look = shots.length
    ? 'The attached pictures are the media of this post (a video is shown as a few of its frames). Look at them and base the post on what they show.\n\n'
    : ''
  const prompt = `${look}${instruction}\n\nPost draft:\n"""${draft || '(empty)'}"""\n\nReply with the post text only — no quotes, no explanation.`
  const { data, error } = await supabase.functions.invoke('ai-agent', {
    body: {
      contents: [{ role: 'user', parts: [...shots.map((data) => ({ inlineData: { mimeType: 'image/jpeg', data } })), { text: prompt }] }],
      systemInstruction: { parts: [{ text: 'You write short, natural social media posts for a small business. Keep the writer’s language and voice.' }] },
    },
  })
  if (error) throw new Error('The writing helper needs the "ai-agent" function deployed in Supabase.')
  if (data?.error) throw new Error(String(data.error))
  const parts = (data?.content?.parts ?? []) as { text?: string }[]
  const text = parts.map((p) => p.text ?? '').join('').trim()
  if (!text) throw new Error('The assistant did not return any text.')
  return { text, sawMedia: shots.length > 0 }
}
