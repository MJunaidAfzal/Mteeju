import type { PlatformId } from '../lib/social'

/**
 * Simple geometric marks for each network — drawn here so the portal keeps one
 * visual style and does not depend on brand logo files.
 */
export default function PlatformIcon({ id, size = 16 }: { id: PlatformId; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const, fill: 'none' }
  const stroke = { stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  switch (id) {
    case 'telegram':
      return (
        <svg {...common}>
          <path d="M21 4 3 11l6 2 2 6 3-4 5 4 2-15Z" {...stroke} />
          <path d="m9 13 8-6-5 8" {...stroke} />
        </svg>
      )
    case 'discord':
      return (
        <svg {...common}>
          <path d="M4 18V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 4Z" {...stroke} />
          <circle cx="9.5" cy="10.5" r="1.2" fill="currentColor" />
          <circle cx="14.5" cy="10.5" r="1.2" fill="currentColor" />
        </svg>
      )
    case 'webhook':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" {...stroke} />
          <path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.3 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.3-3.5-8.5S9.7 5.8 12 3.5Z" {...stroke} />
        </svg>
      )
    case 'facebook':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4" {...stroke} />
          <path d="M14.5 8h-1.2A1.8 1.8 0 0 0 11.5 9.8V21M9.5 13h5" {...stroke} />
        </svg>
      )
    case 'instagram':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" {...stroke} />
          <circle cx="12" cy="12" r="4" {...stroke} />
          <circle cx="16.8" cy="7.2" r="1.1" fill="currentColor" />
        </svg>
      )
    case 'x':
      return (
        <svg {...common}>
          <path d="m5 5 14 14M19 5 5 19" {...stroke} />
        </svg>
      )
    case 'linkedin':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="4" {...stroke} />
          <path d="M8 10.5V16M8 7.6v.1M12 16v-3.2a1.8 1.8 0 0 1 3.6 0V16" {...stroke} />
        </svg>
      )
    case 'threads':
      return (
        <svg {...common}>
          <path d="M12 20.5c-4.7 0-7.5-3.3-7.5-8.5S7.3 3.5 12 3.5c3.4 0 5.8 1.6 6.8 4" {...stroke} />
          <path d="M9 14.2c0-1.5 1.4-2.4 3.3-2.4 2.6 0 3.9 1.3 3.9 3.1 0 2-1.5 3.2-3.2 3.2-1.4 0-2.3-.7-2.3-1.7 0-1.1 1-1.8 2.6-1.8 2.6 0 4.2 1.5 4.2 3.9" {...stroke} />
        </svg>
      )
    case 'tiktok':
      return (
        <svg {...common}>
          <circle cx="9" cy="16.5" r="3.5" {...stroke} />
          <path d="M12.5 16.5V4c.8 2.4 2.5 3.8 5 4.2" {...stroke} />
        </svg>
      )
    case 'youtube':
      return (
        <svg {...common}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" {...stroke} />
          <path d="m10.5 9.5 4.5 2.5-4.5 2.5V9.5Z" fill="currentColor" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" {...stroke} />
        </svg>
      )
  }
}
