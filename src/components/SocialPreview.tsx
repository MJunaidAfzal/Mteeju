import { Heart, MessageCircle, Repeat2, Share2 } from 'lucide-react'
import PlatformIcon from './PlatformIcon'
import { platform, type MediaItem, type SocialAccount } from '../lib/social'

const initials = (text: string) =>
  text
    .replace(/^@/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || 'TJ'

/** How the post will look on the chosen network. */
export default function SocialPreview({ account, text, media }: { account: SocialAccount; text: string; media: MediaItem[] }) {
  const spec = platform(account.platform)
  const name = account.label || spec.name
  const handle = account.handle || spec.handlePlaceholder
  const over = text.length - spec.limit

  return (
    <article className={`sp sp--${spec.id}`} style={{ ['--brand' as string]: spec.colour }}>
      <header className="sp__head">
        <span className="sp__avatar">{initials(name)}</span>
        <div className="sp__who">
          <p className="sp__name">
            {name}
            <span className="sp__badge">
              <PlatformIcon id={spec.id} size={13} /> {spec.name}
            </span>
          </p>
          <p className="sp__handle">
            {handle} · just now
          </p>
        </div>
      </header>

      <p className="sp__text">
        {text.slice(0, spec.limit) || 'Your post will appear here…'}
        {over > 0 && <span className="sp__over">+{over} characters over the {spec.name} limit</span>}
      </p>

      {media.length > 0 && (
        <div className={`sp__media sp__media--${Math.min(media.length, 4)}`}>
          {media.slice(0, 4).map((m) => (
            <div key={m.url} className="sp__tile">
              {m.type === 'video' ? <span className="sp__video">Video</span> : <img src={m.url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
            </div>
          ))}
        </div>
      )}

      <footer className="sp__foot">
        <span>
          <Heart size={14} /> 0
        </span>
        <span>
          <MessageCircle size={14} /> 0
        </span>
        <span>
          <Repeat2 size={14} /> 0
        </span>
        <span>
          <Share2 size={14} />
        </span>
      </footer>
    </article>
  )
}
