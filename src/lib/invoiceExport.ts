// Download an invoice as PDF, PNG or a standalone HTML file, or send it to the printer.
import { toPng } from 'html-to-image'
import { jsPDF } from 'jspdf'
import invoiceCss from '../components/InvoiceDocument.css?raw'
import type { Invoice } from './invoices'

const A4 = { width: 210, height: 297 }

export function fileName(invoice: Invoice, extension: string) {
  const parts = [invoice.number, invoice.client.name].filter(Boolean).join('-')
  const clean = parts.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return `${clean || 'invoice'}.${extension}`
}

function save(href: string, name: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.click()
}

function snapshot(node: HTMLElement) {
  // Use the invoice's own paper colour — a fixed white here would cover dark designs
  const own = getComputedStyle(node).backgroundColor
  const paper = own && own !== 'transparent' && !own.startsWith('rgba(0, 0, 0, 0') ? own : '#ffffff'
  return toPng(node, {
    pixelRatio: 2,
    backgroundColor: paper,
    width: node.offsetWidth,
    height: node.offsetHeight,
    style: { margin: '0' },
  })
}

/**
 * Builds the PDF from a picture of the invoice, so it looks exactly like the preview —
 * dark designs included, whatever the browser's print settings are.
 */
export async function downloadPdf(node: HTMLElement, invoice: Invoice) {
  const dataUrl = await snapshot(node)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  const { width, height } = pdf.getImageProperties(dataUrl)
  const pageHeight = (A4.width * height) / width

  pdf.addImage(dataUrl, 'PNG', 0, 0, A4.width, pageHeight, undefined, 'FAST')
  // Long invoices continue on further pages
  let printed = A4.height
  while (printed < pageHeight - 1) {
    pdf.addPage()
    pdf.addImage(dataUrl, 'PNG', 0, -printed, A4.width, pageHeight, undefined, 'FAST')
    printed += A4.height
  }
  pdf.save(fileName(invoice, 'pdf'))
}

/** The browser's own print window: sharp, selectable text (dark designs need "Background graphics" ticked). */
export function printInvoice() {
  window.print()
}

export async function downloadPng(node: HTMLElement, invoice: Invoice) {
  save(await snapshot(node), fileName(invoice, 'png'))
}

export function downloadHtml(node: HTMLElement, invoice: Invoice) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${invoice.number} — ${invoice.client.name || 'Invoice'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
body { margin: 0; padding: 24px; background: #f1efe9; display: flex; justify-content: center; }
@media print { body { padding: 0; background: #fff; } }
${invoiceCss}
</style>
</head>
<body>
${node.outerHTML}
</body>
</html>`
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  save(url, fileName(invoice, 'html'))
  URL.revokeObjectURL(url)
}
