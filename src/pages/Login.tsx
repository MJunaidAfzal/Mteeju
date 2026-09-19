import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import BrandMark from '../components/BrandMark'
import ConnectionStatus from '../components/ConnectionStatus'
import './Login.css'

type Mode = 'signin' | 'signup' | 'forgot' | 'update'

const COPY: Record<Mode, { title: string; subtitle: string; cta: string }> = {
  signin: {
    title: 'Welcome back',
    subtitle: 'Sign in to continue to your dashboard.',
    cta: 'Sign in',
  },
  signup: {
    title: 'Create your account',
    subtitle: 'It takes less than a minute to get started.',
    cta: 'Create account',
  },
  forgot: {
    title: 'Reset your password',
    subtitle: 'Enter your email and we’ll send you a secure reset link.',
    cta: 'Send reset link',
  },
  update: {
    title: 'Choose a new password',
    subtitle: 'Use at least 8 characters. Avoid one you’ve used before.',
    cta: 'Update password',
  },
}

interface LoginProps {
  initialMode?: Mode
  onPasswordUpdated?: () => void
}

export default function Login({ initialMode = 'signin', onPasswordUpdated }: LoginProps) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const copy = COPY[mode]
  const needsEmail = mode !== 'update'
  const needsPassword = mode !== 'forgot'

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
    setPassword('')
    setShowPassword(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: window.location.origin,
          },
        })
        if (error) throw error
        // No session means email confirmation is switched on in Supabase
        if (!data.session) {
          setMode('signin')
          setPassword('')
          setNotice(`We’ve sent a confirmation link to ${email}. Open it to activate your account, then sign in.`)
        }
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setNotice(`If an account exists for ${email}, a reset link is on its way.`)
      } else {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        onPasswordUpdated?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth">
      <aside className="auth-brand">
        <BrandMark tone="light" />

        <div className="auth-brand__body">
          <p className="eyebrow auth-brand__eyebrow">Members area</p>
          <h1 className="auth-brand__title">
            Everything you run,
            <br />
            <em>in one quiet place.</em>
          </h1>
          <p className="auth-brand__lede">
            Orders, customers and numbers — organised, calm and always up to date.
          </p>
        </div>

        <ul className="auth-brand__tags">
          <li>Private by design</li>
          <li>Always in sync</li>
          <li>Made with care</li>
        </ul>

        <svg className="auth-brand__art" viewBox="0 0 600 600" aria-hidden="true">
          {[120, 180, 240, 300].map((r) => (
            <circle key={r} cx="400" cy="400" r={r} fill="none" stroke="#e8dcc8" strokeOpacity="0.09" />
          ))}
          <circle cx="400" cy="400" r="92" fill="#6b1e2d" />
          <circle cx="400" cy="400" r="92" fill="none" stroke="#e8dcc8" strokeOpacity="0.25" />
          <line x1="100" y1="400" x2="600" y2="400" stroke="#e8dcc8" strokeOpacity="0.09" />
          <line x1="400" y1="100" x2="400" y2="600" stroke="#e8dcc8" strokeOpacity="0.09" />
        </svg>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <header className="auth-card__head">
            <h2>{copy.title}</h2>
            <p>{copy.subtitle}</p>
          </header>

          <form className="auth-form" onSubmit={handleSubmit}>
            {notice && (
              <div className="alert alert--success" role="status">
                {notice}
              </div>
            )}
            {error && (
              <div className="alert alert--error" role="alert">
                {error}
              </div>
            )}

            {mode === 'signup' && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input
                  id="name"
                  className="input"
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            {needsEmail && (
              <div className="field">
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            )}

            {needsPassword && (
              <div className="field">
                <div className="field__row">
                  <label htmlFor="password">{mode === 'update' ? 'New password' : 'Password'}</label>
                  {mode === 'signin' && (
                    <button type="button" className="link link--quiet" onClick={() => switchMode('forgot')}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="input-wrap">
                  <input
                    id="password"
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    placeholder={mode === 'signin' ? 'Enter your password' : 'At least 8 characters'}
                    minLength={mode === 'signin' ? undefined : 8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="input-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
              {loading ? (
                <Loader2 size={18} className="spin" aria-label="Please wait" />
              ) : (
                <>
                  {copy.cta}
                  <ArrowRight size={17} className="btn__arrow" />
                </>
              )}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'signin' && (
              <>
                New to Teeju?{' '}
                <button type="button" className="link" onClick={() => switchMode('signup')}>
                  Create an account
                </button>
              </>
            )}
            {mode === 'signup' && (
              <>
                Already have an account?{' '}
                <button type="button" className="link" onClick={() => switchMode('signin')}>
                  Sign in
                </button>
              </>
            )}
            {mode === 'forgot' && (
              <>
                Remembered it?{' '}
                <button type="button" className="link" onClick={() => switchMode('signin')}>
                  Back to sign in
                </button>
              </>
            )}
          </p>
        </div>

        <footer className="auth-footer">
          <span>© {new Date().getFullYear()} Teeju</span>
          <span className="auth-footer__sep" aria-hidden="true" />
          <ConnectionStatus />
        </footer>
      </main>
    </div>
  )
}
