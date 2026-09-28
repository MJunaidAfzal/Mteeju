// Download an invoice as PDF (through the browser's print dialog), PNG or a standalone HTML file.
import { toPng } from 'html-to-image'
import invoiceCss from '../components/InvoiceDocument.css?raw'
import type { Invoice } from './invoices'

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

/** Opens the print dialog, where "Save as PDF" produces a true A4 PDF with selectable text. */
export function printInvoice() {
  window.print()
}

export async function downloadPng(node: HTMLElement, invoice: Invoice) {
  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    width: node.offsetWidth,
    height: node.offsetHeight,
    style: { margin: '0' },
  })
  save(dataUrl, fileName(invoice, 'png'))
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
