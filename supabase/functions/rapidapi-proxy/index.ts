// Supabase Edge Function: forwards requests from the Teeju portal to RapidAPI.
// The RapidAPI key lives only here, as the RAPIDAPI_KEY secret — it never reaches the browser.
//
// Deploy:
//   npx supabase login
//   npx supabase link --project-ref txvwtlccvehjbtwgweqt
//   npx supabase secrets set RAPIDAPI_KEY=your-rapidapi-key
//   npx supabase functions deploy rapidapi-proxy

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const RAPIDAPI_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.rapidapi\.com$/

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Only signed-in portal users may use the proxy
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return json({ error: 'You must be signed in to use the API proxy.' }, 401)

  const apiKey = Deno.env.get('RAPIDAPI_KEY')
  if (!apiKey) return json({ error: 'The RAPIDAPI_KEY secret is not set in Supabase.' }, 500)

  let payload: { host?: string; method?: string; path?: string; query?: [string, string][]; body?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }

  const host = String(payload.host ?? '').toLowerCase()
  const method = String(payload.method ?? 'GET').toUpperCase()
  const path = String(payload.path ?? '/')

  // Refuse anything that isn't a RapidAPI host, so this can't be used as an open proxy
  if (!RAPIDAPI_HOST.test(host)) return json({ error: 'Host must be a RapidAPI host (*.rapidapi.com).' }, 400)
  if (!METHODS.has(method)) return json({ error: `Unsupported method ${method}.` }, 400)

  const url = new URL(`https://${host}${path.startsWith('/') ? path : `/${path}`}`)
  if (url.hostname !== host) return json({ error: 'Invalid path.' }, 400)
  for (const [key, value] of payload.query ?? []) url.searchParams.append(String(key), String(value))

  const hasBody = method !== 'GET' && typeof payload.body === 'string' && payload.body.trim() !== ''

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': host,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? payload.body : undefined,
    })

    return json({
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get('content-type') ?? '',
      body: await res.text(),
      quota: {
        limit: res.headers.get('x-ratelimit-requests-limit') ?? res.headers.get('x-ratelimit-limit') ?? undefined,
        remaining: res.headers.get('x-ratelimit-requests-remaining') ?? res.headers.get('x-ratelimit-remaining') ?? undefined,
      },
    })
  } catch {
    return json({ error: `Could not reach ${host}.` }, 502)
  }
})
