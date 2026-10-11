import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Database,
  Loader2,
  Megaphone,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  SkipForward,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { SetupRequiredError } from '../lib/apiStore'
import { fetchLeads, type Lead } from '../lib/leadStore'
import {
  cancelPending,
  compose,
  countsFor,
  defaultSteps,
  deleteCampaign,
  fetchCampaigns,
  fetchDue,
  fetchQueue,
  fetchSteps,
  finishIfDone,
  inSendingWindow,
  markQueueItem,
  newCampaign,
  queueLeads,
  reachable,
  saveCampaign,
  setCampaignStatus,
  type Campaign,
  type CampaignCounts,
  type QueueItem,
  type Step,
} from '../lib/outreach'
import setupSql from '../../supabase/migrations/20261012000000_outreach.sql?raw'
import './Outreach.css'

const TOKENS = ['{{name}}', '{{category}}', '{{city}}', '{{rating}}', '{{reviews}}']

const STATUS_LABEL: Record<Campaign['status'], string> = {
  draft: 'Draft',
  running: 'Running',
  paused: 'Paused',
  done: 'Finished',
}

const hour = (h: number) => `${String(h % 12 === 0 ? 12 : h % 12)}${h < 12 ? 'am' : 'pm'}`

function SetupCard({ onRetry, checking }: { onRetry: () => void; checking: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(setupSql)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard can be blocked; the file path below still works
    }
  }
  return (
    <section className="card api-setup">
      <span className="api-setup__icon">
        <Database size={22} />
      </span>
      <div className="api-setup__body">
        <h2 className="card__title">Set up the campaign tables</h2>
        <p className="card__sub">Campaigns, their steps and the message queue live in your own Supabase database.</p>
        <ol>
          <li>
            Click <strong>Copy SQL</strong> below.
          </li>
          <li>
            In Supabase open <strong>SQL Editor</strong> → <strong>New query</strong>, paste it and press <strong>Run</strong>.
          </li>
          <li>
            Come back and click <strong>Check again</strong>.
          </li>
        </ol>
        <div className="api-setup__actions">
          <button type="button" className="btn btn--primary" onClick={() => void copy()}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy SQL'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onRetry} disabled={checking}>
            {checking ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Check again
          </button>
        </div>
        <p className="api-hint">
          The same script is in <code>supabase/migrations/20261012000000_outreach.sql</code>.
        </p>
      </div>
    </section>
  )
}

export default function Outreach() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [counts, setCounts] = useState<Record<string, CampaignCounts>>({})
  const [leads, setLeads] = useState<Lead[]>([])
  const [due, setDue] = useState<QueueItem[]>([])
  const [opened, setOpened] = useState<Set<string>>(new Set())

  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState('')

  const [editing, setEditing] = useState<{ campaign: Campaign; steps: Step[] } | null>(null)
  const [openId, setOpenId] = useState('')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const editorRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, allLeads] = await Promise.all([fetchCampaigns(), fetchLeads()])
      setCampaigns(list)
      setLeads(allLeads)
      setDue(await fetchDue(list))
      setCounts(await countsFor(list.map((c) => c.id)))
      setSetupRequired(false)
    } catch (err) {
      if (err instanceof SetupRequiredError) setSetupRequired(true)
      else setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not load your campaigns.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const leadById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads])
  const campaignById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns])
  const sources = useMemo(() => [...new Set(leads.map((l) => l.source).filter(Boolean))], [leads])

  const totals = useMemo(() => {
    const all = Object.values(counts)
    return {
      running: campaigns.filter((c) => c.status === 'running').length,
      sent: all.reduce((sum, c) => sum + c.sent, 0),
      pending: all.reduce((sum, c) => sum + c.pending, 0),
      due: due.length,
    }
  }, [campaigns, counts, due])

  /** The leads this draft would actually reach. */
  const audience = useMemo(() => {
    if (!editing) return [] as Lead[]
    const pool = editing.campaign.source ? leads.filter((l) => l.source === editing.campaign.source) : leads
    return reachable(pool)
  }, [editing, leads])

  /** Running campaigns that have messages waiting but are outside their hours. */
  const resting = useMemo(
    () => campaigns.filter((c) => c.status === 'running' && !inSendingWindow(c) && (counts[c.id]?.pending ?? 0) > 0),
    [campaigns, counts],
  )

  /* ---------- Editing ---------- */

  function startNew() {
    const campaign = newCampaign()
    campaign.name = `Campaign ${campaigns.length + 1}`
    setEditing({ campaign, steps: defaultSteps(campaign.id) })
    setOpenId('')
    window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  async function edit(campaign: Campaign) {
    try {
      setEditing({ campaign, steps: await fetchSteps(campaign.id) })
      setOpenId('')
      window.setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not open that campaign.' })
    }
  }

  const patch = (changes: Partial<Campaign>) => setEditing((e) => (e ? { ...e, campaign: { ...e.campaign, ...changes } } : e))

  const patchStep = (id: string, changes: Partial<Step>) =>
    setEditing((e) => (e ? { ...e, steps: e.steps.map((s) => (s.id === id ? { ...s, ...changes } : s)) } : e))

  function addStep() {
    setEditing((e) => {
      if (!e) return e
      const last = e.steps[e.steps.length - 1]
      const step: Step = {
        id: crypto.randomUUID(),
        campaignId: e.campaign.id,
        day: Math.min((last?.day ?? 0) + 2, 90),
        body: '',
      }
      return { ...e, steps: [...e.steps, step] }
    })
  }

  async function save(andStart: boolean) {
    if (!editing) return
    const { campaign, steps } = editing
    if (!campaign.name.trim()) {
      setNote({ kind: 'error', text: 'Give the campaign a name first.' })
      return
    }
    if (steps.length === 0) {
      setNote({ kind: 'error', text: 'Add at least one message.' })
      return
    }
    if (steps.some((s) => !s.body.trim())) {
      setNote({ kind: 'error', text: 'One of the messages is empty.' })
      return
    }
    if (andStart && audience.length === 0) {
      setNote({ kind: 'error', text: 'None of these leads has a phone number — enrich them first.' })
      return
    }
    setBusy('save')
    try {
      await saveCampaign(campaign, steps)
      let queued = 0
      if (andStart) {
        queued = await queueLeads(campaign, steps, audience)
        await setCampaignStatus(campaign.id, 'running')
      }
      await load()
      setEditing(null)
      setNote({
        kind: 'ok',
        text: andStart ? `Campaign started — ${queued} message${queued === 1 ? '' : 's'} queued for ${audience.length} leads.` : 'Campaign saved as a draft.',
      })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save the campaign.' })
    } finally {
      setBusy('')
    }
  }

  /* ---------- Running ---------- */

  async function resume(campaign: Campaign) {
    setBusy(campaign.id)
    try {
      // A draft or a finished campaign may have new leads waiting since last time.
      const steps = await fetchSteps(campaign.id)
      const pool = campaign.source ? leads.filter((l) => l.source === campaign.source) : leads
      const added = await queueLeads(campaign, steps, reachable(pool))
      await setCampaignStatus(campaign.id, 'running')
      await load()
      setNote({ kind: 'ok', text: added > 0 ? `Running — ${added} new message${added === 1 ? '' : 's'} queued.` : 'Campaign is running.' })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not start that campaign.' })
    } finally {
      setBusy('')
    }
  }

  async function pause(campaign: Campaign) {
    try {
      await setCampaignStatus(campaign.id, 'paused')
      await load()
      setNote({ kind: 'ok', text: 'Paused. Nothing more will come up for sending until you start it again.' })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not pause that campaign.' })
    }
  }

  async function stop(campaign: Campaign) {
    const waiting = counts[campaign.id]?.pending ?? 0
    if (!window.confirm(`Stop "${campaign.name}" for good? ${waiting} message${waiting === 1 ? '' : 's'} still waiting will be cancelled.`)) return
    try {
      await cancelPending(campaign.id)
      await setCampaignStatus(campaign.id, 'done')
      await load()
      setNote({ kind: 'ok', text: 'Campaign stopped and the waiting messages were cancelled.' })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not stop that campaign.' })
    }
  }

  async function remove(campaign: Campaign) {
    if (!window.confirm(`Delete "${campaign.name}" and its message history? This cannot be undone.`)) return
    try {
      await deleteCampaign(campaign.id)
      await load()
      setNote({ kind: 'ok', text: 'Campaign deleted.' })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not delete that campaign.' })
    }
  }

  async function openDetail(campaign: Campaign) {
    if (openId === campaign.id) {
      setOpenId('')
      return
    }
    setOpenId(campaign.id)
    try {
      setQueue(await fetchQueue(campaign.id))
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not load those messages.' })
    }
  }

  /* ---------- WhatsApp one-click ---------- */

  const textFor = (item: QueueItem) => compose(item.body, leadById.get(item.leadId), campaignById.get(item.campaignId)?.signature ?? '')

  function openWhatsapp(item: QueueItem) {
    window.open(`https://wa.me/${item.recipient}?text=${encodeURIComponent(textFor(item))}`, '_blank', 'noopener')
    setOpened((set) => new Set(set).add(item.id))
  }

  async function markSent(item: QueueItem, status: 'sent' | 'skipped') {
    try {
      await markQueueItem(item.id, status)
      setDue((list) => list.filter((q) => q.id !== item.id))
      setCounts((all) => {
        const tally = all[item.campaignId]
        if (!tally) return all
        return {
          ...all,
          [item.campaignId]: {
            ...tally,
            pending: Math.max(0, tally.pending - 1),
            sent: status === 'sent' ? tally.sent + 1 : tally.sent,
            skipped: status === 'skipped' ? tally.skipped + 1 : tally.skipped,
          },
        }
      })
      // The campaign may have just run out of messages.
      if (await finishIfDone(item.campaignId)) {
        setCampaigns((list) => list.map((c) => (c.id === item.campaignId ? { ...c, status: 'done' } : c)))
      }
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'Could not update that message.' })
    }
  }

  if (setupRequired) {
    return (
      <>
        <div className="page-head">
          <div>
            <p className="eyebrow">Outreach</p>
            <h1>
              <em>Campaigns</em>
            </h1>
          </div>
        </div>
        <SetupCard onRetry={() => void load()} checking={loading} />
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Outreach</p>
          <h1>
            <em>Campaigns</em>
          </h1>
          <p className="page-head__sub">Every message waits here for one click, and goes out from your own WhatsApp.</p>
        </div>
        <div className="inv-actions">
          <button type="button" className="btn btn--secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Refresh
          </button>
          <button type="button" className="btn btn--primary" onClick={startNew}>
            <Plus size={16} /> New campaign
          </button>
        </div>
      </div>

      {note && (
        <div className={`alert ${note.kind === 'ok' ? 'alert--success' : 'alert--error'} api-banner`} role="status">
          {note.kind === 'ok' ? <Check size={16} /> : <AlertCircle size={16} />}
          <span>{note.text}</span>
          <button type="button" className="api-icon-btn" onClick={() => setNote(null)} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <section className="soc-stats">
        {[
          { label: 'Running', value: totals.running, icon: Megaphone },
          { label: 'Sent', value: totals.sent, icon: Check },
          { label: 'Waiting', value: totals.pending, icon: Clock },
          { label: 'Ready now', value: totals.due, icon: Send },
        ].map((tile) => (
          <article key={tile.label} className="card soc-tile">
            <span className="soc-tile__icon">
              <tile.icon size={16} />
            </span>
            <div>
              <p className="soc-tile__value">{tile.value}</p>
              <p className="soc-tile__label">{tile.label}</p>
            </div>
          </article>
        ))}
      </section>

      {due.length > 0 && (
        <section className="card out-wa">
          <header className="card__head">
            <div>
              <h2 className="card__title">WhatsApp — {due.length} ready to send</h2>
              <p className="card__sub">
                Open the chat, press send in WhatsApp, then mark it here. Nothing is sent without you — stay logged in at web.whatsapp.com on this computer.
              </p>
            </div>
          </header>
          <ul className="out-wa__list">
            {due.slice(0, 25).map((item) => {
              const lead = leadById.get(item.leadId)
              return (
                <li key={item.id} className="out-wa__item">
                  <div className="out-wa__who">
                    <strong>{lead?.name || 'Lead'}</strong>
                    <span className="lead-sub">
                      <MessageCircle size={12} /> +{item.recipient}
                    </span>
                  </div>
                  <p className="out-wa__text">{textFor(item)}</p>
                  <div className="out-wa__actions">
                    <button type="button" className={`btn btn--sm ${opened.has(item.id) ? 'btn--secondary' : 'btn--primary'}`} onClick={() => openWhatsapp(item)}>
                      <Send size={14} /> Open WhatsApp
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm ${opened.has(item.id) ? 'btn--primary' : 'btn--secondary'}`}
                      onClick={() => void markSent(item, 'sent')}
                    >
                      <Check size={14} /> Mark sent
                    </button>
                    <button type="button" className="api-icon-btn" title="Skip this one" onClick={() => void markSent(item, 'skipped')}>
                      <SkipForward size={15} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {due.length > 25 && <p className="api-hint out-more">Showing the first 25 — the rest stay queued.</p>}
        </section>
      )}

      {due.length === 0 && resting.length > 0 && (
        <div className="alert api-banner" role="status">
          <Clock size={16} />
          <span>
            Nothing to send right now — {resting.length === 1 ? `"${resting[0].name}" is` : `${resting.length} campaigns are`} outside their sending hours or
            already at today's limit.
          </span>
        </div>
      )}

      {editing && (
        <section className="card out-editor" ref={editorRef}>
          <header className="card__head">
            <div>
              <h2 className="card__title">{campaigns.some((c) => c.id === editing.campaign.id) ? 'Edit campaign' : 'New campaign'}</h2>
              <p className="card__sub">
                {audience.length} lead{audience.length === 1 ? '' : 's'} have a WhatsApp number and can be reached
              </p>
            </div>
            <button type="button" className="api-icon-btn" onClick={() => setEditing(null)} aria-label="Close editor">
              <X size={16} />
            </button>
          </header>

          <div className="out-grid">
            <label className="out-field">
              <span>Campaign name</span>
              <input className="api-input" value={editing.campaign.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Abu Dhabi cafés" />
            </label>
            <label className="out-field">
              <span>Which leads</span>
              <select className="api-input" value={editing.campaign.source} onChange={(e) => patch({ source: e.target.value })}>
                <option value="">Every lead I have</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="out-field">
              <span>Messages per day</span>
              <input
                className="api-input"
                type="number"
                min={1}
                max={500}
                value={editing.campaign.dailyCap}
                onChange={(e) => patch({ dailyCap: Math.max(1, Number(e.target.value) || 1) })}
              />
            </label>
            <label className="out-field">
              <span>Send between</span>
              <div className="out-hours">
                <select className="api-input" value={editing.campaign.sendFrom} onChange={(e) => patch({ sendFrom: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hour(h)}
                    </option>
                  ))}
                </select>
                <span>and</span>
                <select className="api-input" value={editing.campaign.sendTo} onChange={(e) => patch({ sendTo: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                    <option key={h} value={h}>
                      {hour(h)}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className="out-field">
              <span>Time zone</span>
              <input className="api-input" value={editing.campaign.timezone} onChange={(e) => patch({ timezone: e.target.value })} />
            </label>
          </div>

          <label className="out-field out-field--wide">
            <span>Sign-off added to every message</span>
            <textarea
              className="api-input"
              rows={2}
              value={editing.campaign.signature}
              onChange={(e) => patch({ signature: e.target.value })}
              placeholder={'Your name\nTeeju · +971 ...'}
            />
          </label>

          <div className="out-steps">
            {editing.steps.map((step, i) => (
              <article key={step.id} className="out-step">
                <header className="out-step__head">
                  <span className="out-step__badge">{i + 1}</span>
                  <label className="out-step__day">
                    Day
                    <input
                      className="api-input"
                      type="number"
                      min={1}
                      max={90}
                      value={step.day}
                      onChange={(e) => patchStep(step.id, { day: Math.min(90, Math.max(1, Number(e.target.value) || 1)) })}
                    />
                  </label>
                  <span className="out-step__channel">
                    <MessageCircle size={13} /> WhatsApp
                  </span>
                  <button
                    type="button"
                    className="api-icon-btn"
                    title="Remove this message"
                    onClick={() => setEditing((e) => (e ? { ...e, steps: e.steps.filter((s) => s.id !== step.id) } : e))}
                  >
                    <Trash2 size={15} />
                  </button>
                </header>
                <textarea className="api-input out-step__body" rows={6} value={step.body} onChange={(e) => patchStep(step.id, { body: e.target.value })} />
                {audience[0] && (
                  <details className="out-preview">
                    <summary>
                      <ChevronDown size={14} /> Preview for {audience[0].name}
                    </summary>
                    <p className="out-preview__body">{compose(step.body, audience[0], editing.campaign.signature)}</p>
                  </details>
                )}
              </article>
            ))}
            <button type="button" className="btn btn--secondary btn--sm out-add" onClick={addStep}>
              <Plus size={14} /> Add a message
            </button>
          </div>

          <p className="api-hint">Use {TOKENS.join(' ')} inside a message — each one is filled in with that lead's own details.</p>

          <div className="soc-actions">
            <button type="button" className="btn btn--primary" onClick={() => void save(true)} disabled={busy === 'save'}>
              {busy === 'save' ? <Loader2 size={16} className="spin" /> : <Play size={16} />} Save and start
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void save(false)} disabled={busy === 'save'}>
              Save as draft
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="card api-loading">
          <Loader2 size={20} className="spin" /> Loading your campaigns…
        </div>
      ) : campaigns.length === 0 ? (
        <section className="card">
          <div className="empty">
            <span className="empty__icon">
              <Megaphone size={24} />
            </span>
            <h2>No campaigns yet</h2>
            <p>
              A campaign takes your enriched leads and works through them over a few days. Each WhatsApp message comes up here at its turn, you press send, and
              a lead that replies is dropped from the rest of the sequence.
            </p>
          </div>
        </section>
      ) : (
        <section className="out-list">
          {campaigns.map((campaign) => {
            const tally = counts[campaign.id] ?? { pending: 0, sent: 0, skipped: 0 }
            const total = tally.pending + tally.sent + tally.skipped
            return (
              <article key={campaign.id} className={`card out-card is-${campaign.status}`}>
                <header className="out-card__head">
                  <div>
                    <h2 className="card__title">{campaign.name || 'Untitled campaign'}</h2>
                    <p className="card__sub">
                      {campaign.source || 'Every lead'} · {campaign.dailyCap}/day · {hour(campaign.sendFrom)}–{hour(campaign.sendTo)} {campaign.timezone}
                    </p>
                  </div>
                  <span className={`out-chip out-chip--${campaign.status}`}>{STATUS_LABEL[campaign.status]}</span>
                </header>

                <div className="out-numbers">
                  <span>
                    <strong>{tally.sent}</strong> sent
                  </span>
                  <span>
                    <strong>{tally.pending}</strong> waiting
                  </span>
                  {tally.skipped > 0 && (
                    <span>
                      <strong>{tally.skipped}</strong> skipped
                    </span>
                  )}
                </div>
                <div className="out-bar">
                  <span style={{ width: `${total === 0 ? 0 : Math.round((tally.sent / total) * 100)}%` }} />
                </div>

                <div className="out-card__actions">
                  {campaign.status === 'running' ? (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void pause(campaign)}>
                      <Pause size={14} /> Pause
                    </button>
                  ) : (
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => void resume(campaign)} disabled={busy === campaign.id}>
                      {busy === campaign.id ? <Loader2 size={14} className="spin" /> : <Play size={14} />} {campaign.status === 'draft' ? 'Start' : 'Resume'}
                    </button>
                  )}
                  {campaign.status !== 'done' && (
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => void stop(campaign)}>
                      <Square size={14} /> Stop
                    </button>
                  )}
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => void edit(campaign)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => void openDetail(campaign)}>
                    {openId === campaign.id ? 'Hide messages' : 'Messages'}
                  </button>
                  <button type="button" className="api-icon-btn" title="Delete campaign" onClick={() => void remove(campaign)}>
                    <Trash2 size={15} />
                  </button>
                </div>

                {openId === campaign.id && (
                  <div className="table-wrap out-queue">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Lead</th>
                          <th>To</th>
                          <th>When</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queue.slice(0, 100).map((item) => (
                          <tr key={item.id}>
                            <td>{leadById.get(item.leadId)?.name || '—'}</td>
                            <td className="out-queue__to">+{item.recipient}</td>
                            <td className="table__muted">{new Date(item.sentAt ?? item.scheduledFor).toLocaleString()}</td>
                            <td>
                              <span className={`out-dot out-dot--${item.status}`} /> {item.status}
                              {item.error && <span className="out-queue__error">{item.error}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {queue.length > 100 && <p className="api-hint out-more">Showing the first 100 messages.</p>}
                  </div>
                )}
              </article>
            )
          })}
        </section>
      )}
    </>
  )
}
