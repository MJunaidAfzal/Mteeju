import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  Database,
  Loader2,
  Mail,
  Megaphone,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  SkipForward,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import PlatformIcon from '../components/PlatformIcon'
import { SetupRequiredError } from '../lib/apiStore'
import { fetchLeads, type Lead } from '../lib/leadStore'
import {
  cancelPending,
  contactFor,
  countsFor,
  defaultSteps,
  deleteCampaign,
  fetchCampaigns,
  fetchQueue,
  fetchSteps,
  fetchWhatsappDue,
  markQueueItem,
  newCampaign,
  queueLeads,
  reachable,
  render,
  runNow,
  saveCampaign,
  sendTestEmail,
  setCampaignStatus,
  type Campaign,
  type CampaignCounts,
  type Channel,
  type QueueItem,
  type Step,
} from '../lib/outreach'
import setupSql from '../../supabase/migrations/20261012000000_outreach.sql?raw'
import './Outreach.css'

const TOKENS = ['{{name}}', '{{category}}', '{{city}}', '{{rating}}', '{{reviews}}', '{{opening}}']

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
  const [waDue, setWaDue] = useState<QueueItem[]>([])
  const [opened, setOpened] = useState<Set<string>>(new Set())

  const [loading, setLoading] = useState(true)
  const [setupRequired, setSetupRequired] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState('')

  const [editing, setEditing] = useState<{ campaign: Campaign; steps: Step[] } | null>(null)
  const [openId, setOpenId] = useState('')
  const [testTo, setTestTo] = useState(() => {
    try {
      return localStorage.getItem('teeju-test-email') ?? ''
    } catch {
      return ''
    }
  })
  const [testResult, setTestResult] = useState('')
  const [queue, setQueue] = useState<QueueItem[]>([])
  const editorRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, allLeads, due] = await Promise.all([fetchCampaigns(), fetchLeads(), fetchWhatsappDue()])
      setCampaigns(list)
      setLeads(allLeads)
      setWaDue(due)
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
  const sources = useMemo(() => [...new Set(leads.map((l) => l.source).filter(Boolean))], [leads])

  const totals = useMemo(() => {
    const all = Object.values(counts)
    return {
      running: campaigns.filter((c) => c.status === 'running').length,
      sent: all.reduce((sum, c) => sum + c.sent, 0),
      pending: all.reduce((sum, c) => sum + c.pending, 0),
      whatsapp: waDue.length,
    }
  }, [campaigns, counts, waDue])

  /** The leads this draft would actually reach, and how. */
  const audience = useMemo(() => {
    if (!editing) return { all: [] as Lead[], email: 0, whatsapp: 0 }
    const pool = editing.campaign.source ? leads.filter((l) => l.source === editing.campaign.source) : leads
    const all = reachable(pool, editing.steps)
    return {
      all,
      email: all.filter((l) => contactFor(l, 'email')).length,
      whatsapp: all.filter((l) => contactFor(l, 'whatsapp')).length,
    }
  }, [editing, leads])

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
        channel: last?.channel === 'email' ? 'whatsapp' : 'email',
        subject: '',
        body: '',
        personalise: true,
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
    if (andStart && audience.all.length === 0) {
      setNote({ kind: 'error', text: 'None of these leads has an email or a phone number — enrich them first.' })
      return
    }
    setBusy('save')
    try {
      await saveCampaign(campaign, steps)
      let queued = 0
      if (andStart) {
        queued = await queueLeads(campaign, steps, audience.all)
        await setCampaignStatus(campaign.id, 'running')
      }
      await load()
      setEditing(null)
      setNote({
        kind: 'ok',
        text: andStart ? `Campaign started — ${queued} message${queued === 1 ? '' : 's'} queued for ${audience.all.length} leads.` : 'Campaign saved as a draft.',
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
      const added = await queueLeads(campaign, steps, reachable(pool, steps))
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
      setNote({ kind: 'ok', text: 'Paused. Nothing more will be sent until you start it again.' })
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

  async function sendDue(campaignId?: string) {
    setBusy('run')
    setNote(null)
    try {
      const result = await runNow(campaignId)
      await load()
      const extra = result.waiting > 0 ? ` ${result.waiting} campaign${result.waiting === 1 ? '' : 's'} are outside their sending window or at today's cap.` : ''
      setNote({
        kind: result.failed > 0 ? 'error' : 'ok',
        text: `${result.sent} email${result.sent === 1 ? '' : 's'} sent, ${result.failed} failed.${extra}${result.notes?.length ? ` ${result.notes[0]}` : ''}`,
      })
    } catch (err) {
      setNote({ kind: 'error', text: err instanceof Error ? err.message : 'The run failed.' })
    } finally {
      setBusy('')
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

  async function testEmail() {
    if (!testTo.trim()) return
    setBusy('test')
    setTestResult('')
    try {
      await sendTestEmail(testTo.trim())
      try {
        localStorage.setItem('teeju-test-email', testTo.trim())
      } catch {
        // private browsing can block storage
      }
      setTestResult(`Sent. Check ${testTo.trim()} — if it is not there in a minute, look in spam.`)
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'The test email failed.')
    } finally {
      setBusy('')
    }
  }

  /* ---------- WhatsApp one-click ---------- */

  function openWhatsapp(item: QueueItem) {
    const lead = leadById.get(item.leadId)
    const text = lead ? render(item.body, lead) : item.body
    window.open(`https://wa.me/${item.recipient}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    setOpened((set) => new Set(set).add(item.id))
  }

  async function markWhatsapp(item: QueueItem, status: 'sent' | 'skipped') {
    try {
      await markQueueItem(item.id, status)
      setWaDue((list) => list.filter((q) => q.id !== item.id))
      setCounts((all) => {
        const tally = all[item.campaignId]
        if (!tally) return all
        return {
          ...all,
          [item.campaignId]: {
            ...tally,
            pending: Math.max(0, tally.pending - 1),
            waitingWhatsapp: Math.max(0, tally.waitingWhatsapp - 1),
            sent: status === 'sent' ? tally.sent + 1 : tally.sent,
          },
        }
      })
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
          <p className="page-head__sub">Email goes out on its own. WhatsApp waits here for one click.</p>
        </div>
        <div className="inv-actions">
          <button type="button" className="btn btn--secondary" onClick={() => void sendDue()} disabled={busy === 'run'}>
            {busy === 'run' ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Send due email now
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
          { label: 'Waiting', value: totals.pending, icon: Mail },
          { label: 'WhatsApp due', value: totals.whatsapp, icon: Send },
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

      <section className="card out-check">
        <div className="out-check__body">
          <h2 className="card__title">Email sender</h2>
          <p className="card__sub">
            Campaigns send from the Gmail account in your <code>GMAIL_USER</code> and <code>GMAIL_APP_PASSWORD</code> secrets. Send yourself one test
            message to be sure it works.
          </p>
          {testResult && <p className={`out-check__result${/sent\./i.test(testResult) ? ' is-ok' : ''}`}>{testResult}</p>}
        </div>
        <div className="out-check__form">
          <input
            className="api-input"
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="your own email address"
            aria-label="Address for the test email"
          />
          <button type="button" className="btn btn--secondary" onClick={() => void testEmail()} disabled={busy === 'test' || !testTo.trim()}>
            {busy === 'test' ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />} Send test
          </button>
        </div>
      </section>

      {waDue.length > 0 && (
        <section className="card out-wa">
          <header className="card__head">
            <div>
              <h2 className="card__title">WhatsApp — {waDue.length} ready to send</h2>
              <p className="card__sub">Open the chat, press send in WhatsApp, then mark it here. Nothing is sent without you.</p>
            </div>
          </header>
          <ul className="out-wa__list">
            {waDue.slice(0, 25).map((item) => {
              const lead = leadById.get(item.leadId)
              return (
                <li key={item.id} className="out-wa__item">
                  <div className="out-wa__who">
                    <strong>{lead?.name || 'Lead'}</strong>
                    <span className="lead-sub">
                      <PlatformIcon id="telegram" size={12} /> +{item.recipient}
                    </span>
                  </div>
                  <p className="out-wa__text">{lead ? render(item.body, lead) : item.body}</p>
                  <div className="out-wa__actions">
                    <button type="button" className={`btn btn--sm ${opened.has(item.id) ? 'btn--secondary' : 'btn--primary'}`} onClick={() => openWhatsapp(item)}>
                      <Send size={14} /> Open WhatsApp
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm ${opened.has(item.id) ? 'btn--primary' : 'btn--secondary'}`}
                      onClick={() => void markWhatsapp(item, 'sent')}
                    >
                      <Check size={14} /> Mark sent
                    </button>
                    <button type="button" className="api-icon-btn" title="Skip this one" onClick={() => void markWhatsapp(item, 'skipped')}>
                      <SkipForward size={15} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {waDue.length > 25 && <p className="api-hint out-more">Showing the first 25 — the rest stay queued.</p>}
        </section>
      )}

      {editing && (
        <section className="card out-editor" ref={editorRef}>
          <header className="card__head">
            <div>
              <h2 className="card__title">{campaigns.some((c) => c.id === editing.campaign.id) ? 'Edit campaign' : 'New campaign'}</h2>
              <p className="card__sub">
                {audience.all.length} lead{audience.all.length === 1 ? '' : 's'} can be reached — {audience.email} by email, {audience.whatsapp} on WhatsApp
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
              <span>Your name (shown as the sender)</span>
              <input className="api-input" value={editing.campaign.fromName} onChange={(e) => patch({ fromName: e.target.value })} placeholder="e.g. Sara from Teeju" />
            </label>
            <label className="out-field">
              <span>Emails per day</span>
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
            <span>Sign-off added to every email</span>
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
                  <select className="api-input out-step__channel" value={step.channel} onChange={(e) => patchStep(step.id, { channel: e.target.value as Channel })}>
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                  <button
                    type="button"
                    className="api-icon-btn"
                    title="Remove this message"
                    onClick={() => setEditing((e) => (e ? { ...e, steps: e.steps.filter((s) => s.id !== step.id) } : e))}
                  >
                    <Trash2 size={15} />
                  </button>
                </header>
                {step.channel === 'email' && (
                  <input className="api-input" value={step.subject} onChange={(e) => patchStep(step.id, { subject: e.target.value })} placeholder="Subject line" />
                )}
                <textarea className="api-input out-step__body" rows={6} value={step.body} onChange={(e) => patchStep(step.id, { body: e.target.value })} />
                {audience.all[0] && (
                  <details className="out-preview">
                    <summary>
                      <ChevronDown size={14} /> Preview for {audience.all[0].name}
                    </summary>
                    {step.channel === 'email' && step.subject && <p className="out-preview__subject">{render(step.subject, audience.all[0])}</p>}
                    <p className="out-preview__body">{render(step.body, audience.all[0])}</p>
                  </details>
                )}
              </article>
            ))}
            <button type="button" className="btn btn--secondary btn--sm out-add" onClick={addStep}>
              <Plus size={14} /> Add a message
            </button>
          </div>

          <p className="api-hint">
            Use {TOKENS.join(' ')} inside a message. <strong>{'{{opening}}'}</strong> is written fresh by the AI for each business — email only.
          </p>

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
              A campaign takes your enriched leads and works through them over a few days — email on its own, WhatsApp with one click. Set the{' '}
              <code>GMAIL_USER</code> and <code>GMAIL_APP_PASSWORD</code> secrets in Supabase before the first email goes out.
            </p>
          </div>
        </section>
      ) : (
        <section className="out-list">
          {campaigns.map((campaign) => {
            const tally = counts[campaign.id] ?? { pending: 0, sent: 0, failed: 0, waitingWhatsapp: 0 }
            const total = tally.pending + tally.sent + tally.failed
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
                  {tally.waitingWhatsapp > 0 && (
                    <span>
                      <strong>{tally.waitingWhatsapp}</strong> on WhatsApp
                    </span>
                  )}
                  {tally.failed > 0 && (
                    <span className="out-numbers__bad">
                      <strong>{tally.failed}</strong> failed
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
                          <th>Channel</th>
                          <th>To</th>
                          <th>When</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queue.slice(0, 100).map((item) => (
                          <tr key={item.id}>
                            <td>{leadById.get(item.leadId)?.name || '—'}</td>
                            <td>{item.channel === 'email' ? 'Email' : 'WhatsApp'}</td>
                            <td className="out-queue__to">{item.recipient}</td>
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
