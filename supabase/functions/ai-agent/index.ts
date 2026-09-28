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
// Newest capable Flash model first; the list is only a preference — what the key can use wins
const PREFERRED = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']

let cachedModel: string | null = null

async function availableModels(key: string): Promise<string[]> {
  const res = await fetch(`${API}/models?key=${key}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m: { name: string }) => m.name.replace(/^models\//, ''))
}

async function pickModel(key: string): Promise<string> {
  const forced = Deno.env.get('GEMINI_MODEL')
  if (forced) return forced
  if (cachedModel) return cachedModel
  const names = await availableModels(key)
  const flash = names.filter((n) => n.includes('flash') && !n.includes('preview') && !n.includes('exp'))
  cachedModel =
    PREFERRED.find((p) => names.includes(p)) ??
    flash.find((n) => !n.includes('lite')) ??
    flash[0] ??
    names[0] ??
    PREFERRED[0]
  return cachedModel
}

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

  async function ask(model: string) {
    const res = await fetch(`${API}/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    return { res, data: await res.json().catch(() => ({})) }
  }

  try {
    let model = await pickModel(key)
    let { res, data } = await ask(model)

    // The pinned/cached model may have been retired — pick another one and retry once
    if (res.status === 404) {
      cachedModel = null
      const names = await availableModels(key)
      const next = PREFERRED.find((p) => names.includes(p)) ?? names.find((n) => n.includes('flash'))
      if (next && next !== model) {
        cachedModel = next
        model = next
        ;({ res, data } = await ask(model))
      }
    }

    if (!res.ok) {
      const message = data?.error?.message ?? `Gemini returned ${res.status}.`
      return json({ error: message, status: res.status }, res.status === 429 ? 429 : 502)
    }

    const candidate = data.candidates?.[0]
    if (!candidate) {
      const blocked = data.promptFeedback?.blockReason
      return json({ error: blocked ? `The request was blocked (${blocked}).` : 'The model returned nothing.' }, 502)
    }

    return json({ model, content: candidate.content ?? { role: 'model', parts: [] }, finishReason: candidate.finishReason })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Could not reach Gemini.' }, 502)
  }
})
