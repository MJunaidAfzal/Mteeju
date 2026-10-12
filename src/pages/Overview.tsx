import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  FileText,
  Hourglass,
  Loader2,
  Megaphone,
  Plug,
  RefreshCw,
  Send,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { fetchServices } from '../lib/apiStore'
import { calcTotals, fetchInvoices, formatDate, formatMoney, type Invoice } from '../lib/invoices'
import { LEAD_STATUSES, fetchLeads, type Lead } from '../lib/leadStore'
import { countsFor, fetchCampaigns, type Campaign, type CampaignCounts } from '../lib/outreach'
import type { ApiService } from '../lib/rapidapi'
import { fetchAccounts, fetchPosts, formatWhen, type SocialAccount, type SocialPost } from '../lib/social'
import './Overview.css'

type PageId = 'apis' | 'invoices' | 'social' | 'leads' | 'outreach'

const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

/** Chart colours — checked for colour-blind separation against the paper surface. */
const GREEN = '#3a9a78'
const MAROON = '#9c2f4b'
const GOLD = '#c98a1b'

const MONTHS_SHOWN = 6
const DAYS_SHOWN = 14
const DAY_MS = 86_400_000

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Everything the dashboard shows. A null section could not be loaded and renders as empty. */
interface PortalData {
  invoices: Invoice[] | null
  leads: Lead[] | null
  campaigns: Campaign[] | null
  counts: Record<string, CampaignCounts>
  posts: SocialPost[] | null
  accounts: SocialAccount[] | null
  services: ApiService[] | null
}

const EMPTY: PortalData = { invoices: null, leads: null, campaigns: null, counts: {}, posts: null, accounts: null, services: null }

async function loadPortal(): Promise<PortalData> {
  const settle = <T,>(promise: Promise<T>) => promise.catch(() => null)
  const [invoices, leads, campaigns, posts, accounts, services] = await Promise.all([
    settle(fetchInvoices()),
    settle(fetchLeads()),
    settle(fetchCampaigns()),
    settle(fetchPosts()),
    settle(fetchAccounts()),
    settle(fetchServices()),
  ])
  const counts = campaigns ? ((await settle(countsFor(campaigns.map((c) => c.id)))) ?? {}) : {}
  return { invoices, leads, campaigns, counts, posts, accounts, services }
}

const count = (value: number) => new Intl.NumberFormat('en-US').format(value)

function compactMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(amount)
  } catch {
    return `${currency} ${Math.round(amount)}`
  }
}

/** A round number at or above the value, so the top gridline is easy to read. */
function niceMax(value: number) {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const lead = value / power
  return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * power
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setWidth(Math.round(node.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/* ---------- Shared pieces ---------- */

function Panel({
  title,
  sub,
  action,
  onAction,
  className = '',
  children,
}: {
  title: string
  sub?: string
  action?: string
  onAction?: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`card ov-panel ${className}`}>
      <div className="ov-panel__head">
        <div>
          <h2 className="card__title">{title}</h2>
          {sub && <p className="card__sub">{sub}</p>}
        </div>
        {action && (
          <button type="button" className="ov-link" onClick={onAction}>
            {action} <ArrowUpRight size={15} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="ov-empty">
      <span className="ov-empty__icon">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <p>{text}</p>
    </div>
  )
}

function Kpi({
  icon: Icon,
  label,
  value,
  note,
  tone,
  loading,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: string
  note: string
  tone: 'green' | 'maroon' | 'gold' | 'ink'
  loading: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`card ov-kpi ov-kpi--${tone}`} onClick={onClick}>
      <span className="ov-kpi__top">
        <span className="ov-kpi__icon">
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <ArrowUpRight size={16} className="ov-kpi__go" />
      </span>
      <span className="ov-kpi__label">{label}</span>
      {loading ? <span className="ov-skel ov-skel--value" /> : <span className="ov-kpi__value">{value}</span>}
      {loading ? <span className="ov-skel ov-skel--note" /> : <span className="ov-kpi__note">{note}</span>}
    </button>
  )
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="ov-legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className="ov-swatch" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/* ---------- Revenue: stacked bars per month ---------- */

interface MonthPoint {
  key: string
  label: string
  paid: number
  awaiting: number
}

/** A bar segment whose top corners are rounded only when it is the top of the stack. */
function barPath(x: number, y: number, width: number, height: number, rounded: boolean) {
  const r = rounded ? Math.min(4, width / 2, height) : 0
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
}

function RevenueChart({ months, currency }: { months: MonthPoint[]; currency: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const height = 250
  const pad = { top: 14, right: 6, bottom: 28, left: 48 }
  const plotW = Math.max(0, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const top = niceMax(Math.max(...months.map((m) => m.paid + m.awaiting)))
  const band = plotW / months.length
  const barW = Math.min(38, band * 0.5)
  const y = (value: number) => pad.top + plotH - (value / top) * plotH
  const hovered = active === null ? null : months[active]

  return (
    <div className="ov-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Invoiced amount per month for the last ${months.length} months`}>
          {[0, 0.5, 1].map((step) => (
            <g key={step}>
              <line className="ov-grid" x1={pad.left} x2={width - pad.right} y1={y(top * step)} y2={y(top * step)} />
              <text className="ov-axis" x={pad.left - 10} y={y(top * step) + 4} textAnchor="end">
                {compactMoney(top * step, currency)}
              </text>
            </g>
          ))}
          {months.map((month, index) => {
            const x = pad.left + band * index + (band - barW) / 2
            const paidH = (month.paid / top) * plotH
            const awaitH = (month.awaiting / top) * plotH
            const gap = paidH > 0 && awaitH > 0 ? 2 : 0
            return (
              <g key={month.key} opacity={active === null || active === index ? 1 : 0.45}>
                {paidH > 0 && <path d={barPath(x, y(month.paid), barW, paidH, awaitH === 0)} fill={GREEN} />}
                {awaitH > 0 && <path d={barPath(x, y(month.paid + month.awaiting), barW, Math.max(1, awaitH - gap), true)} fill={GOLD} />}
                <text className="ov-axis" x={x + barW / 2} y={height - 8} textAnchor="middle">
                  {month.label}
                </text>
                <rect
                  x={pad.left + band * index}
                  y={pad.top}
                  width={band}
                  height={plotH + pad.bottom}
                  fill="transparent"
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                />
              </g>
            )
          })}
        </svg>
      )}
      {hovered && active !== null && (
        <div className="ov-tip" style={{ left: pad.left + band * active + band / 2, top: Math.max(0, y(hovered.paid + hovered.awaiting) - 8) }}>
          <p className="ov-tip__title">{hovered.label}</p>
          <p>
            <span className="ov-swatch" style={{ background: GREEN }} /> Paid <strong>{formatMoney(hovered.paid, currency)}</strong>
          </p>
          <p>
            <span className="ov-swatch" style={{ background: GOLD }} /> Awaiting <strong>{formatMoney(hovered.awaiting, currency)}</strong>
          </p>
        </div>
      )}
    </div>
  )
}

/* ---------- Leads: one line over the last two weeks ---------- */

interface DayPoint {
  key: string
  label: string
  value: number
}

function LeadsChart({ days }: { days: DayPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const height = 220
  const pad = { top: 14, right: 12, bottom: 28, left: 34 }
  const plotW = Math.max(0, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const top = Math.max(2, niceMax(Math.max(...days.map((d) => d.value))))
  const x = (index: number) => pad.left + (plotW * index) / (days.length - 1)
  const y = (value: number) => pad.top + plotH - (value / top) * plotH
  const line = days.map((day, index) => `${index ? 'L' : 'M'}${x(index)},${y(day.value)}`).join(' ')
  const area = `${line} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
  const every = width < 420 ? 4 : 2
  const hovered = active === null ? null : days[active]

  function track(event: React.MouseEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left - pad.left) / (plotW || 1)
    setActive(Math.min(days.length - 1, Math.max(0, Math.round(ratio * (days.length - 1)))))
  }

  return (
    <div className="ov-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Leads added per day for the last ${days.length} days`}
          onMouseMove={track}
          onMouseLeave={() => setActive(null)}
        >
          <defs>
            <linearGradient id="ov-leads-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={GREEN} stopOpacity="0.22" />
              <stop offset="1" stopColor={GREEN} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((step) => (
            <g key={step}>
              <line className="ov-grid" x1={pad.left} x2={width - pad.right} y1={y(top * step)} y2={y(top * step)} />
              <text className="ov-axis" x={pad.left - 10} y={y(top * step) + 4} textAnchor="end">
                {count(top * step)}
              </text>
            </g>
          ))}
          <path d={area} fill="url(#ov-leads-fill)" />
          <path d={line} fill="none" stroke={GREEN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {days.map(
            (day, index) =>
              (days.length - 1 - index) % every === 0 && (
                <text key={day.key} className="ov-axis" x={x(index)} y={height - 8} textAnchor={index === days.length - 1 ? 'end' : 'middle'}>
                  {day.label}
                </text>
              ),
          )}
          {hovered && active !== null && (
            <>
              <line className="ov-cross" x1={x(active)} x2={x(active)} y1={pad.top} y2={y(0)} />
              <circle cx={x(active)} cy={y(hovered.value)} r={5} fill={GREEN} stroke="var(--paper)" strokeWidth={2} />
            </>
          )}
        </svg>
      )}
      {hovered && active !== null && (
        <div className="ov-tip" style={{ left: x(active), top: Math.max(0, y(hovered.value) - 12) }}>
          <p className="ov-tip__title">{hovered.label}</p>
          <p>
            <span className="ov-swatch" style={{ background: GREEN }} /> New leads <strong>{count(hovered.value)}</strong>
          </p>
        </div>
      )}
    </div>
  )
}

/* ---------- Invoice status: donut ---------- */

interface Slice {
  label: string
  color: string
  value: number
  amount: number
}

function StatusDonut({ slices, currency }: { slices: Slice[]; currency: string }) {
  const [active, setActive] = useState<number | null>(null)
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const radius = 58
  const around = 2 * Math.PI * radius
  const shown = active === null ? null : slices[active]

  const arcs = slices.map((slice, index) => {
    const before = slices.slice(0, index).reduce((sum, s) => sum + s.value, 0)
    return { length: (slice.value / total) * around, offset: (before / total) * around }
  })

  return (
    <div className="ov-donut">
      <div className="ov-donut__ring">
        <svg viewBox="0 0 160 160" role="img" aria-label={slices.map((s) => `${s.label}: ${s.value}`).join(', ')}>
          <circle cx={80} cy={80} r={radius} fill="none" stroke="var(--beige-200)" strokeWidth={16} />
          {slices.map((slice, index) => {
            if (slice.value === 0) return null
            const { length, offset } = arcs[index]
            return (
              <circle
                key={slice.label}
                cx={80}
                cy={80}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={active === index ? 20 : 16}
                strokeDasharray={`${Math.max(0, length - 2)} ${around}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 80 80)"
                opacity={active === null || active === index ? 1 : 0.4}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
              />
            )
          })}
        </svg>
        <div className="ov-donut__center">
          <strong>{count(shown ? shown.value : total)}</strong>
          <span>{shown ? shown.label : total === 1 ? 'invoice' : 'invoices'}</span>
        </div>
      </div>
      <ul className="ov-donut__legend">
        {slices.map((slice, index) => (
          <li key={slice.label} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}>
            <span className="ov-swatch" style={{ background: slice.color }} />
            <span className="ov-donut__name">{slice.label}</span>
            <span className="ov-donut__count">{count(slice.value)}</span>
            <span className="ov-donut__amount">{formatMoney(slice.amount, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Page ---------- */

export default function Overview({ name, onNavigate }: { name: string; onNavigate: (page: PageId) => void }) {
  const firstName = name.split(' ')[0]
  const [data, setData] = useState<PortalData>(EMPTY)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setData(await loadPortal())
    setLoading(false)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(load)
  }, [load])

  const money = useMemo(() => {
    const invoices = data.invoices ?? []
    // Totals only make sense in one currency: use the one most invoices are written in.
    const tally = new Map<string, number>()
    for (const invoice of invoices) tally.set(invoice.currency, (tally.get(invoice.currency) ?? 0) + 1)
    const currency = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD'
    const own = invoices.filter((invoice) => invoice.currency === currency)
    const todayKey = new Date().toISOString().slice(0, 10)

    const sum = (status: Invoice['status']) => own.filter((i) => i.status === status).reduce((total, i) => total + calcTotals(i).total, 0)
    const of = (status: Invoice['status']) => own.filter((i) => i.status === status).length

    const now = new Date()
    const months: MonthPoint[] = []
    for (let back = MONTHS_SHOWN - 1; back >= 0; back -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - back, 1)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      months.push({ key, label: new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date), paid: 0, awaiting: 0 })
    }
    for (const invoice of own) {
      const month = months.find((m) => m.key === invoice.issueDate.slice(0, 7))
      if (!month) continue
      if (invoice.status === 'paid') month.paid += calcTotals(invoice).total
      if (invoice.status === 'sent') month.awaiting += calcTotals(invoice).total
    }

    const recent = [...invoices]
      .sort((a, b) => (b.createdAt ?? b.issueDate).localeCompare(a.createdAt ?? a.issueDate))
      .slice(0, 5)

    return {
      currency,
      otherCurrencies: invoices.length - own.length,
      collected: sum('paid'),
      outstanding: sum('sent'),
      paidCount: of('paid'),
      sentCount: of('sent'),
      overdue: own.filter((i) => i.status === 'sent' && i.dueDate && i.dueDate < todayKey).length,
      months,
      hasMonths: months.some((m) => m.paid + m.awaiting > 0),
      slices: [
        { label: 'Paid', color: GREEN, value: of('paid'), amount: sum('paid') },
        { label: 'Awaiting', color: GOLD, value: of('sent'), amount: sum('sent') },
        { label: 'Draft', color: MAROON, value: of('draft'), amount: sum('draft') },
      ] as Slice[],
      recent,
      todayKey,
    }
  }, [data.invoices])

  const pipeline = useMemo(() => {
    const leads = data.leads ?? []
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const days: DayPoint[] = []
    for (let back = DAYS_SHOWN - 1; back >= 0; back -= 1) {
      const date = new Date(start.getTime() - back * DAY_MS)
      days.push({ key: date.toDateString(), label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date), value: 0 })
    }
    let thisWeek = 0
    for (const lead of leads) {
      if (!lead.createdAt) continue
      const created = new Date(lead.createdAt)
      const day = days.find((d) => d.key === created.toDateString())
      if (day) day.value += 1
      if (start.getTime() - created.getTime() < 6 * DAY_MS) thisWeek += 1
    }
    const stages = LEAD_STATUSES.map((status) => ({ ...status, value: leads.filter((lead) => lead.status === status.id).length }))
    return {
      total: leads.length,
      thisWeek,
      days,
      stages,
      largest: Math.max(1, ...stages.map((stage) => stage.value)),
      withEmail: leads.filter((lead) => lead.emails.length > 0).length,
    }
  }, [data.leads])

  const outreach = useMemo(() => {
    const campaigns = data.campaigns ?? []
    const rank: Record<Campaign['status'], number> = { running: 0, paused: 1, draft: 2, done: 3 }
    const rows = [...campaigns]
      .sort((a, b) => rank[a.status] - rank[b.status])
      .map((campaign) => {
        const tally = data.counts[campaign.id] ?? { pending: 0, sent: 0, skipped: 0 }
        const all = tally.pending + tally.sent + tally.skipped
        return { campaign, ...tally, progress: all ? (tally.sent + tally.skipped) / all : 0 }
      })
    return {
      rows,
      running: campaigns.filter((c) => c.status === 'running').length,
      sent: rows.reduce((sum, row) => sum + row.sent, 0),
      pending: rows.reduce((sum, row) => sum + row.pending, 0),
    }
  }, [data.campaigns, data.counts])

  const social = useMemo(() => {
    const posts = data.posts ?? []
    const upcoming = posts
      .filter((post) => post.status === 'scheduled' && post.scheduledAt)
      .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
    return {
      accounts: (data.accounts ?? []).filter((account) => account.active).length,
      scheduled: upcoming.length,
      published: posts.filter((post) => post.status === 'published' || post.status === 'partial').length,
      drafts: posts.filter((post) => post.status === 'draft').length,
      upcoming: upcoming.slice(0, 3),
    }
  }, [data.posts, data.accounts])

  const services = data.services ?? []
  const endpoints = services.reduce((sum, service) => sum + service.endpoints.length, 0)

  const invoiceState = (invoice: Invoice) =>
    invoice.status === 'paid'
      ? { tone: 'good', label: 'Paid' }
      : invoice.status === 'draft'
        ? { tone: 'quiet', label: 'Draft' }
        : invoice.dueDate && invoice.dueDate < money.todayKey
          ? { tone: 'late', label: 'Overdue' }
          : { tone: 'wait', label: 'Awaiting' }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{today}</p>
          <h1>
            {greeting()}, <em>{firstName}</em>
          </h1>
          <p className="page-head__sub">Here is what is happening across your Teeju portal.</p>
        </div>
        <button type="button" className="btn btn--secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Refresh
        </button>
      </div>

      <div className="ov-kpis">
        <Kpi
          icon={CircleDollarSign}
          tone="green"
          label="Collected"
          value={formatMoney(money.collected, money.currency)}
          note={`${count(money.paidCount)} paid ${money.paidCount === 1 ? 'invoice' : 'invoices'}`}
          loading={loading}
          onClick={() => onNavigate('invoices')}
        />
        <Kpi
          icon={Hourglass}
          tone="gold"
          label="Outstanding"
          value={formatMoney(money.outstanding, money.currency)}
          note={money.overdue ? `${count(money.overdue)} overdue of ${count(money.sentCount)} awaiting` : `${count(money.sentCount)} awaiting payment`}
          loading={loading}
          onClick={() => onNavigate('invoices')}
        />
        <Kpi
          icon={Users}
          tone="maroon"
          label="Leads"
          value={count(pipeline.total)}
          note={`${count(pipeline.thisWeek)} added in the last 7 days`}
          loading={loading}
          onClick={() => onNavigate('leads')}
        />
        <Kpi
          icon={Send}
          tone="ink"
          label="Messages sent"
          value={count(outreach.sent)}
          note={`${count(outreach.pending)} waiting · ${count(outreach.running)} running`}
          loading={loading}
          onClick={() => onNavigate('outreach')}
        />
      </div>

      <div className="ov-grid-2 ov-grid-2--wide">
        <Panel
          title="Revenue"
          sub={`Invoiced in the last ${MONTHS_SHOWN} months, by issue date${money.otherCurrencies ? ` · ${money.currency} only` : ''}`}
          action="Invoices"
          onAction={() => onNavigate('invoices')}
        >
          {loading ? (
            <div className="ov-skel ov-skel--chart" />
          ) : money.hasMonths ? (
            <>
              <Legend
                items={[
                  { label: 'Paid', color: GREEN },
                  { label: 'Awaiting payment', color: GOLD },
                ]}
              />
              <RevenueChart months={money.months} currency={money.currency} />
            </>
          ) : (
            <Empty icon={FileText} text="No invoices were sent or paid in this period yet." />
          )}
        </Panel>

        <Panel title="Invoice status" sub="Every invoice, by where it stands">
          {loading ? (
            <div className="ov-skel ov-skel--chart" />
          ) : money.slices.some((slice) => slice.value > 0) ? (
            <StatusDonut slices={money.slices} currency={money.currency} />
          ) : (
            <Empty icon={FileText} text="Create your first invoice to see it here." />
          )}
        </Panel>
      </div>

      <div className="ov-grid-2">
        <Panel title="New leads" sub={`Leads added per day, last ${DAYS_SHOWN} days`} action="Leads" onAction={() => onNavigate('leads')}>
          {loading ? (
            <div className="ov-skel ov-skel--chart" />
          ) : pipeline.total > 0 ? (
            <LeadsChart days={pipeline.days} />
          ) : (
            <Empty icon={Users} text="Find or import leads and they will be charted here." />
          )}
        </Panel>

        <Panel title="Lead pipeline" sub={`${count(pipeline.withEmail)} of ${count(pipeline.total)} leads have an email`}>
          {loading ? (
            <div className="ov-skel ov-skel--chart" />
          ) : pipeline.total > 0 ? (
            <ul className="ov-bars">
              {pipeline.stages.map((stage) => (
                <li key={stage.id}>
                  <span className="ov-bars__label">{stage.label}</span>
                  <span className="ov-bars__track">
                    <span className="ov-bars__fill" style={{ width: `${(stage.value / pipeline.largest) * 100}%` }} />
                  </span>
                  <span className="ov-bars__value">{count(stage.value)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Users} text="Your leads will be grouped by status here." />
          )}
        </Panel>
      </div>

      <div className="ov-grid-2">
        <Panel
          title="Campaigns"
          sub={`${count(outreach.sent)} sent · ${count(outreach.pending)} waiting`}
          action="Outreach"
          onAction={() => onNavigate('outreach')}
        >
          {loading ? (
            <div className="ov-skel ov-skel--list" />
          ) : outreach.rows.length > 0 ? (
            <ul className="ov-list">
              {outreach.rows.slice(0, 5).map(({ campaign, sent, pending, progress }) => (
                <li key={campaign.id} className="ov-campaign">
                  <div className="ov-campaign__row">
                    <span className="ov-list__title">{campaign.name || 'Untitled campaign'}</span>
                    <span className={`ov-pill ov-pill--${campaign.status}`}>{campaign.status}</span>
                  </div>
                  <span className="ov-progress">
                    <span className="ov-progress__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </span>
                  <span className="ov-list__meta">
                    {count(sent)} sent · {count(pending)} waiting · {Math.round(progress * 100)}% done
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Send} text="Start a campaign to message your leads on WhatsApp." />
          )}
        </Panel>

        <Panel title="Recent invoices" sub="The latest five" action="All invoices" onAction={() => onNavigate('invoices')}>
          {loading ? (
            <div className="ov-skel ov-skel--list" />
          ) : money.recent.length > 0 ? (
            <ul className="ov-list">
              {money.recent.map((invoice) => {
                const state = invoiceState(invoice)
                return (
                  <li key={invoice.id} className="ov-invoice">
                    <div className="ov-invoice__who">
                      <span className="ov-list__title">{invoice.client.name || 'No client yet'}</span>
                      <span className="ov-list__meta">
                        {invoice.number} · due {formatDate(invoice.dueDate) || '—'}
                      </span>
                    </div>
                    <span className={`ov-pill ov-pill--${state.tone}`}>{state.label}</span>
                    <span className="ov-invoice__amount">{formatMoney(calcTotals(invoice).total, invoice.currency)}</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <Empty icon={FileText} text="Your newest invoices will be listed here." />
          )}
        </Panel>
      </div>

      <div className="ov-grid-2">
        <Panel title="Social" sub="Posts and connected accounts" action="Social" onAction={() => onNavigate('social')}>
          {loading ? (
            <div className="ov-skel ov-skel--list" />
          ) : (
            <>
              <div className="ov-minis">
                <div className="ov-mini">
                  <strong>{count(social.accounts)}</strong>
                  <span>Accounts</span>
                </div>
                <div className="ov-mini">
                  <strong>{count(social.scheduled)}</strong>
                  <span>Scheduled</span>
                </div>
                <div className="ov-mini">
                  <strong>{count(social.published)}</strong>
                  <span>Published</span>
                </div>
                <div className="ov-mini">
                  <strong>{count(social.drafts)}</strong>
                  <span>Drafts</span>
                </div>
              </div>
              {social.upcoming.length > 0 ? (
                <ul className="ov-list ov-list--tight">
                  {social.upcoming.map((post) => (
                    <li key={post.id} className="ov-post">
                      <CalendarClock size={16} strokeWidth={1.75} />
                      <span className="ov-post__text">{post.content.trim() || 'Post without text'}</span>
                      <span className="ov-list__meta">{formatWhen(post.scheduledAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon={Megaphone} text="Nothing is scheduled to post." />
              )}
            </>
          )}
        </Panel>

        <Panel title="APIs" sub="Connected services and saved requests" action="APIs" onAction={() => onNavigate('apis')}>
          {loading ? (
            <div className="ov-skel ov-skel--list" />
          ) : (
            <>
              <div className="ov-minis ov-minis--two">
                <div className="ov-mini">
                  <strong>{count(services.length)}</strong>
                  <span>Services</span>
                </div>
                <div className="ov-mini">
                  <strong>{count(endpoints)}</strong>
                  <span>Endpoints</span>
                </div>
              </div>
              {services.length > 0 ? (
                <ul className="ov-list ov-list--tight">
                  {services.slice(0, 3).map((service) => (
                    <li key={service.id} className="ov-post">
                      <Plug size={16} strokeWidth={1.75} />
                      <span className="ov-post__text">{service.name}</span>
                      <span className="ov-list__meta">
                        {count(service.endpoints.length)} {service.endpoints.length === 1 ? 'endpoint' : 'endpoints'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon={Plug} text="No API service is connected yet." />
              )}
            </>
          )}
        </Panel>
      </div>
    </>
  )
}
