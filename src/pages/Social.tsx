import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  WandSparkles,
  X,
} from 'lucide-react'
import PlatformIcon from '../components/PlatformIcon'
import SocialPreview from '../components/SocialPreview'
import { SetupRequiredError } from '../lib/apiStore'
import {
  PLATFORMS,
  STATUS_LABELS,
  countChars,
  deleteAccount,
  deletePost,
  emptyPost,
  fetchAccounts,
  fetchPosts,
  formatWhen,
  fromLocalInput,
  fullText,
  isDue,
  limitFor,
  platform,
  publishPost,
  saveAccount,
  savePost,
  testAccount,
  toLocalInput,
  uploadMedia,
  writeWithAi,
  type MediaItem,
  type PlatformId,
  type PostStatus,
  type SocialAccount,
  type SocialPost,
} from '../lib/social'
import setupSql from '../../supabase/migrations/20261006000000_social.sql?raw'
import './Social.css'

type Tab = 'composer' | 'calendar' | 'posts' | 'accounts' | 'insights'

const TABS: { id: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'composer', label: 'Composer', icon: Sparkles },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'posts', label: 'Posts', icon: LayoutGrid },
  { id: 'accounts', label: 'Accounts', icon: Users },
  { id: 'insights', label: 'Insights', icon: TrendingUp },
]

const STATUS_CLASS: Record<PostStatus, string> = {
  draft: 'is-draft',
  scheduled: 'is-scheduled',
  published: 'is-published',
  partial: 'is-partial',
  failed: 'is-failed',
}

const AI_ACTIONS = [
  { id: 'write', label: 'Write it for me', prompt: 'Write a short, friendly social media post about the attached media if there is any, otherwise about the topic in the draft. Keep it under 300 characters.' },
  { id: 'improve', label: 'Improve', prompt: 'Rewrite this post so it reads better and feels natural. Keep the same meaning and language.' },
  { id: 'shorten', label: 'Shorten', prompt: 'Shorten this post to under 200 characters without losing the point.' },
  { id: 'hashtags', label: 'Add hashtags', prompt: 'Keep the post as it is and add 4-6 relevant hashtags on a new line at the end.' },
]

const newId = () => crypto.randomUUID()
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function SetupCard({ onRetry, checking }: { onRetry: () => void; checking: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(setupSql)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard can be blocked; the file path below still works
    }
  }
  return (
    <section className="card api-setup">
      <span className="api-setup__icon">
        <Database size={22} />
      </span>
      <div className="api-setup__body">
        <h2 className="card__title">Set up the social manager</h2>
        <p className="card__sub">Your accounts and posts live in your Supabase database. Create the two tables once and this page is ready.</p>
        <ol>
          <li>
            Click <strong>Copy SQL</strong> below.
          </li>
          <li>
            In Supabase open <strong>SQL Editor</strong> → <strong>New query</strong>, paste it and press <strong>Run</strong>.
          </li>
          <li>
            Come back and click <strong>Check again</strong>.
          </li>
        </ol>
        <div className="api-setup__actions">
          <button type="button" className="btn btn--primary" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy SQL'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onRetry} disabled={checking}>
            {checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Check again
          </button>
        </div>
        <p className="api-hint">
          The same script is in <code>supabase/migrations/20261006000000_social.sql</code>.
        </p>
      </div>
    </section>
  )
}

export default function Social() {
  const [tab, setTab] = useState<Tab>('composer')
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState('')

  // Composer
  const [draft, setDraft] = useState<SocialPost>(() => emptyPost())
  const [editing, setEditing] = useState(false)
  const [mediaUrl, setMediaUrl] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const [previewIndex, setPreviewIndex] = useState(0)

  // Posts tab
  const [statusFilter, setStatusFilter] = useState<'all' | PostStatus>('all')
  const [platformFilter, setPlatformFilter] = useState<'all' | PlatformId>('all')
  const [search, setSearch] = useState('')

  // Calendar
  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  // Accounts
  const [accountForm, setAccountForm] = useState<SocialAccount | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [accountList, postList] = await Promise.all([fetchAccounts(), fetchPosts()])
      setAccounts(accountList)
      setPosts(postList)
      setSetupRequired(false)
      return postList
    } catch (err) {
      if (err instanceof SetupRequiredError) setSetupRequired(true)
      else setLoadError(err instanceof Error ? err.message : 'Could not load the social manager.')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Posts whose time has passed are sent as soon as the page is opened
    void Promise.resolve()
      .then(load)
      .then(async (list) => {
        const due = list.filter(isDue)
        if (due.length === 0) return
        setBusy('due')
        for (const post of due) {
          try {
            await publishPost(post.id)
          } catch {
            // the post keeps its status; the Posts tab shows what happened
          }
        }
        setBusy('')
        setNote({ kind: 'ok', text: `${due.length} scheduled post${due.length === 1 ? '' : 's'} was due and has been sent.` })
        await load()
      })
  }, [load])

  const liveAccounts = accounts.filter((a) => a.active)
  const selected = accounts.filter((a) => draft.accountIds.includes(a.id))
  const limit = limitFor(accounts, draft.accountIds)
  const used = countChars(draft.content, draft.tags)
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])

  const stats = useMemo(() => {
    return {
      scheduled: posts.filter((p) => p.status === 'scheduled').length,
      published: posts.filter((p) => p.status === 'published' || p.status === 'partial').length,
      drafts: posts.filter((p) => p.status === 'draft').length,
      failed: posts.filter((p) => p.status === 'failed').length,
    }
  }, [posts])

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return posts.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (platformFilter !== 'all' && !p.accountIds.some((id) => accountById.get(id)?.platform === platformFilter)) return false
      if (q && !`${p.content} ${p.tags}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [posts, statusFilter, platformFilter, search, accountById])

  function update(patch: Partial<SocialPost>) {
    setDraft((d) => ({ ...d, ...patch }))
  }

  function resetComposer() {
    setDraft(emptyPost())
    setEditing(false)
    setPreviewIndex(0)
  }

  function editPost(post: SocialPost) {
    setDraft(structuredClone(post))
    setEditing(true)
    setTab('composer')
    setPreviewIndex(0)
    window.scrollTo({ top: 0 })
  }

  function duplicatePost(post: SocialPost) {
    const copy = structuredClone(post)
    copy.id = newId()
    copy.status = 'draft'
    copy.results = []
    copy.publishedAt = null
    setDraft(copy)
    setEditing(false)
    setTab('composer')
    window.scrollTo({ top: 0 })
  }

  async function store(next: SocialPost, message: string) {
    setBusy('save')
    setNote(null)
    try {
      await savePost(next)
      await load()
      setNote({ kind: 'ok', text: message })
      return true
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save the post.' })
      return false
    } finally {
      setBusy('')
    }
  }

  async function saveDraft() {
    if (!draft.content.trim()) {
      setNote({ kind: 'error', text: 'Write something first.' })
      return
    }
    if (await store({ ...draft, status: 'draft' }, 'Saved as a draft.')) resetComposer()
  }

  async function schedule() {
    if (!draft.accountIds.length) return setNote({ kind: 'error', text: 'Choose at least one account.' })
    if (!draft.scheduledAt) return setNote({ kind: 'error', text: 'Pick a date and time.' })
    if (await store({ ...draft, status: 'scheduled' }, `Scheduled for ${formatWhen(draft.scheduledAt)}.`)) resetComposer()
  }

  async function publishNow(post: SocialPost = draft, fromComposer = true) {
    if (!post.accountIds.length) return setNote({ kind: 'error', text: 'Choose at least one account.' })
    if (!post.content.trim()) return setNote({ kind: 'error', text: 'Write something first.' })
    setBusy(`publish:${post.id}`)
    setNote(null)
    try {
      await savePost({ ...post, status: post.status === 'draft' ? 'draft' : post.status })
      const result = await publishPost(post.id)
      await load()
      const failed = result.results.filter((r) => !r.ok)
      setNote(
        failed.length === 0
          ? { kind: 'ok', text: `Sent to ${result.published} account${result.published === 1 ? '' : 's'}.` }
          : { kind: 'error', text: `${result.published} of ${result.total} sent. ${failed[0].error ?? ''}` },
      )
      if (fromComposer && failed.length === 0) resetComposer()
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Publishing failed.' })
    } finally {
      setBusy('')
    }
  }

  async function removePost(post: SocialPost) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return
    try {
      await deletePost(post.id)
      setPosts((list) => list.filter((p) => p.id !== post.id))
      setNote({ kind: 'ok', text: 'Post deleted.' })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not delete the post.' })
    }
  }

  async function runAi(action: (typeof AI_ACTIONS)[number]) {
    setBusy(`ai:${action.id}`)
    setNote(null)
    try {
      const { text, sawMedia } = await writeWithAi(action.prompt, fullText(draft), draft.media)
      update({ content: text })
      if (draft.media.length > 0 && !sawMedia) {
        setNote({ kind: 'error', text: 'The assistant could not open the media from its link, so it wrote from the text only. Uploaded files can always be read.' })
      }
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'The writing helper failed.' })
    } finally {
      setBusy('')
    }
  }

  function addMedia() {
    const url = mediaUrl.trim()
    if (!url) return
    const type: MediaItem['type'] = /\.(mp4|mov|webm)(\?|$)/i.test(url) ? 'video' : 'image'
    update({ media: [...draft.media, { url, type }] })
    setMediaUrl('')
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return
    setBusy('upload')
    setNote(null)
    try {
      for (const file of files) {
        const item = await uploadMedia(file)
        setDraft((d) => ({ ...d, media: [...d.media, item] }))
      }
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'The upload failed.' })
    } finally {
      setBusy('')
    }
  }

  /* ---------- Accounts ---------- */

  async function storeAccount() {
    if (!accountForm) return
    if (!accountForm.label.trim()) return setNote({ kind: 'error', text: 'Give the account a name.' })
    setBusy('account')
    try {
      await saveAccount(accountForm)
      setAccountForm(null)
      await load()
      setNote({ kind: 'ok', text: 'Account saved.' })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save the account.' })
    } finally {
      setBusy('')
    }
  }

  async function removeAccount(account: SocialAccount) {
    if (!window.confirm(`Remove ${account.label || platform(account.platform).name}?`)) return
    try {
      await deleteAccount(account.id)
      await load()
      setNote({ kind: 'ok', text: 'Account removed.' })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not remove the account.' })
    }
  }

  async function sendTest(account: SocialAccount) {
    setBusy(`test:${account.id}`)
    setNote(null)
    try {
      await testAccount(account.id)
      // Facebook and Instagram only check the token, so nothing lands on the public feed
      const checkOnly = account.platform === 'facebook' || account.platform === 'instagram'
      setNote({ kind: 'ok', text: checkOnly ? `${account.label} is connected and ready to post.` : `Test message sent to ${account.label}.` })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'The test failed.' })
    } finally {
      setBusy('')
    }
  }

  /* ---------- Calendar ---------- */

  const calendarDays = useMemo(() => {
    const first = startOfMonth(month)
    const offset = (first.getDay() + 6) % 7 // Monday first
    const days: { date: Date; inMonth: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const date = new Date(first)
      date.setDate(1 - offset + i)
      days.push({ date, inMonth: date.getMonth() === month.getMonth() })
    }
    return days
  }, [month])

  const postsByDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>()
    for (const post of posts) {
      const when = post.scheduledAt ?? post.publishedAt
      if (!when) continue
      const key = new Date(when).toDateString()
      map.set(key, [...(map.get(key) ?? []), post])
    }
    return map
  }, [posts])

  const insights = useMemo(() => {
    const byPlatform = new Map<PlatformId, number>()
    for (const post of posts) {
      if (post.status !== 'published' && post.status !== 'partial') continue
      for (const id of post.accountIds) {
        const p = accountById.get(id)?.platform
        if (p) byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1)
      }
    }
    const days: { label: string; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const date = new Date()
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() - i)
      const key = date.toDateString()
      days.push({
        label: new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(date),
        count: (postsByDay.get(key) ?? []).filter((p) => p.status === 'published' || p.status === 'partial').length,
      })
    }
    return { byPlatform: [...byPlatform.entries()].sort((a, b) => b[1] - a[1]), days, max: Math.max(1, ...days.map((d) => d.count)) }
  }, [posts, accountById, postsByDay])

  /* ---------- Render ---------- */

  if (setupRequired) {
    return (
      <>
        <div className="page-head">
          <div>
            <p className="eyebrow">Marketing</p>
            <h1>
              <em>Social</em> manager
            </h1>
          </div>
        </div>
        <SetupCard onRetry={() => void load()} checking={loading} />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Marketing</p>
          <h1>
            <em>Social</em> manager
          </h1>
          <p className="page-head__sub">Write once, preview per network, schedule and publish — all saved in your own database.</p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => { resetComposer(); setTab('composer') }}>
          <Plus size={16} /> New post
        </button>
      </div>

      {note && (
        <div className={`alert ${note.kind === 'ok' ? 'alert--success' : 'alert--error'} api-banner`} role="status">
          {note.kind === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
          <span>{note.text}</span>
          <button type="button" className="api-icon-btn" onClick={() => setNote(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
      {loadError && (
        <div className="alert alert--error api-banner" role="alert">
          <AlertCircle size={16} />
          <span>{loadError}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void load()}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      <section className="soc-stats">
        {[
          { label: 'Scheduled', value: stats.scheduled, icon: Clock },
          { label: 'Published', value: stats.published, icon: Megaphone },
          { label: 'Drafts', value: stats.drafts, icon: Pencil },
          { label: 'Accounts', value: liveAccounts.length, icon: Users },
        ].map((tile) => (
          <article key={tile.label} className="card soc-tile">
            <span className="soc-tile__icon">
              <tile.icon size={16} />
            </span>
            <div>
              <p className="soc-tile__value">{tile.value}</p>
              <p className="soc-tile__label">{tile.label}</p>
            </div>
          </article>
        ))}
      </section>

      <div className="api-toggle soc-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card api-loading">
          <Loader2 size={20} className="spin" /> Loading your social manager…
        </div>
      ) : tab === 'composer' ? (
        <div className="soc-composer">
          <section className="card">
            <header className="card__head">
              <div>
                <h2 className="card__title">{editing ? 'Edit post' : 'New post'}</h2>
                <p className="card__sub">Pick the accounts, write once — each network gets its own preview.</p>
              </div>
              {editing && (
                <button type="button" className="btn btn--secondary btn--sm" onClick={resetComposer}>
                  <X size={14} /> New instead
                </button>
              )}
            </header>

            <div className="soc-field">
              <span>Accounts</span>
              {accounts.length === 0 ? (
                <p className="api-hint">
                  No accounts yet —{' '}
                  <button type="button" className="link" onClick={() => setTab('accounts')}>
                    connect one first
                  </button>
                  .
                </p>
              ) : (
                <div className="soc-accounts">
                  {accounts.map((a) => {
                    const spec = platform(a.platform)
                    const on = draft.accountIds.includes(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`soc-chip${on ? ' is-on' : ''}`}
                        style={{ ['--brand' as string]: spec.colour }}
                        onClick={() => update({ accountIds: on ? draft.accountIds.filter((id) => id !== a.id) : [...draft.accountIds, a.id] })}
                      >
                        <PlatformIcon id={a.platform} size={15} />
                        {a.label || spec.name}
                        {!spec.live && <span className="soc-chip__tag">preview</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="soc-field">
              <span>Media link</span>
              <div className="soc-media-add">
                <input
                  className="api-input"
                  placeholder="https://… image or video"
                  value={mediaUrl}
                  onChange={(e) => setMediaUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addMedia()
                    }
                  }}
                />
                <button type="button" className="btn btn--secondary btn--sm" onClick={addMedia}>
                  <Link2 size={14} /> Add
                </button>
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => fileInput.current?.click()} disabled={busy === 'upload'}>
                  {busy === 'upload' ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Upload
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    // cleared so the same file can be picked again
                    e.target.value = ''
                    void uploadFiles(files)
                  }}
                />
              </div>
            </div>

            {draft.media.length > 0 && (
              <div className="soc-media">
                {draft.media.map((m) => (
                  <div key={m.url} className="soc-media__item">
                    {m.type === 'video' ? <span className="soc-media__video">Video</span> : <img src={m.url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                    <button type="button" className="api-icon-btn api-icon-btn--danger" onClick={() => update({ media: draft.media.filter((x) => x.url !== m.url) })} aria-label="Remove">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="soc-field">
              <div className="soc-field__row">
                <span>Post</span>
                <span className={`soc-count${used > limit ? ' is-over' : ''}`}>
                  {used} / {limit}
                </span>
              </div>
              <textarea
                className="api-input api-textarea soc-text"
                rows={7}
                placeholder="What do you want to share?"
                value={draft.content}
                onChange={(e) => update({ content: e.target.value })}
              />
              <div className="soc-ai">
                <WandSparkles size={14} />
                {AI_ACTIONS.map((a) => (
                  <button key={a.id} type="button" className="lead-chip" onClick={() => void runAi(a)} disabled={busy.startsWith('ai:')}>
                    {busy === `ai:${a.id}` ? <Loader2 size={13} className="spin" /> : null} {a.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="soc-field">
              <span>Hashtags</span>
              <input className="api-input" placeholder="#teeju #karachi" value={draft.tags} onChange={(e) => update({ tags: e.target.value })} />
            </label>

            <div className="soc-grid">
              <label className="soc-field">
                <span>Schedule for</span>
                <input className="api-input" type="datetime-local" value={toLocalInput(draft.scheduledAt)} onChange={(e) => update({ scheduledAt: fromLocalInput(e.target.value) })} />
              </label>
              <div className="soc-field">
                <span>Quick pick</span>
                <div className="soc-quick">
                  {[
                    { label: 'In 1 hour', hours: 1 },
                    { label: 'Tomorrow 10:00', hours: -1 },
                    { label: 'Next week', hours: 24 * 7 },
                  ].map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      className="lead-chip"
                      onClick={() => {
                        const d = new Date()
                        if (q.hours === -1) {
                          d.setDate(d.getDate() + 1)
                          d.setHours(10, 0, 0, 0)
                        } else {
                          d.setHours(d.getHours() + q.hours)
                        }
                        update({ scheduledAt: d.toISOString() })
                      }}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="soc-actions">
              <button type="button" className="btn btn--primary" onClick={() => void publishNow()} disabled={busy.startsWith('publish')}>
                {busy.startsWith('publish') ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Publish now
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => void schedule()} disabled={busy === 'save'}>
                <Clock size={16} /> Schedule
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => void saveDraft()} disabled={busy === 'save'}>
                <Pencil size={16} /> Save draft
              </button>
            </div>
          </section>

          <aside className="soc-previews">
            <div className="soc-previews__bar">
              <p className="card__title">Preview</p>
              {selected.length > 1 && (
                <div className="api-toggle">
                  {selected.map((a, i) => (
                    <button key={a.id} type="button" className={previewIndex === i ? 'is-active' : ''} onClick={() => setPreviewIndex(i)}>
                      <PlatformIcon id={a.platform} size={13} /> {platform(a.platform).name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selected.length === 0 ? (
              <div className="card soc-empty">
                <ImageIcon size={22} />
                <p>Select an account to see how the post will look.</p>
              </div>
            ) : (
              <SocialPreview account={selected[Math.min(previewIndex, selected.length - 1)]} text={fullText(draft)} media={draft.media} />
            )}
          </aside>
        </div>
      ) : tab === 'calendar' ? (
        <section className="card">
          <header className="card__head soc-cal__head">
            <div>
              <h2 className="card__title">{monthLabel.format(month)}</h2>
              <p className="card__sub">Scheduled and published posts</p>
            </div>
            <div className="soc-cal__nav">
              <button type="button" className="api-icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">
                <ChevronLeft size={16} />
              </button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setMonth(startOfMonth(new Date()))}>
                Today
              </button>
              <button type="button" className="api-icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">
                <ChevronRight size={16} />
              </button>
            </div>
          </header>

          <div className="soc-cal">
            {dayNames.map((d) => (
              <div key={d} className="soc-cal__name">
                {d}
              </div>
            ))}
            {calendarDays.map(({ date, inMonth }) => {
              const dayPosts = postsByDay.get(date.toDateString()) ?? []
              const today = date.toDateString() === new Date().toDateString()
              return (
                <div key={date.toISOString()} className={`soc-cal__day${inMonth ? '' : ' is-muted'}${today ? ' is-today' : ''}`}>
                  <button
                    type="button"
                    className="soc-cal__date"
                    title="Write a post for this day"
                    onClick={() => {
                      const when = new Date(date)
                      when.setHours(10, 0, 0, 0)
                      resetComposer()
                      setDraft({ ...emptyPost(), scheduledAt: when.toISOString() })
                      setTab('composer')
                    }}
                  >
                    {date.getDate()}
                  </button>
                  {dayPosts.slice(0, 3).map((p) => (
                    <button key={p.id} type="button" className={`soc-cal__post ${STATUS_CLASS[p.status]}`} onClick={() => editPost(p)}>
                      <span>{formatWhen(p.scheduledAt ?? p.publishedAt).split(' ').slice(-1)[0]}</span> {p.content.slice(0, 28) || 'Untitled'}
                    </button>
                  ))}
                  {dayPosts.length > 3 && <span className="soc-cal__more">+{dayPosts.length - 3} more</span>}
                </div>
              )
            })}
          </div>
        </section>
      ) : tab === 'posts' ? (
        <section className="card card--flush">
          <header className="card__head inv-list__head">
            <div>
              <h2 className="card__title">All posts</h2>
              <p className="card__sub">{filteredPosts.length} shown</p>
            </div>
            <div className="inv-list__tools">
              <div className="api-toggle">
                {(['all', 'draft', 'scheduled', 'published', 'failed'] as const).map((s) => (
                  <button key={s} type="button" className={statusFilter === s ? 'is-active' : ''} onClick={() => setStatusFilter(s)}>
                    {s === 'all' ? 'All' : STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              <select className="api-input soc-select" value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as PlatformId | 'all')}>
                <option value="all">Every network</option>
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <label className="api-table-search">
                <Search size={15} />
                <span className="sr-only">Search posts</span>
                <input type="search" placeholder="Search text…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            </div>
          </header>

          {filteredPosts.length === 0 ? (
            <div className="empty">
              <span className="empty__icon">
                <Megaphone size={24} />
              </span>
              <h2>No posts yet</h2>
              <p>Write your first post in the composer — you can save it as a draft, schedule it, or send it right away.</p>
            </div>
          ) : (
            <ul className="soc-list">
              {filteredPosts.map((post) => {
                const failed = post.results.filter((r) => !r.ok)
                return (
                  <li key={post.id} className="soc-item">
                    <div className="soc-item__main">
                      <div className="soc-item__top">
                        <span className={`soc-status ${STATUS_CLASS[post.status]}`}>{STATUS_LABELS[post.status]}</span>
                        <span className="soc-item__when">
                          <Clock size={13} /> {formatWhen(post.scheduledAt ?? post.publishedAt) || 'No date'}
                        </span>
                        <span className="soc-item__accounts">
                          {post.accountIds.map((id) => {
                            const a = accountById.get(id)
                            return a ? (
                              <span key={id} className="soc-dot" style={{ ['--brand' as string]: platform(a.platform).colour }} title={a.label}>
                                <PlatformIcon id={a.platform} size={12} />
                              </span>
                            ) : null
                          })}
                        </span>
                      </div>
                      <p className="soc-item__text">{post.content || '(empty)'}</p>
                      {post.tags.trim() && <p className="soc-item__tags">{post.tags}</p>}
                      {failed.length > 0 && (
                        <p className="api-inline-error">
                          {failed.length} failed — {failed[0].error}
                        </p>
                      )}
                    </div>
                    <div className="soc-item__actions">
                      <button type="button" className="api-icon-btn" title="Send now" onClick={() => void publishNow(post, false)} disabled={busy === `publish:${post.id}`}>
                        {busy === `publish:${post.id}` ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                      </button>
                      <button type="button" className="api-icon-btn" title="Edit" onClick={() => editPost(post)}>
                        <Pencil size={15} />
                      </button>
                      <button type="button" className="api-icon-btn" title="Duplicate" onClick={() => duplicatePost(post)}>
                        <Copy size={15} />
                      </button>
                      <button type="button" className="api-icon-btn api-icon-btn--danger" title="Delete" onClick={() => void removePost(post)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : tab === 'accounts' ? (
        <div className="soc-accounts-tab">
          <section className="card">
            <header className="card__head">
              <div>
                <h2 className="card__title">Connected accounts</h2>
                <p className="card__sub">Telegram, Discord, Facebook, Instagram and webhooks post for real. The others are preview-only until their developer app is ready.</p>
              </div>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => setAccountForm({ id: newId(), platform: 'telegram', label: '', handle: '', config: {}, active: true })}
              >
                <Plus size={14} /> Add account
              </button>
            </header>

            {accounts.length === 0 ? (
              <div className="empty">
                <span className="empty__icon">
                  <Users size={24} />
                </span>
                <h2>No accounts connected</h2>
                <p>Add a Telegram channel, a Discord webhook or any webhook URL to start posting.</p>
              </div>
            ) : (
              <ul className="soc-cards">
                {accounts.map((a) => {
                  const spec = platform(a.platform)
                  return (
                    <li key={a.id} className={`soc-card${a.active ? '' : ' is-off'}`} style={{ ['--brand' as string]: spec.colour }}>
                      <div className="soc-card__head">
                        <span className="soc-card__icon">
                          <PlatformIcon id={a.platform} size={18} />
                        </span>
                        <div>
                          <p className="soc-card__name">{a.label || spec.name}</p>
                          <p className="soc-card__handle">{a.handle || spec.handlePlaceholder}</p>
                        </div>
                        <span className={`soc-card__badge${spec.live ? ' is-live' : ''}`}>{spec.live ? 'Posts live' : 'Preview only'}</span>
                      </div>
                      {!spec.live && spec.setup && <p className="api-hint">{spec.setup}</p>}
                      <div className="soc-card__actions">
                        {spec.live && (
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void sendTest(a)} disabled={busy === `test:${a.id}`}>
                            {busy === `test:${a.id}` ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Test
                          </button>
                        )}
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setAccountForm(structuredClone(a))}>
                          <Pencil size={14} /> Edit
                        </button>
                        <label className="lead-check soc-card__toggle">
                          <input type="checkbox" checked={a.active} onChange={(e) => void saveAccount({ ...a, active: e.target.checked }).then(load)} />
                          Active
                        </label>
                        <button type="button" className="api-icon-btn api-icon-btn--danger" title="Remove" onClick={() => void removeAccount(a)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {accountForm && (
            <section className="card">
              <header className="card__head">
                <div>
                  <h2 className="card__title">{accounts.some((a) => a.id === accountForm.id) ? 'Edit account' : 'Add an account'}</h2>
                  <p className="card__sub">Details are stored in your own database and only you can read them.</p>
                </div>
                <button type="button" className="api-icon-btn" onClick={() => setAccountForm(null)} aria-label="Close">
                  <X size={16} />
                </button>
              </header>

              <div className="soc-grid">
                <label className="soc-field">
                  <span>Network</span>
                  <select
                    className="api-input"
                    value={accountForm.platform}
                    onChange={(e) => setAccountForm({ ...accountForm, platform: e.target.value as PlatformId, config: {} })}
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.live ? '' : '(preview only)'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="soc-field">
                  <span>Name</span>
                  <input className="api-input" placeholder="Teeju on Telegram" value={accountForm.label} onChange={(e) => setAccountForm({ ...accountForm, label: e.target.value })} />
                </label>
                <label className="soc-field">
                  <span>Handle</span>
                  <input
                    className="api-input"
                    placeholder={platform(accountForm.platform).handlePlaceholder}
                    autoComplete="off"
                    value={accountForm.handle}
                    onChange={(e) => setAccountForm({ ...accountForm, handle: e.target.value })}
                  />
                </label>
                {platform(accountForm.platform).fields.map((field) => (
                  <label key={field.key} className="soc-field soc-field--wide">
                    <span>{field.label}</span>
                    <input
                      className="api-input api-input--mono"
                      type={field.secret ? 'password' : 'text'}
                      placeholder={field.placeholder}
                      // Stops the browser from filling in the portal's own login here
                      autoComplete={field.secret ? 'new-password' : 'off'}
                      value={accountForm.config[field.key] ?? ''}
                      onChange={(e) => setAccountForm({ ...accountForm, config: { ...accountForm.config, [field.key]: e.target.value } })}
                    />
                    {field.help && <span className="api-hint">{field.help}</span>}
                  </label>
                ))}
              </div>

              <div className="soc-actions">
                <button type="button" className="btn btn--primary" onClick={() => void storeAccount()} disabled={busy === 'account'}>
                  {busy === 'account' ? <Loader2 size={16} className="spin" /> : <Check size={16} />} Save account
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setAccountForm(null)}>
                  Cancel
                </button>
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="soc-insights">
          <section className="card">
            <header className="card__head">
              <div>
                <h2 className="card__title">Published in the last 14 days</h2>
                <p className="card__sub">Counted from posts sent by this portal</p>
              </div>
            </header>
            <div className="soc-bars">
              {insights.days.map((d) => (
                <div key={d.label} className="soc-bar" title={`${d.label}: ${d.count} post${d.count === 1 ? '' : 's'}`}>
                  <span className="soc-bar__fill" style={{ height: `${(d.count / insights.max) * 100}%` }} />
                  <span className="soc-bar__label">{d.label.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <header className="card__head">
              <div>
                <h2 className="card__title">By network</h2>
                <p className="card__sub">Posts delivered per network</p>
              </div>
            </header>
            {insights.byPlatform.length === 0 ? (
              <p className="api-hint">Nothing published yet.</p>
            ) : (
              <ul className="soc-breakdown">
                {insights.byPlatform.map(([id, count]) => {
                  const spec = platform(id)
                  const max = insights.byPlatform[0][1]
                  return (
                    <li key={id}>
                      <div className="soc-breakdown__row">
                        <span className="soc-breakdown__name" style={{ ['--brand' as string]: spec.colour }}>
                          <PlatformIcon id={id} size={14} /> {spec.name}
                        </span>
                        <strong>{count}</strong>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(count / max) * 100}%`, background: spec.colour }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  )
}
