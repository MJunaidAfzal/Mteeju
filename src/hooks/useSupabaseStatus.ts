import { useEffect, useState } from 'react'

export type SupabaseStatus = 'checking' | 'connected' | 'error'

// Pings the Auth health endpoint to confirm the URL and key actually work
export function useSupabaseStatus() {
  const [status, setStatus] = useState<SupabaseStatus>('checking')

  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    })
      .then((res) => {
        if (!cancelled) setStatus(res.ok ? 'connected' : 'error')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return status
}
