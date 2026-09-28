import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowUp, Check, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import InvoiceDocument from './InvoiceDocument'
import { downloadHtml, downloadPdf, downloadPng } from '../lib/invoiceExport'
import type { Invoice } from '../lib/invoices'
import {
  CONFIRM_TOOLS,
  askModel,
  prepareTool,
  type AgentContext,
  type GeminiContent,
  type GeminiPart,
  type PageId,
  type PreparedTool,
} from '../lib/agent'
import './Assistant.css'

const TOOL_LABELS: Record<string, string> = {
  portal_overview: 'Checking your portal',
  list_invoices: 'Looking through invoices',
  create_invoice: 'Preparing an invoice',
  update_invoice: 'Updating the invoice',
  delete_invoice: 'Deleting the invoice',
  download_invoice: 'Preparing the download',
  find_leads: 'Searching for leads',
  list_apis: 'Checking saved APIs',
  call_api_endpoint: 'Calling the API',
  open_page: 'Opening the page',
}

const SUGGESTIONS = [
  'Make an invoice for Northwind: logo design 1800, website 10 × 320, 5% tax',
  'How many invoices are unpaid?',
  'Find 20 dentists in Karachi with a phone number',
  'Download INV-0001 as PDF',
]

type ChatItem =
  | { id: string; kind: 'text'; role: 'user' | 'assistant'; text: string }
  | { id: string; kind: 'tool'; label: string; state: 'running' | 'done' | 'error' }
  | { id: string; kind: 'confirm'; title: string; lines: string[]; danger: boolean; state: 'pending' | 'confirmed' | 'cancelled' }
  | { id: string; kind: 'error'; text: string }

/** Omit that keeps each member of the union separate */
type NewChatItem = ChatItem extends infer T ? (T extends { id: string } ? Omit<T, 'id'> : never) : never

interface Pending {
  itemId: string
  call: { name: string; id?: string; args?: Record<string, unknown> }
  prepared: PreparedTool
}

const newId = () => crypto.randomUUID()

export default function Assistant({ userName, onNavigate }: { userName: string; onNavigate: (page: PageId) => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ChatItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [exportInvoice, setExportInvoice] = useState<Invoice | null>(null)

  const contentsRef = useRef<GeminiContent[]>([])
  const exportRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const push = useCallback((item: NewChatItem) => {
    const id = newId()
    setItems((list) => [...list, { ...item, id } as ChatItem])
    return id
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items, busy, pending])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    window.setTimeout(() => inputRef.current?.focus(), 120)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  /** Renders the invoice off-screen for a moment so it can be turned into a file. */
  const download = useCallback(
    (invoice: Invoice, format: 'pdf' | 'png' | 'html') =>
      new Promise<void>((resolve, reject) => {
        setExportInvoice(invoice)
        window.setTimeout(async () => {
          const node = exportRef.current
          try {
            if (!node) throw new Error('The invoice could not be rendered.')
            if (format === 'png') await downloadPng(node, invoice)
            else if (format === 'html') downloadHtml(node, invoice)
            else await downloadPdf(node, invoice)
            resolve()
          } catch (err) {
            reject(err instanceof Error ? err : new Error('The download failed.'))
          } finally {
            setExportInvoice(null)
          }
        }, 300)
      }),
    [],
  )

  const ctx: AgentContext = { navigate: onNavigate, download, userName }

  const runLoop = useCallback(
    async () => {
      setBusy(true)
      try {
        for (let step = 0; step < 8; step++) {
          const reply = await askModel(contentsRef.current)
          const parts = reply.parts ?? []
          contentsRef.current.push({ role: 'model', parts })

          const text = parts
            .map((p) => p.text ?? '')
            .join('\n')
            .trim()
          if (text) push({ kind: 'text', role: 'assistant', text })

          const calls = parts.map((p) => p.functionCall).filter(Boolean) as NonNullable<GeminiPart['functionCall']>[]
          if (calls.length === 0) return

          const responses: GeminiPart[] = []
          for (const call of calls) {
            const prepared = await prepareTool(call.name, call.args, ctx)

            // Anything that writes data or spends quota waits for a yes
            if (CONFIRM_TOOLS.has(call.name) && prepared.title) {
              if (responses.length) contentsRef.current.push({ role: 'user', parts: responses })
              const itemId = push({ kind: 'confirm', title: prepared.title, lines: prepared.lines, danger: prepared.danger, state: 'pending' })
              setPending({ itemId, call, prepared })
              return
            }

            const chipId = push({ kind: 'tool', label: TOOL_LABELS[call.name] ?? call.name, state: 'running' })
            let result: Record<string, unknown>
            try {
              result = await prepared.run()
            } catch (err) {
              result = { error: err instanceof Error ? err.message : 'The action failed.' }
            }
            setItems((list) => list.map((i) => (i.id === chipId && i.kind === 'tool' ? { ...i, state: result.error ? 'error' : 'done' } : i)))
            responses.push({ functionResponse: { name: call.name, id: call.id, response: result } })
          }
          contentsRef.current.push({ role: 'user', parts: responses })
        }
      } catch (err) {
        push({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' })
      } finally {
        setBusy(false)
      }
    },
    // ctx is rebuilt each render but only holds stable callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [push],
  )

  function send() {
    const text = input.trim()
    if (!text || busy || pending) return
    setInput('')
    push({ kind: 'text', role: 'user', text })
    contentsRef.current.push({ role: 'user', parts: [{ text }] })
    void runLoop()
  }

  async function resolvePending(confirmed: boolean) {
    if (!pending) return
    const { call, prepared, itemId } = pending
    setPending(null)
    setItems((list) => list.map((i) => (i.id === itemId && i.kind === 'confirm' ? { ...i, state: confirmed ? 'confirmed' : 'cancelled' } : i)))

    let result: Record<string, unknown>
    if (confirmed) {
      setBusy(true)
      const chipId = push({ kind: 'tool', label: TOOL_LABELS[call.name] ?? call.name, state: 'running' })
      try {
        result = await prepared.run()
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'The action failed.' }
      }
      setItems((list) => list.map((i) => (i.id === chipId && i.kind === 'tool' ? { ...i, state: result.error ? 'error' : 'done' } : i)))
    } else {
      result = { cancelled: true, reason: 'The user declined this action.' }
    }

    contentsRef.current.push({ role: 'user', parts: [{ functionResponse: { name: call.name, id: call.id, response: result } }] })
    void runLoop()
  }

  function reset() {
    contentsRef.current = []
    setItems([])
    setPending(null)
  }

  const empty = items.length === 0

  return (
    <>
      <button
        type="button"
        className={`assist-fab${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close the assistant' : 'Open the assistant'}
        aria-expanded={open}
      >
        {open ? <X size={22} /> : <Sparkles size={22} />}
      </button>

      <section className={`assist${open ? ' is-open' : ''}`} role="dialog" aria-label="Teeju assistant" aria-hidden={!open}>
        <header className="assist__head">
          <span className="assist__mark">
            <Sparkles size={17} />
          </span>
          <div className="assist__title">
            <p>Teeju assistant</p>
            <span>Ask for anything in the portal</span>
          </div>
          {items.length > 0 && (
            <button type="button" className="assist__icon" onClick={reset} title="Start a new chat" aria-label="Start a new chat">
              <Trash2 size={16} />
            </button>
          )}
          <button type="button" className="assist__icon" onClick={() => setOpen(false)} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="assist__body" ref={scrollRef}>
          {empty && (
            <div className="assist__welcome">
              <p className="assist__hi">Hello {userName.split(' ')[0]} 👋</p>
              <p>I can make invoices, find leads, run your saved APIs and move around the portal. Try one of these:</p>
              <div className="assist__chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.map((item) => {
            if (item.kind === 'text') {
              return (
                <div key={item.id} className={`assist-msg assist-msg--${item.role}`}>
                  {item.text}
                </div>
              )
            }
            if (item.kind === 'tool') {
              return (
                <div key={item.id} className={`assist-tool assist-tool--${item.state}`}>
                  {item.state === 'running' ? <Loader2 size={13} className="spin" /> : item.state === 'done' ? <Check size={13} /> : <AlertTriangle size={13} />}
                  {item.label}
                </div>
              )
            }
            if (item.kind === 'error') {
              return (
                <div key={item.id} className="assist-error">
                  <AlertTriangle size={14} /> {item.text}
                </div>
              )
            }
            return (
              <div key={item.id} className={`assist-confirm${item.danger ? ' is-danger' : ''} is-${item.state}`}>
                <p className="assist-confirm__title">{item.title}</p>
                <ul>
                  {item.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                {item.state === 'pending' ? (
                  <div className="assist-confirm__actions">
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => void resolvePending(true)}>
                      <Check size={14} /> {item.danger ? 'Yes, delete' : 'Confirm'}
                    </button>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void resolvePending(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="assist-confirm__state">{item.state === 'confirmed' ? 'Confirmed' : 'Cancelled'}</p>
                )}
              </div>
            )
          })}

          {busy && (
            <div className="assist-typing" aria-label="Thinking">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        <form
          className="assist__composer"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            placeholder={pending ? 'Confirm or cancel above…' : 'Ask me to do something…'}
            value={input}
            disabled={Boolean(pending)}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button type="submit" className="assist__send" disabled={!input.trim() || busy || Boolean(pending)} aria-label="Send">
            {busy ? <Loader2 size={17} className="spin" /> : <ArrowUp size={17} />}
          </button>
        </form>
      </section>

      {exportInvoice &&
        createPortal(
          <div className="inv-export">
            <InvoiceDocument ref={exportRef} invoice={exportInvoice} />
          </div>,
          document.body,
        )}
    </>
  )
}
