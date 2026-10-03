import type { Cart, CheckoutResult } from '../engine'
import { GoCommerceError, NotSupportedError } from '../errors'
import { toEngineAddress, toOrder } from '../map'
import { minorToMajor } from '../money'
import {
	cartExtras,
	placedOrderByReference,
	rememberOrder,
	saveCartExtras,
	sessionToken,
	storedCartId,
} from '../browser'
import { BaseService } from './base.service'

/**
 * Placing an order.
 *
 * The engine turns a cart into an order in one call, `POST /api/checkout/{code}`,
 * and that call is the only thing that moves stock and asks for money. It takes
 * the address, phone and delivery choice in its body — the cart keeps none of
 * them — so they are read back from what the address step stored (browser.ts).
 *
 * Payment is confirmed by the gateway's webhook to the engine, never by the
 * storefront. So the "capture" calls the storefront makes after a gateway's
 * modal closes do not capture anything: they hand back the order number, and
 * the order page shows `payment_status` once the webhook has landed.
 */
export class CheckoutService extends BaseService {
	/** Delivery options for the address on the cart: `{ data: [{ id, name, base_rate }] }`. */
	async getShippingRates({ cartId }: { cartId?: string } = {}) {
		const id = cartId || storedCartId()
		const ship = id ? cartExtras(id).shippingAddress : null
		const country = String(ship?.countryCode || ship?.country || '').toUpperCase()
		if (!id || !country) return { data: [] }
		const quote = await this.data<{
			rates: { rate_id: number; name: string; price: { amount_minor: number; currency: string } }[] | null
			currency: string
		}>('/api/checkout/rates', { query: { cart: id, country, state: ship?.state ? String(ship.state) : undefined } })
		return {
			data: (quote.rates ?? []).map((r) => ({
				id: String(r.rate_id),
				name: r.name,
				description: null,
				base_rate: minorToMajor(r.price.amount_minor, r.price.currency),
				price: minorToMajor(r.price.amount_minor, r.price.currency),
				currencyCode: r.price.currency,
				// The engine's rates carry no delivery estimate; none is made up.
				estimated_min_days: null,
				estimated_max_days: null,
			})),
		}
	}

	/** Cash on delivery: the order is confirmed at once and paid on the doorstep. */
	async checkoutCOD({ cartId }: { cartId?: string; origin?: string } = {}) {
		const result = await this.place('cod', cartId)
		return {
			order_no: result.order.number,
			orderNo: result.order.number,
			id: String(result.order.id),
			status: result.order.status,
		}
	}

	/**
	 * Razorpay's modal. The engine has already created the Razorpay order; this
	 * hands the storefront what the modal needs. A store running Razorpay's
	 * hosted (redirect) mode cannot be driven from this storefront's modal flow,
	 * and says so rather than opening a modal on an order it cannot pay.
	 */
	async checkoutRazorpay({ cartId }: { cartId?: string; origin?: string } = {}) {
		const result = await this.place('razorpay', cartId)
		const data = result.payment.client_data ?? {}
		if (result.payment.kind !== 'client_action' || !data.razorpay_order_id) {
			throw new GoCommerceError(
				'This store takes Razorpay payments on Razorpay’s own page, which this storefront does not support yet.',
				0,
			)
		}
		return {
			order_no: result.order.number,
			id: data.razorpay_order_id,
			key_id: data.key_id,
			amount: Number(data.amount),
			currency: data.currency,
		}
	}

	/** The modal closed with a payment. The engine learns of it from Razorpay itself. */
	async captureRazorpayPayment({ razorpay_order_id }: { razorpay_order_id: string; razorpay_payment_id?: string }) {
		const order = placedOrderByReference(razorpay_order_id)
		if (!order) throw new GoCommerceError('That payment does not belong to an order placed from this browser.', 404)
		return { order_no: order.number, status: 'processing' }
	}

	// The family's other gateway flows. GoCommerce's Stripe is a Payment
	// Element (a client secret, not a hosted page) — `checkout('stripe')` returns
	// that secret for a storefront that mounts the element. Cashfree, PhonePe and
	// Affirm are not engine gateways at all. paymentMethodService never offers
	// these codes, so they are reached only by a storefront that hard-codes one.
	async checkoutStripe(): Promise<never> {
		throw unsupported(
			'checkoutStripe',
			'GoCommerce’s Stripe gateway uses the Payment Element, not a hosted checkout page',
		)
	}
	async checkoutStripeCapture(): Promise<never> {
		throw unsupported('checkoutStripeCapture', 'Stripe confirms payments to the engine by webhook')
	}
	/**
	 * The storefront's generic redirect flow, which it reaches through the code
	 * `PAYPAL`. The engine has no PayPal gateway; paymentMethodService puts the
	 * store's first hosted-page gateway — Adyen, Paddle, Lemon Squeezy, Creem,
	 * Hyperswitch or RevenueCat — under that code, with its own name and a
	 * neutral icon, because this is the one storefront flow that sends a shopper
	 * to a URL and back. The shopper returns to the success page; the gateway's
	 * webhook tells the engine the order is paid.
	 */
	async checkoutPaypal({ cartId, origin }: { cartId?: string; origin?: string; return_url?: string } = {}) {
		const gateway = await this.redirectGateway()
		if (!gateway) throw unsupported('checkoutPaypal', 'this store has no hosted-page payment gateway switched on')
		const id = cartId || storedCartId() || ''
		const back = origin ? `${origin.replace(/\/+$/, '')}/checkout/success?cart_id=${encodeURIComponent(id)}` : undefined
		const result = await this.place(gateway, id, back ? { return_url: back } : {})
		const url = result.payment.client_data?.url
		if (!url) throw new GoCommerceError('The payment page did not open. Please try again.', 502)
		return { redirect_url: url, order_no: result.order.number }
	}

	/**
	 * Nothing to capture: a hosted-page gateway confirms the payment to the
	 * engine by webhook. Answering, rather than throwing, sends the storefront's
	 * process page on to the success page instead of the failure page.
	 */
	async capturePaypalPayment({
		order_no,
	}: { order_no?: string; token?: string; PayerID?: string; storeId?: string } = {}) {
		return { order_no: order_no ?? null, status: 'processing' }
	}
	async checkoutCashfree(): Promise<never> {
		throw unsupported('checkoutCashfree', 'the engine has no Cashfree gateway')
	}
	async captureCashfreePayment(): Promise<never> {
		throw unsupported('captureCashfreePayment', 'the engine has no Cashfree gateway')
	}
	async checkoutPhonepe(): Promise<never> {
		throw unsupported('checkoutPhonepe', 'the engine has no PhonePe gateway')
	}
	async createAffirmPayOrder(): Promise<never> {
		throw unsupported('createAffirmPayOrder', 'the engine has no Affirm gateway')
	}
	async confirmAffirmOrder(): Promise<never> {
		throw unsupported('confirmAffirmOrder', 'the engine has no Affirm gateway')
	}
	async cancelAffirmOrder(): Promise<never> {
		throw unsupported('cancelAffirmOrder', 'the engine has no Affirm gateway')
	}
	async checkoutPOS(): Promise<never> {
		throw unsupported('checkoutPOS', 'point-of-sale orders are placed from the admin panel')
	}

	/**
	 * Any payment method the engine has switched on, by its engine code —
	 * `cod`, `stripe`, `razorpay`, `adyen`, `paddle`, `helcim`… For a storefront
	 * that drives the payment itself: the answer says what to do next.
	 *
	 * - `kind: 'none'` — nothing to pay now (cash on delivery).
	 * - `kind: 'client_action'` — mount the gateway's own widget with
	 *   `clientData`: Stripe's Payment Element takes `clientSecret`, Razorpay's
	 *   modal `razorpay_order_id` and `key_id`, Helcim's `checkout_token`.
	 * - `kind: 'redirect'` — send the shopper to `redirectUrl`; `returnUrl` is
	 *   where the gateway brings them back.
	 *
	 * Either way the gateway's webhook tells the engine when the money arrives;
	 * read `orderService.getOrder(orderNo).paymentStatus` to see it.
	 */
	async checkout(
		code: string,
		{
			cartId,
			returnUrl,
			paymentData,
			metadata,
		}: {
			cartId?: string
			returnUrl?: string
			paymentData?: Record<string, string>
			metadata?: Record<string, unknown>
		} = {},
	) {
		const result = await this.place(String(code).toLowerCase(), cartId, {
			...(returnUrl ? { return_url: returnUrl } : {}),
			...(paymentData ? { payment_data: paymentData } : {}),
			...(metadata ? { metadata } : {}),
		})
		const data = result.payment.client_data ?? {}
		return {
			orderNo: result.order.number,
			order: toOrder(result.order),
			payment: {
				kind: result.payment.kind,
				provider: result.payment.provider,
				reference: result.payment.reference ?? null,
				clientSecret: data.client_secret ?? null,
				redirectUrl: data.url ?? null,
				clientData: data,
			},
		}
	}

	/** Every payment method the engine has switched on, by engine code and name — drivable here or not. */
	async listMethods() {
		const options = await this.data<{ methods: { code: string; name: string }[] | null; currency: string }>(
			'/api/checkout',
		)
		return { methods: options.methods ?? [], currency: options.currency }
	}

	private async redirectGateway(): Promise<string | undefined> {
		const { methods } = await this.listMethods()
		return methods.find((m) => REDIRECT_GATEWAYS.has(m.code))?.code
	}

	/**
	 * One checkout attempt.
	 *
	 * The Idempotency-Key is kept with the cart and reused while the request is
	 * the same, because a payment gateway that fails after the engine has
	 * created the order leaves the cart converted: only a retry under the same
	 * key resumes that order, and without one the shopper is stuck. A changed
	 * request — a different address, a different method — gets a new key, since
	 * the engine refuses a key replayed with a different body.
	 */
	private async place(
		code: string,
		cartId?: string,
		extra: { return_url?: string; payment_data?: Record<string, string>; metadata?: Record<string, unknown> } = {},
	): Promise<CheckoutResult> {
		const id = cartId || storedCartId()
		if (!id) throw new GoCommerceError('Your bag is empty.', 400)
		const extras = cartExtras(id)
		const ship = extras.shippingAddress
		if (!ship) throw new GoCommerceError('Add a delivery address first.', 400)

		const cart = await this.data<Cart>(`/api/carts/${encodeURIComponent(id)}`)
		const email = cart.email || (ship.email ? String(ship.email) : '')
		if (!email) throw new GoCommerceError('Add an email address so we can send your receipt.', 400)
		const address = toEngineAddress(ship)
		const body = {
			cart_id: id,
			email,
			...(extras.phone || address.phone ? { phone: String(extras.phone || address.phone) } : {}),
			...(address.name ? { name: address.name } : {}),
			address,
			...(extras.shippingRateId ? { shipping_rate_id: Number(extras.shippingRateId) } : {}),
			...extra,
		}
		const serialised = JSON.stringify(body)
		const key = extras.attempt?.body === `${code}:${serialised}` ? extras.attempt.key : newKey()
		saveCartExtras(id, { attempt: { key, body: `${code}:${serialised}` } })

		const result = await this.data<CheckoutResult>(`/api/checkout/${encodeURIComponent(code)}`, {
			method: 'POST',
			body,
			headers: { 'Idempotency-Key': key },
		})

		// The access token is returned once; a replayed response leaves it out,
		// so a replay must not overwrite the one already kept.
		if (result.order.access_token) {
			rememberOrder({
				number: result.order.number,
				token: result.order.access_token,
				cartId: id,
				reference: result.payment.client_data?.razorpay_order_id ?? result.payment.reference,
			})
			// A signed-in shopper's order joins their account. The engine never
			// links an order by email, so this call is the only way it appears
			// under "My orders".
			if (sessionToken()) {
				await this.engine('/x/identity/me/orders', {
					method: 'POST',
					body: { number: result.order.number, token: result.order.access_token },
					auth: true,
				}).catch(() => undefined)
			}
		}
		saveCartExtras(id, { attempt: null })
		return result
	}
}

/** The engine's gateways that take payment on their own hosted page. */
export const REDIRECT_GATEWAYS = new Set(['adyen', 'paddle', 'lemonsqueezy', 'creem', 'hyperswitch', 'revenuecat'])

const unsupported = (method: string, why: string) => new NotSupportedError('CheckoutService', method, why)

function newKey(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
	if (c?.randomUUID) return c.randomUUID()
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export const checkoutService = new CheckoutService()
