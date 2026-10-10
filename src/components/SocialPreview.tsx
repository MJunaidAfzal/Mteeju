import type { ReactNode } from 'react'
import {
  ArrowLeft,
  BatteryFull,
  Bell,
  Bookmark,
  Briefcase,
  CircleUser,
  Clapperboard,
  Ellipsis,
  Eye,
  Globe,
  Hash,
  Heart,
  House,
  Image as ImageIcon,
  Mail,
  Menu,
  MessageCircle,
  Music2,
  Play,
  Plus,
  Repeat2,
  Search,
  Send,
  Share2,
  Signal,
  Smile,
  SquarePlus,
  Store,
  ThumbsDown,
  ThumbsUp,
  Tv,
  Users,
  Wifi,
} from 'lucide-react'
import PlatformIcon from './PlatformIcon'
import { platform, type MediaItem, type PlatformId, type SocialAccount } from '../lib/social'

const initials = (text: string) =>
  text
    .replace(/^@/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || 'TJ'

const TOKEN = /(#[\p{L}\p{N}_]+|@[\w.]+|https?:\/\/\S+)/gu

/** Hashtags, mentions and links take the network's link colour. */
const rich = (text: string) =>
  text.split(TOKEN).map((part, i) =>
    i % 2 ? (
      <span key={i} className="ph-link">
        {part}
      </span>
    ) : (
      part
    ),
  )

interface View {
  name: string
  handle: string
  /** Handle as a username: no @ or #, no spaces */
  user: string
  raw: string
  body: ReactNode
  media: MediaItem[]
  first?: MediaItem
  avatar: ReactNode
}

function Shot({ item, className = '' }: { item: MediaItem; className?: string }) {
  return (
    <div className={`ph-shot ${className}`}>
      {item.type === 'video' ? (
        <>
          <video src={item.url} muted playsInline preload="metadata" />
          <span className="ph-shot__play">
            <Play size={20} fill="currentColor" />
          </span>
        </>
      ) : (
        <img src={item.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
      )}
    </div>
  )
}

function Facebook({ v }: { v: View }) {
  return (
    <>
      <div className="ph-bar">
        <span className="fb-logo">facebook</span>
        <span className="ph-bar__icons fb-icons">
          <span>
            <Plus size={16} />
          </span>
          <span>
            <Search size={16} />
          </span>
          <span>
            <MessageCircle size={16} />
          </span>
        </span>
      </div>
      <div className="ph-feed fb-feed">
        <article className="fb-post">
          <header className="ph-head">
            {v.avatar}
            <div className="ph-who">
              <b>{v.name}</b>
              <small>
                Just now · <Globe size={11} />
              </small>
            </div>
            <Ellipsis size={18} />
          </header>
          <p className="ph-text">{v.body}</p>
          {v.first && <Shot item={v.first} />}
          <div className="fb-stats">
            <span>
              <i className="fb-like">
                <ThumbsUp size={9} />
              </i>
              Be the first to like this
            </span>
            <span>0 comments</span>
          </div>
          <div className="fb-actions">
            <span>
              <ThumbsUp size={16} /> Like
            </span>
            <span>
              <MessageCircle size={16} /> Comment
            </span>
            <span>
              <Share2 size={16} /> Share
            </span>
          </div>
        </article>
      </div>
      <nav className="ph-nav fb-nav">
        <House className="is-on" />
        <Tv />
        <Users />
        <Store />
        <Bell />
        <Menu />
      </nav>
    </>
  )
}

function Instagram({ v }: { v: View }) {
  return (
    <>
      <div className="ph-bar">
        <span className="ig-logo">Instagram</span>
        <span className="ph-bar__icons">
          <Heart size={21} />
          <Send size={21} />
        </span>
      </div>
      <div className="ph-feed">
        <header className="ph-head ig-head">
          <span className="ig-ring">{v.avatar}</span>
          <b>{v.user}</b>
          <Ellipsis size={18} />
        </header>
        {v.first ? (
          <Shot item={v.first} className="ig-shot" />
        ) : (
          <div className="ig-missing">
            <ImageIcon size={24} />
            Instagram needs an image or a video
          </div>
        )}
        <div className="ig-actions">
          <Heart />
          <MessageCircle />
          <Send />
          <Bookmark />
        </div>
        <p className="ig-likes">Be the first to like this</p>
        <p className="ph-text ig-caption">
          <b>{v.user}</b> {v.body}
        </p>
        <small className="ig-time">Just now</small>
      </div>
      <nav className="ph-nav">
        <House className="is-on" />
        <Search />
        <SquarePlus />
        <Clapperboard />
        <CircleUser />
      </nav>
    </>
  )
}

function X({ v }: { v: View }) {
  return (
    <>
      <div className="ph-bar x-bar">
        {v.avatar}
        <PlatformIcon id="x" size={20} />
        <span />
      </div>
      <div className="x-tabs">
        <span className="is-on">For you</span>
        <span>Following</span>
      </div>
      <div className="ph-feed">
        <article className="x-post">
          {v.avatar}
          <div className="x-post__main">
            <p className="x-who">
              <b>{v.name}</b> <span>@{v.user} · now</span>
            </p>
            <p className="ph-text">{v.body}</p>
            {v.first && <Shot item={v.first} className="ph-shot--round" />}
            <div className="x-actions">
              <MessageCircle />
              <Repeat2 />
              <Heart />
              <Eye />
              <Share2 />
            </div>
          </div>
        </article>
      </div>
      <nav className="ph-nav">
        <House className="is-on" />
        <Search />
        <Users />
        <Bell />
        <Mail />
      </nav>
    </>
  )
}

function LinkedIn({ v }: { v: View }) {
  return (
    <>
      <div className="ph-bar li-bar">
        {v.avatar}
        <span className="li-search">
          <Search size={13} /> Search
        </span>
        <MessageCircle size={20} />
      </div>
      <div className="ph-feed li-feed">
        <article className="li-post">
          <header className="ph-head">
            {v.avatar}
            <div className="ph-who">
              <b>{v.name}</b>
              <small>{v.handle}</small>
              <small>
                Just now · <Globe size={11} />
              </small>
            </div>
            <Ellipsis size={18} />
          </header>
          <p className="ph-text">{v.body}</p>
          {v.first && <Shot item={v.first} />}
          <div className="li-actions">
            <span>
              <ThumbsUp size={16} /> Like
            </span>
            <span>
              <MessageCircle size={16} /> Comment
            </span>
            <span>
              <Repeat2 size={16} /> Repost
            </span>
            <span>
              <Send size={16} /> Send
            </span>
          </div>
        </article>
      </div>
      <nav className="ph-nav">
        <House className="is-on" />
        <Users />
        <SquarePlus />
        <Bell />
        <Briefcase />
      </nav>
    </>
  )
}

function Threads({ v }: { v: View }) {
  return (
    <>
      <div className="ph-bar th-bar">
        <PlatformIcon id="threads" size={24} />
      </div>
      <div className="ph-feed">
        <article className="x-post">
          {v.avatar}
          <div className="x-post__main">
            <p className="x-who">
              <b>{v.user}</b> <span>now</span>
            </p>
            <p className="ph-text">{v.body}</p>
            {v.first && <Shot item={v.first} className="ph-shot--round" />}
            <div className="x-actions th-actions">
              <Heart />
              <MessageCircle />
              <Repeat2 />
              <Send />
            </div>
          </div>
        </article>
      </div>
      <nav className="ph-nav">
        <House className="is-on" />
        <Search />
        <Plus />
        <Heart />
        <CircleUser />
      </nav>
    </>
  )
}

function TikTok({ v }: { v: View }) {
  return (
    <>
      <div className="tt-stage">
        {v.first ? <Shot item={v.first} className="tt-shot" /> : <div className="tt-empty">TikTok needs a video or photo</div>}
        <div className="tt-top">
          <span>Following</span>
          <span className="is-on">For You</span>
        </div>
        <div className="tt-rail">
          {v.avatar}
          <span>
            <Heart fill="currentColor" /> 0
          </span>
          <span>
            <MessageCircle fill="currentColor" /> 0
          </span>
          <span>
            <Bookmark fill="currentColor" /> 0
          </span>
          <span>
            <Share2 /> 0
          </span>
        </div>
        <div className="tt-caption">
          <b>@{v.user}</b>
          <p className="ph-text">{v.body}</p>
          <small>
            <Music2 size={12} /> original sound · {v.name}
          </small>
        </div>
      </div>
      <nav className="ph-nav tt-nav">
        <House className="is-on" />
        <Users />
        <span className="tt-plus">
          <Plus size={18} />
        </span>
        <Mail />
        <CircleUser />
      </nav>
    </>
  )
}

function YouTube({ v }: { v: View }) {
  const [title, ...rest] = v.raw.split('\n')
  return (
    <>
      <div className="ph-bar">
        <span className="yt-logo">
          <PlatformIcon id="youtube" size={24} /> YouTube
        </span>
        <span className="ph-bar__icons">
          <Search size={19} />
          <Bell size={19} />
        </span>
      </div>
      <div className="ph-feed">
        {v.first ? (
          <Shot item={v.first} className="yt-player" />
        ) : (
          <div className="yt-player yt-player--empty">
            <Play size={30} fill="currentColor" />
          </div>
        )}
        <div className="yt-body">
          <p className="yt-title">{title.trim() || 'Your video title'}</p>
          <small>0 views · just now</small>
          <div className="yt-channel">
            {v.avatar}
            <b>{v.name}</b>
            <span className="yt-sub">Subscribe</span>
          </div>
          <div className="yt-chips">
            <span>
              <ThumbsUp size={14} /> 0 <i /> <ThumbsDown size={14} />
            </span>
            <span>
              <Share2 size={14} /> Share
            </span>
            <span>
              <Bookmark size={14} /> Save
            </span>
          </div>
          {rest.join('\n').trim() && <p className="ph-text yt-desc">{rich(rest.join('\n').trim())}</p>}
        </div>
      </div>
      <nav className="ph-nav">
        <House className="is-on" />
        <Clapperboard />
        <SquarePlus />
        <Tv />
        <CircleUser />
      </nav>
    </>
  )
}

function Telegram({ v }: { v: View }) {
  return (
    <>
      <div className="ph-bar tg-bar">
        <ArrowLeft size={20} />
        {v.avatar}
        <div className="ph-who">
          <b>{v.name}</b>
          <small>channel</small>
        </div>
        <Ellipsis size={18} />
      </div>
      <div className="ph-feed tg-feed">
        <span className="tg-day">Today</span>
        <div className="tg-bubble">
          {v.first && <Shot item={v.first} />}
          <p className="ph-text">{v.body}</p>
          <small>
            <Eye size={11} /> 1 · 9:41
          </small>
        </div>
      </div>
      <div className="tg-mute">Mute</div>
    </>
  )
}

function Discord({ v }: { v: View }) {
  const channel = v.handle.replace(/^#/, '')
  return (
    <>
      <div className="ph-bar dc-bar">
        <Menu size={20} />
        <b>
          <Hash size={16} /> {channel}
        </b>
        <Users size={19} />
      </div>
      <div className="ph-feed dc-feed">
        <article className="x-post dc-post">
          {v.avatar}
          <div className="x-post__main">
            <p className="x-who">
              <b>{v.name}</b> <i className="dc-bot">APP</i> <span>Today at 9:41</span>
            </p>
            <p className="ph-text">{v.body}</p>
            {v.media.map((m) => (
              <div key={m.url}>
                <p className="ph-text ph-link dc-url">{m.url}</p>
                <Shot item={m} className="ph-shot--round" />
              </div>
            ))}
          </div>
        </article>
      </div>
      <div className="dc-input">
        <span>
          <Plus size={16} />
        </span>
        <p>Message #{channel}</p>
        <Smile size={19} />
      </div>
    </>
  )
}

function Webhook({ v }: { v: View }) {
  const payload = { platform: 'webhook', handle: v.handle, text: v.raw, media: v.media, sentAt: 'when published' }
  return (
    <>
      <div className="ph-bar wh-bar">
        <b>Webhook request</b>
        <span className="wh-method">POST</span>
      </div>
      <div className="ph-feed wh-feed">
        <p className="wh-label">Sent to {v.name} as JSON</p>
        <pre className="wh-code">{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </>
  )
}

const VIEWS: Record<PlatformId, (props: { v: View }) => ReactNode> = {
  facebook: Facebook,
  instagram: Instagram,
  x: X,
  linkedin: LinkedIn,
  threads: Threads,
  tiktok: TikTok,
  youtube: YouTube,
  telegram: Telegram,
  discord: Discord,
  webhook: Webhook,
}

/** These networks are sent the first file only */
const FIRST_ONLY: PlatformId[] = ['telegram', 'facebook', 'instagram']

/** How the post will look in the chosen network's own app, on a phone. */
export default function SocialPreview({ account, text, media }: { account: SocialAccount; text: string; media: MediaItem[] }) {
  const spec = platform(account.platform)
  const name = account.label || spec.name
  const handle = account.handle || spec.handlePlaceholder
  const over = text.length - spec.limit
  const raw = text.slice(0, spec.limit)
  const dark = spec.id === 'tiktok' || spec.id === 'discord'
  const Screen = VIEWS[spec.id]

  const view: View = {
    name,
    handle,
    user: (account.handle || name).replace(/^[@#]/, '').replace(/\s+/g, '').toLowerCase(),
    raw,
    body: raw ? rich(raw) : <span className="ph-placeholder">Your post will appear here…</span>,
    media,
    first: media[0],
    avatar: <span className="ph-avatar">{initials(name)}</span>,
  }

  return (
    <div className="ph-wrap">
      <div className={`ph ph--${spec.id}${dark ? ' ph--dark' : ''}`} style={{ ['--brand' as string]: spec.colour }}>
        <div className="ph__screen">
          <div className="ph__status">
            <span>9:41</span>
            <span className="ph__island" />
            <span className="ph__sys">
              <Signal size={13} />
              <Wifi size={13} />
              <BatteryFull size={17} />
            </span>
          </div>
          <Screen v={view} />
          <span className="ph__home" />
        </div>
      </div>
      {over > 0 && (
        <p className="ph-note is-over">
          +{over} characters over the {spec.name} limit
        </p>
      )}
      {media.length > 1 && FIRST_ONLY.includes(spec.id) && <p className="ph-note">Only the first file is posted on {spec.name}.</p>}
    </div>
  )
}
