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
    live: false,
    handlePlaceholder: 'Your Page name',
    fields: [{ key: 'pageToken', label: 'Page access token', placeholder: 'EAAG…', secret: true }],
    setup: 'Needs a Meta app with pages_manage_posts, reviewed by Meta.',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    colour: '#E1306C',
    limit: 2200,
    live: false,
    handlePlaceholder: '@yourbrand',
    fields: [{ key: 'igUserId', label: 'Instagram user ID', placeholder: '1784…' }],
    setup: 'Needs a Business account linked to a Facebook Page plus an approved Meta app.',
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

export async function writeWithAi(instruction: string, draft: string): Promise<string> {
  const prompt = `${instruction}\n\nPost draft:\n"""${draft || '(empty)'}"""\n\nReply with the post text only — no quotes, no explanation.`
  const { data, error } = await supabase.functions.invoke('ai-agent', {
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: 'You write short, natural social media posts for a small business. Keep the writer’s language and voice.' }] },
    },
  })
  if (error) throw new Error('The writing helper needs the "ai-agent" function deployed in Supabase.')
  if (data?.error) throw new Error(String(data.error))
  const parts = (data?.content?.parts ?? []) as { text?: string }[]
  const text = parts.map((p) => p.text ?? '').join('').trim()
  if (!text) throw new Error('The assistant did not return any text.')
  return text
}
