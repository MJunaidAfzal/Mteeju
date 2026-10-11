# Teeju

React + TypeScript + Vite portal on Supabase (auth, database, Edge Functions), deployed on Netlify
at https://teeju.netlify.app. Pages: Dashboard, APIs, Invoices, Social, Leads, Outreach.

## Keep the assistant in step with the portal

The in-portal assistant lives in [src/lib/agent.ts](src/lib/agent.ts). Its `SYSTEM_PROMPT` is the
only description it has of this portal, so **every feature change must update it in the same
commit**: a page added or removed, a new setting, a flow that works differently, something taken
out. A prompt that describes a feature that no longer exists is worse than no description at all.

When a change gives the owner something new to ask about, also:

- add or adjust a tool in `TOOL_DECLARATIONS` and its `case` in `prepareTool`, so the assistant can
  read the real state instead of guessing;
- add destructive or quota-spending tools to `CONFIRM_TOOLS` (and `DANGER_TOOLS` if they delete);
- refresh `TOOL_LABELS` and `SUGGESTIONS` in [src/components/Assistant.tsx](src/components/Assistant.tsx).

## Notes that are easy to get wrong

- Outreach is **WhatsApp only**. There is no email sending anywhere; the Gmail runner was removed.
- Messages wait for the owner's click (wa.me link) unless a campaign is switched to automatic, which
  uses Meta's Cloud API through the `whatsapp-send` Edge Function.
- Migrations in `supabase/migrations` are run by hand in the Supabase SQL editor, and the Outreach
  page offers its own migration with a Copy SQL button. Keep older migrations re-runnable.
- Env vars are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, in `.env.local` locally and
  in Netlify's environment variables for the live site. Vite bakes them in at build time, so Netlify
  needs a fresh deploy after they change.

## Checks

`npx tsc -b`, `npx oxlint`, `npm run build` — all three should be clean before committing.
