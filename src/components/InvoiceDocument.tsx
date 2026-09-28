import { forwardRef } from 'react'
import { calcTotals, formatDate, formatMoney, type Invoice } from '../lib/invoices'
import './InvoiceDocument.css'

const STATUS_LABEL = { draft: 'Draft', sent: 'Sent', paid: 'Paid' }

function Lines({ text, className }: { text: string; className: string }) {
  if (!text.trim()) return null
  return <p className={className}>{text}</p>
}

/** The A4 invoice itself. The same markup is used for the preview, printing, PNG and HTML export. */
const InvoiceDocument = forwardRef<HTMLDivElement, { invoice: Invoice }>(function InvoiceDocument({ invoice }, ref) {
  const totals = calcTotals(invoice)
  const money = (n: number) => formatMoney(n, invoice.currency)
  const business = invoice.business
  const client = invoice.client
  const businessLines = [business.address, business.phone, business.email, business.website, business.taxId ? `Tax ID: ${business.taxId}` : ''].filter(Boolean).join('\n')
  const clientLines = [client.address, client.phone, client.email].filter(Boolean).join('\n')

  const header = (
    <div className="inv__head">
      <div className="inv__biz">
        {business.logo ? <img className="inv__logo" src={business.logo} alt="" /> : null}
        <p className="inv__biz-name">{business.name || 'Your business name'}</p>
        <Lines text={businessLines} className="inv__biz-lines" />
      </div>
      <div className="inv__title">
        <h1>Invoice</h1>
        <dl className="inv__meta">
          <dt>Invoice no.</dt>
          <dd>{invoice.number}</dd>
          <dt>Issued</dt>
          <dd>{formatDate(invoice.issueDate)}</dd>
          {invoice.dueDate ? (
            <>
              <dt>Due</dt>
              <dd>{formatDate(invoice.dueDate)}</dd>
            </>
          ) : null}
        </dl>
        <span className={`inv__status inv__status--${invoice.status}`}>{STATUS_LABEL[invoice.status]}</span>
      </div>
    </div>
  )

  return (
    <div className={`inv inv--${invoice.template}`} ref={ref}>
      {invoice.template === 'classic' ? <div className="inv__band">{header}</div> : header}

      <div className="inv__parties">
        <div>
          <p className="inv__eyebrow">Billed to</p>
          <p className="inv__party-name">{client.name || 'Client name'}</p>
          <Lines text={clientLines} className="inv__party-lines" />
        </div>
        {invoice.template !== 'classic' && businessLines ? (
          <div>
            <p className="inv__eyebrow">From</p>
            <p className="inv__party-name">{business.name || 'Your business name'}</p>
            <Lines text={businessLines} className="inv__party-lines" />
          </div>
        ) : (
          <div />
        )}
      </div>

      <table className="inv__items">
        <thead>
          <tr>
            <th className="inv__row-index">#</th>
            <th>Description</th>
            <th className="inv__num">Qty</th>
            <th className="inv__rate">Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.length === 0 ? (
            <tr>
              <td className="inv__row-index">1</td>
              <td className="inv__item-desc">Item description</td>
              <td className="inv__num">1</td>
              <td className="inv__rate">{money(0)}</td>
              <td>{money(0)}</td>
            </tr>
          ) : (
            invoice.items.map((item, i) => (
              <tr key={item.id}>
                <td className="inv__row-index">{i + 1}</td>
                <td className="inv__item-desc">{item.description || 'Item description'}</td>
                <td className="inv__num">{item.qty}</td>
                <td className="inv__rate">{money(item.rate)}</td>
                <td>{money((Number(item.qty) || 0) * (Number(item.rate) || 0))}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="inv__bottom">
        <div className="inv__blocks">
          {invoice.paymentDetails.trim() ? (
            <div className="inv__block inv__pay">
              <p className="inv__block-title">Payment details</p>
              <p>{invoice.paymentDetails}</p>
            </div>
          ) : null}
          {invoice.notes.trim() ? (
            <div className="inv__block">
              <p className="inv__block-title">Notes</p>
              <p>{invoice.notes}</p>
            </div>
          ) : null}
          {invoice.terms.trim() ? (
            <div className="inv__block">
              <p className="inv__block-title">Terms</p>
              <p>{invoice.terms}</p>
            </div>
          ) : null}
        </div>

        <div>
          <div className="inv__totals">
            <div>
              <span>Subtotal</span>
              <span>{money(totals.subtotal)}</span>
            </div>
            {totals.discountValue > 0 ? (
              <div>
                <span>Discount{invoice.discountType === 'percent' ? ` (${invoice.discount}%)` : ''}</span>
                <span>−{money(totals.discountValue)}</span>
              </div>
            ) : null}
            {invoice.taxRate > 0 ? (
              <div>
                <span>Tax ({invoice.taxRate}%)</span>
                <span>{money(totals.taxValue)}</span>
              </div>
            ) : null}
            {Number(invoice.shipping) > 0 ? (
              <div>
                <span>Shipping</span>
                <span>{money(Number(invoice.shipping))}</span>
              </div>
            ) : null}
            <div className="inv__total-row">
              <span>Total due</span>
              <span>{money(totals.total)}</span>
            </div>
          </div>

          {invoice.signature || invoice.signatureName ? (
            <div className="inv__sign">
              {invoice.signature ? (
                <img src={invoice.signature} alt="" />
              ) : (
                <p className="inv__sign-script">{invoice.signatureName}</p>
              )}
              <p className="inv__sign-line">{invoice.signatureName || 'Authorised signature'}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="inv__foot">
        <span className="inv__thanks">Thank you for your business</span>
        <span>{[business.name, business.email, business.phone].filter(Boolean).join(' · ')}</span>
      </div>
    </div>
  )
})

export default InvoiceDocument
