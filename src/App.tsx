import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Loader2 } from 'lucide-react'
import { supabase } from './lib/supabase'
import BrandMark from './components/BrandMark'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import './App.css'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      // User arrived from a "reset password" email link
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (!ready) {
    return (
      <div className="splash">
        <BrandMark />
        <Loader2 size={20} className="spin" aria-label="Loading" />
      </div>
    )
  }

  if (recovering) {
    return <Login initialMode="update" onPasswordUpdated={() => setRecovering(false)} />
  }

  return session ? <Dashboard session={session} /> : <Login />
}

export default App
