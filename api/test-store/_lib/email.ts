export interface OrderEmailItem {
  name: string
  quantity: number
  unit_amount: number
  amount_total: number
}

export interface OrderEmailData {
  id: string
  stripe_session_id: string
  currency: string
  amount_total: number
  fulfillment_status: string
  customer_name: string | null
  customer_email: string | null
  created_at: string
  items: OrderEmailItem[]
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

/** Customer-supplied strings (name, product text) go into HTML, so everything is escaped. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function buildOrderEmail(order: OrderEmailData) {
  const shortId = order.id.slice(0, 8)
  const total = formatMoney(order.amount_total, order.currency)
  const subject = `[TEST] New order #${shortId} — ${total}`

  const rowsHtml = order.items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb">${escapeHtml(i.name)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${i.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right">${formatMoney(i.amount_total, order.currency)}</td>
      </tr>`,
    )
    .join('')

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0D1B2E">
    <p style="background:#fff4d6;border:1px solid #e6c766;padding:8px 12px;border-radius:6px;font-size:13px">
      <strong>TEST MODE</strong> — this order was paid with a Stripe sandbox card. No real money moved.</p>
    <h2 style="margin:16px 0 4px">New order #${shortId}</h2>
    <p style="margin:0 0 16px;color:#52607a;font-size:14px">${escapeHtml(order.customer_name ?? 'Customer')}${order.customer_email ? ` · ${escapeHtml(order.customer_email)}` : ''}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr>
        <th style="text-align:left;padding-bottom:6px;color:#52607a">Product</th>
        <th style="padding:0 12px 6px;color:#52607a">Qty</th>
        <th style="text-align:right;padding-bottom:6px;color:#52607a">Amount</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr>
        <td colspan="2" style="padding-top:12px;font-weight:bold">Total</td>
        <td style="padding-top:12px;text-align:right;font-weight:bold">${total}</td>
      </tr></tfoot>
    </table>
    <p style="margin-top:20px;font-size:14px"><strong>Fulfillment status:</strong> ${escapeHtml(order.fulfillment_status)}</p>
    <p style="font-size:12px;color:#7e8da0">Stripe session ${escapeHtml(order.stripe_session_id)}</p>
  </div>`

  const text = [
    'TEST MODE — paid with a Stripe sandbox card. No real money moved.',
    '',
    `New order #${shortId}`,
    `Customer: ${order.customer_name ?? 'Customer'}${order.customer_email ? ` <${order.customer_email}>` : ''}`,
    '',
    ...order.items.map((i) => `- ${i.name} × ${i.quantity} — ${formatMoney(i.amount_total, order.currency)}`),
    '',
    `Total: ${total}`,
    `Fulfillment status: ${order.fulfillment_status}`,
    `Stripe session: ${order.stripe_session_id}`,
  ].join('\n')

  return { subject, html, text }
}
