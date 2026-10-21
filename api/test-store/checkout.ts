import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getStripe } from './_lib/clients'
import { ConfigError, siteUrl } from './_lib/env'
import { errorMessage, json, log, methodNotAllowed } from './_lib/http'
import { PRODUCTS } from './_lib/products'

/**
 * POST /api/test-store/checkout   { productId, quantity }
 * Creates a Stripe Checkout Session (sandbox) and returns its hosted URL. The browser never sees a secret key,
 * and the price comes from the server-side catalog, not from the request.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  // Kill switch: the sandbox store does nothing until you explicitly turn it on (and you can turn it off again).
  if (process.env.TEST_STORE_ENABLED !== 'true') return json(res, 503, { error: 'checkout_unavailable' })

  const productId = String(req.body?.productId ?? '')
  const quantity = Number(req.body?.quantity ?? 1)
  const product = PRODUCTS[productId]
  if (!product) return json(res, 400, { error: 'unknown_product' })
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.maxQuantity) {
    return json(res, 400, { error: 'invalid_quantity', max: product.maxQuantity })
  }

  try {
    const stripe = getStripe() // throws unless the key is a sk_test_ / rk_test_ key
    const base = siteUrl(req.headers.host)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity,
          price_data: {
            currency: product.currency,
            unit_amount: product.unitAmount,
            product_data: { name: product.name, description: product.description },
          },
        },
      ],
      shipping_address_collection: { allowed_countries: ['US'] },
      // This flag is how the webhook recognises test-store sessions and ignores everything else.
      metadata: { test_store: 'true', product_id: product.id },
      success_url: `${base}/test-store?status=success`,
      cancel_url: `${base}/test-store?status=cancelled`,
    })
    log('info', 'checkout session created', { sessionId: session.id, productId: product.id, quantity })
    return json(res, 200, { url: session.url })
  } catch (err) {
    log('error', 'checkout failed', { error: errorMessage(err) })
    // Config problems are the owner's to fix; don't leak details to visitors.
    return json(res, err instanceof ConfigError ? 503 : 502, { error: 'checkout_unavailable' })
  }
}
