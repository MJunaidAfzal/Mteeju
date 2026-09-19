import { useEffect, useRef, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { ChevronDown, LayoutGrid, LogOut, Menu, Plug, X, type LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import BrandMark from '../components/BrandMark'
import ConnectionStatus from '../components/ConnectionStatus'
import Overview from './Overview'
import Apis from './Apis'
import './Dashboard.css'

type SectionId = 'dashboard' | 'apis'

interface NavItem {
  id: SectionId
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'apis', label: 'APIs', icon: Plug },
]

function displayName(user: User) {
  const fullName = (user.user_metadata?.full_name as string | undefined)?.trim()
  if (fullName) return fullName
  const local = (user.email ?? 'there').split('@')[0].replace(/[._-]+/g, ' ')
  return local.replace(/\b\w/g, (c) => c.toUpperCase())
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

export default function Dashboard({ session }: { session: Session }) {
  const [active, setActive] = useState<SectionId>('dashboard')
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const user = session.user
  const name = displayName(user)
  const email = user.email ?? ''
  const current = NAV_ITEMS.find((item) => item.id === active)!

  // Close the user menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])

  // Escape closes the mobile drawer and the user menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false)
        setMenuOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function go(id: SectionId) {
    setActive(id)
    setNavOpen(false)
    setMenuOpen(false)
    window.scrollTo({ top: 0 })
  }

  async function signOut() {
    setSigningOut(true)
    const { error } = await supabase.auth.signOut()
    if (error) setSigningOut(false)
  }

  return (
    <div className="dash">
      <aside className={`sidebar${navOpen ? ' is-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar__brand">
          <BrandMark tone="light" />
          <button type="button" className="icon-btn sidebar__close" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar__nav">
          <ul className="nav-list">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = item.id === active
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nav-item${isActive ? ' is-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => go(item.id)}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                    <span>{item.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__user">
            <span className="avatar">{initials(name)}</span>
            <div className="sidebar__user-meta">
              <p className="sidebar__user-name">{name}</p>
              <p className="sidebar__user-email">{email}</p>
            </div>
            <button type="button" className="icon-btn" onClick={signOut} disabled={signingOut} aria-label="Sign out" title="Sign out">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <div className={`backdrop${navOpen ? ' is-open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />

      <div className="dash-main">
        <header className="topbar">
          <button type="button" className="icon-btn icon-btn--outline topbar__menu" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu size={19} />
          </button>

          <div className="topbar__crumbs">
            <span>Teeju</span>
            <span aria-hidden="true">/</span>
            <strong>{current.label}</strong>
          </div>

          <div className="topbar__right">
            <div className="user-menu" ref={menuRef}>
              <button
                type="button"
                className="user-menu__trigger"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="avatar avatar--sm">{initials(name)}</span>
                <span className="user-menu__name">{name.split(' ')[0]}</span>
                <ChevronDown size={15} className="user-menu__chevron" />
              </button>

              {menuOpen && (
                <div className="user-menu__panel" role="menu">
                  <div className="user-menu__head">
                    <p className="user-menu__full">{name}</p>
                    <p className="user-menu__email">{email}</p>
                  </div>
                  <button type="button" role="menuitem" className="user-menu__danger" onClick={signOut} disabled={signingOut}>
                    <LogOut size={16} /> {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="dash-content">
          {active === 'apis' ? <Apis user={user} /> : <Overview name={name} />}
        </main>

        <footer className="dash-footer">
          <span>© {new Date().getFullYear()} Teeju</span>
          <ConnectionStatus />
        </footer>
      </div>
    </div>
  )
}
