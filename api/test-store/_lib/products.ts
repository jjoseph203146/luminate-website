/**
 * The catalog lives on the server on purpose: the browser only ever sends a product id and a
 * quantity, so a visitor cannot change the price.
 */
export interface Product {
  id: string
  name: string
  description: string
  currency: 'usd'
  unitAmount: number // cents
  maxQuantity: number
}

export const PRODUCTS: Record<string, Product> = {
  'studio-tote': {
    id: 'studio-tote',
    name: 'Luminate Studio Tote (TEST PRODUCT)',
    description: 'A sample product used to test the order-notification workflow. Not a real item.',
    currency: 'usd',
    unitAmount: 2500,
    maxQuantity: 10,
  },
}
