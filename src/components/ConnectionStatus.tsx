import { useSupabaseStatus } from '../hooks/useSupabaseStatus'

const LABELS = {
  checking: 'Checking connection…',
  connected: 'Supabase connected',
  error: 'Supabase unreachable',
}

export default function ConnectionStatus() {
  const status = useSupabaseStatus()

  return (
    <span className={`conn conn--${status}`} role="status">
      <span className="conn__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  )
}
