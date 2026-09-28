// Supabase Edge Function: the Teeju assistant's brain.
// Talks to the Gemini API with the GEMINI_API_KEY secret — the key never reaches the browser.
//
// Deploy (Dashboard → Edge Functions → Deploy a new function → Via Editor), or with the CLI:
//   npx supabase functions deploy ai-agent
// Secret needed: GEMINI_API_KEY   (optional: GEMINI_MODEL to pin one model)

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const API = 'https://generativelanguage.googleapis.com/v1beta'
// Newest capable Flash model first; a busy one falls through to the next
const PREFERRED = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']
const RETRIES_PER_MODEL = 3
const BUSY_STATUS = new Set([429, 500, 502, 503, 504])

let cachedModels: string[] | null = null

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function availableModels(key: string): Promise<string[]> {
  const res = await fetch(`${API}/models?key=${key}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m: { name: string }) => m.name.replace(/^models\//, ''))
}

/** The models to try, best first. A pinned GEMINI_MODEL goes first, then the rest as backups. */
async function modelChain(key: string): Promise<string[]> {
  const pinned = Deno.env.get('GEMINI_MODEL')
  if (!cachedModels) {
    const names = await availableModels(key)
    const flash = names.filter((n) => n.includes('flash') && !n.includes('preview') && !n.includes('exp'))
    const ordered = [...PREFERRED.filter((p) => names.includes(p)), ...flash.filter((f) => !PREFERRED.includes(f))]
    cachedModels = ordered.length > 0 ? ordered : PREFERRED
  }
  const chain = pinned ? [pinned, ...cachedModels.filter((m) => m !== pinned)] : [...cachedModels]
  return chain.slice(0, 4)
}

/** Daily free-tier limits read differently from a temporary spike, so they get their own message. */
const isQuotaExhausted = (message: string) => /quota|exceeded your current quota|per day/i.test(message)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Only signed-in portal users may use the assistant
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return json({ error: 'You must be signed in to use the assistant.' }, 401)

  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) return json({ error: 'The GEMINI_API_KEY secret is not set in Supabase.' }, 500)

  let payload: { contents?: unknown[]; tools?: unknown[]; systemInstruction?: unknown }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }
  if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
    return json({ error: 'Nothing to send to the model.' }, 400)
  }

  const body = JSON.stringify({
    contents: payload.contents,
    tools: payload.tools,
    systemInstruction: payload.systemInstruction,
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  })

  let lastError = 'The assistant could not reach the model.'
  let quotaHit = false

  try {
    const chain = await modelChain(key)

    for (const model of chain) {
      for (let attempt = 0; attempt < RETRIES_PER_MODEL; attempt++) {
        let res: Response
        let data: Record<string, unknown> & { error?: { message?: string }; candidates?: unknown[]; promptFeedback?: { blockReason?: string } }
        try {
          res = await fetch(`${API}/models/${model}:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          })
          data = await res.json().catch(() => ({}))
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'Network error while reaching Gemini.'
          await sleep(500 * (attempt + 1))
          continue
        }

        if (res.ok) {
          const candidate = (data.candidates as { content?: unknown; finishReason?: string }[] | undefined)?.[0]
          if (candidate) {
            cachedModels = [model, ...(cachedModels ?? []).filter((m) => m !== model)]
            return json({ model, content: candidate.content ?? { role: 'model', parts: [] }, finishReason: candidate.finishReason })
          }
          const blocked = data.promptFeedback?.blockReason
          lastError = blocked ? `The request was blocked (${blocked}).` : 'The model returned an empty answer.'
          break // a blocked prompt will be blocked on the next model too
        }

        lastError = data.error?.message ?? `Gemini returned ${res.status}.`

        // Model gone: drop it from the cache and move to the next one
        if (res.status === 404) {
          cachedModels = (cachedModels ?? []).filter((m) => m !== model)
          break
        }
        // Daily free-tier limit: every model shares the same quota, so stop here
        if (res.status === 429 && isQuotaExhausted(lastError)) {
          quotaHit = true
          break
        }
        // Busy right now: wait a moment and try again, then fall through to the next model
        if (BUSY_STATUS.has(res.status)) {
          if (attempt < RETRIES_PER_MODEL - 1) await sleep(700 * (attempt + 1))
          continue
        }
        break // 400-type errors won't be fixed by retrying
      }
      if (quotaHit) break
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : lastError
  }

  if (quotaHit) {
    return json({ error: 'Today’s free Gemini limit is used up. It resets after midnight (US Pacific) — please try again later.' }, 429)
  }
  if (/high demand|overload|unavailable|503|try again/i.test(lastError)) {
    return json({ error: 'The AI model is busy right now. I tried the backup models too — please send that again in a minute.' }, 503)
  }
  return json({ error: lastError }, 502)
})
