import type { AppliedDiscount, Cart, CartLine, Product } from '../engine'
import { GoCommerceError, NotSupportedError } from '../errors'
import { emptyCart, toCart } from '../map'
import { remember } from '../cache'
import {
	cartExtras,
	forgetCartExtras,
	rememberCartId,
	saveCartExtras,
	sessionToken,
	storedCartId,
	type StorefrontAddress,
} from '../browser'
import { BaseService } from './base.service'
import { StoreFacts } from './facts'

/** The storefront's "take this line out" sentinel, sent when − is pressed on a quantity of one. */
const REMOVE = -9999999

/**
 * The bag.
 *
 * The engine's cart is addressed by an opaque token it mints, held by the
 * storefront in `localStorage.cart_id`. It keeps lines and an email; the
 * coupon, the address and the delivery choice the storefront collects before
 * checkout are kept beside it in the browser (browser.ts) and sent with the
 * checkout request, which is the only place the engine takes them.
 *
 * Every method answers the whole cart, as the storefront assigns it whole.
 */
export class CartService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	async getCartByCartId(cartId?: string | null) {
		const id = clean(cartId)
		if (!id) return emptyCart(await this.currency())
		try {
			return await this.present(await this.data<Cart>(`/api/carts/${encodeURIComponent(id)}`))
		} catch (err) {
			// A cart expires after a month untouched. A shopper coming back to a
			// dead token sees an empty bag, not an error.
			if (err instanceof GoCommerceError && err.status === 404) return emptyCart(await this.currency())
			throw err
		}
	}

	async fetchCartData(cartId?: string | null) {
		return this.getCartByCartId(cartId ?? storedCartId())
	}

	/**
	 * The cart after an order: the engine marks it `converted` and keeps its
	 * lines, and this answers it with none — which is how the storefront knows
	 * to clear the bag on the success page.
	 */
	async refereshCart() {
		const id = storedCartId()
		const cart = await this.getCartByCartId(id)
		if (id && (cart as { status?: string }).status === 'converted') forgetCartExtras(id)
		return cart
	}

	/**
	 * `qty` is a change, not a total: +1 from a product page, −1 from a card's
	 * minus button. With no cart yet, one is opened and remembered.
	 */
	async addToCart({
		cartId,
		lineId,
		qty = 1,
		variantId,
	}: {
		cartId?: string | null
		lineId?: string | null
		qty?: number
		productId?: string
		variantId?: string
	}) {
		let id = clean(cartId) ?? storedCartId()
		if (lineId && id) {
			const cart = await this.data<Cart>(`/api/carts/${encodeURIComponent(id)}`)
			const line = (cart.line_items ?? []).find((l) => String(l.id) === String(lineId))
			if (line) {
				const next = qty === REMOVE ? 0 : line.quantity + Number(qty)
				return this.setQuantity(id, line.id, next)
			}
		}
		if (qty === REMOVE || Number(qty) <= 0) return this.getCartByCartId(id)
		if (!variantId) throw new GoCommerceError('Please choose an option before adding this to your bag.', 400)
		if (!id) id = await this.open()
		try {
			return await this.present(
				await this.data<Cart>(`/api/carts/${encodeURIComponent(id)}/line-items`, {
					method: 'POST',
					body: { variant_id: Number(variantId), quantity: Number(qty) },
				}),
			)
		} catch (err) {
			// The remembered cart was checked out in another tab, or expired.
			// Start a new one rather than refusing the shopper's click.
			if (err instanceof GoCommerceError && (err.status === 404 || /checked out/.test(err.message))) {
				const fresh = await this.open()
				return this.present(
					await this.data<Cart>(`/api/carts/${encodeURIComponent(fresh)}/line-items`, {
						method: 'POST',
						body: { variant_id: Number(variantId), quantity: Number(qty) },
					}),
				)
			}
			throw err
		}
	}

	/** `qty` is the new total; 0 takes the line out. */
	async updateCart({
		cartId,
		lineId,
		qty,
	}: {
		cartId?: string
		lineId: string
		qty: number
		isSelectedForCheckout?: boolean
	}) {
		const id = clean(cartId) ?? storedCartId()
		if (!id) return emptyCart(await this.currency())
		return this.setQuantity(id, lineId, Number(qty))
	}

	async removeCart({ cartId, lineId }: { cartId?: string; lineId: string }) {
		const id = clean(cartId) ?? storedCartId()
		if (!id) return emptyCart(await this.currency())
		return this.present(
			await this.data<Cart>(`/api/carts/${encodeURIComponent(id)}/line-items/${encodeURIComponent(String(lineId))}`, {
				method: 'DELETE',
			}),
		)
	}

	/**
	 * Contact details and addresses, from the checkout's address step. The
	 * email goes to the engine — it is how an abandoned cart is followed up —
	 * and the rest is kept for the checkout request.
	 */
	async updateCart2(args: {
		cartId?: string
		email?: string
		phone?: string
		shippingAddress?: StorefrontAddress | null
		billingAddress?: StorefrontAddress | null
		isBillingAddressSameAsShipping?: boolean
	}) {
		const id = clean(args.cartId) ?? storedCartId()
		if (!id) return emptyCart(await this.currency())

		const patch: Parameters<typeof saveCartExtras>[1] = {}
		if (args.phone !== undefined) patch.phone = args.phone || undefined
		if (args.shippingAddress !== undefined) {
			patch.shippingAddress = args.shippingAddress
			if (args.shippingAddress?.phone && !patch.phone) patch.phone = String(args.shippingAddress.phone)
		}
		if (args.billingAddress !== undefined || args.isBillingAddressSameAsShipping) {
			patch.billingAddress = args.isBillingAddressSameAsShipping ? null : (args.billingAddress ?? null)
		}
		// A new destination may not be served by the rate chosen for the old one.
		const before = cartExtras(id)
		const country = (a?: StorefrontAddress | null) => String(a?.countryCode || a?.country || '').toUpperCase()
		if (args.shippingAddress !== undefined && country(args.shippingAddress) !== country(before.shippingAddress)) {
			patch.shippingRateId = null
			patch.shippingRate = null
		}
		saveCartExtras(id, patch)

		const email = args.email ?? (args.shippingAddress?.email ? String(args.shippingAddress.email) : undefined)
		if (email !== undefined) {
			return this.present(
				await this.data<Cart>(`/api/carts/${encodeURIComponent(id)}/email`, { method: 'PUT', body: { email } }),
			)
		}
		return this.getCartByCartId(id)
	}

	/**
	 * A discount code. The engine prices it against the basket now and decides
	 * it again at checkout; what it answers is kept so the bag can show it,
	 * because the cart itself does not carry the code.
	 */
	async applyCoupon({ cartId, couponCode }: { cartId?: string; couponCode: string }) {
		const id = clean(cartId) ?? storedCartId()
		if (!id) throw new GoCommerceError('Add something to your bag before applying a code.', 400)
		const cart = await this.data<Cart>(`/api/carts/${encodeURIComponent(id)}`)
		const discount = await this.data<AppliedDiscount>(`/api/carts/${encodeURIComponent(id)}/discount`, {
			method: 'PUT',
			body: { code: String(couponCode ?? '').trim(), ...(cart.email ? { email: cart.email } : {}) },
		})
		saveCartExtras(id, { discount: { ...discount, code: discount.code || String(couponCode).trim() } })
		return this.present(cart)
	}

	async removeCoupon(cartId?: string) {
		const id = clean(cartId) ?? storedCartId()
		if (!id) return emptyCart(await this.currency())
		await this.engine(`/api/carts/${encodeURIComponent(id)}/discount`, { method: 'DELETE' })
		saveCartExtras(id, { discount: null })
		return this.getCartByCartId(id)
	}

	/** The delivery option the shopper picked, priced from the engine's own quote. */
	async updateShippingRate({ cartId, shippingRateId }: { cartId?: string; shippingRateId: string }) {
		const id = clean(cartId) ?? storedCartId()
		if (!id) return emptyCart(await this.currency())
		const ship = cartExtras(id).shippingAddress
		const country = String(ship?.countryCode || ship?.country || '').toUpperCase()
		if (!country) throw new GoCommerceError('Add a delivery address first.', 400)
		const quote = await this.data<{
			rates: { rate_id: number; name: string; price: { amount_minor: number; currency: string } }[] | null
			currency: string
		}>('/api/checkout/rates', { query: { cart: id, country, state: ship?.state ? String(ship.state) : undefined } })
		const rate = (quote.rates ?? []).find((r) => String(r.rate_id) === String(shippingRateId))
		if (!rate) throw new GoCommerceError('That delivery option is not available for this address any more.', 409)
		saveCartExtras(id, {
			shippingRateId: String(rate.rate_id),
			shippingRate: {
				id: String(rate.rate_id),
				name: rate.name,
				minor: rate.price.amount_minor,
				currency: rate.price.currency,
			},
		})
		return this.getCartByCartId(id)
	}

	/** The payment method is chosen at checkout, by which checkout route is called. */
	async updateCartPaymentMethod({ cartId }: { cartId?: string; paymentMethod?: string }) {
		return this.getCartByCartId(clean(cartId) ?? storedCartId())
	}

	async completeCart(): Promise<never> {
		throw new NotSupportedError('CartService', 'completeCart', 'an order is placed through checkoutService')
	}

	// ------------------------------------------------------------ internals

	private async setQuantity(cartId: string, lineId: string | number, qty: number) {
		const path = `/api/carts/${encodeURIComponent(cartId)}/line-items/${encodeURIComponent(String(lineId))}`
		// Zero is a removal: the engine accepts it on PATCH, and DELETE says it plainly.
		if (qty <= 0) return this.present(await this.data<Cart>(path, { method: 'DELETE' }))
		return this.present(await this.data<Cart>(path, { method: 'PATCH', body: { quantity: qty } }))
	}

	/** A new cart, remembered — and priced for the signed-in shopper's group when the engine allows it. */
	private async open(): Promise<string> {
		const channel = this.creds.channel
		const cart = await this.data<Cart>('/api/carts', { method: 'POST', ...(channel ? { body: { channel } } : {}) })
		rememberCartId(cart.id)
		if (sessionToken()) await this.claimCartForAccount(cart.id)
		return cart.id
	}

	private async currency(): Promise<string> {
		try {
			return (await this.facts.ready()).currency
		} catch {
			return 'USD'
		}
	}

	/** The engine's cart with the browser-held extras and each line's picture and link. */
	private async present(cart: Cart) {
		const ids = [...new Set((cart.line_items ?? []).map((l) => l.product_id))]
		const products = new Map<number, Product | null>()
		await Promise.all(
			ids.map(async (pid) => {
				products.set(pid, await this.productFor(pid))
			}),
		)
		return toCart(cart, cartExtras(cart.id), (l: CartLine) => {
			const p = products.get(l.product_id)
			if (!p) return {}
			const v = (p.variants ?? []).find((x) => x.id === l.variant_id)
			return { slug: p.slug, thumbnail: v?.image?.url ?? p.image_url ?? null }
		})
	}

	private productFor(id: number): Promise<Product | null> {
		return remember(`${this.engineBase()}|product|${id}`, () =>
			this.data<Product>(`/api/products/${id}`).catch(() => null),
		)
	}
}

const clean = (id?: string | null): string | null => (id && id !== 'undefined' && id !== 'null' ? id : null)

export const cartService = new CartService()
