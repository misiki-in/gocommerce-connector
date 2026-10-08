import type { DigitalDownload, Order, Product } from '../engine'
import { GoCommerceError, NotSupportedError } from '../errors'
import { toOrder } from '../map'
import { toMajor } from '../money'
import { inBrowser, placedOrder, placedOrderForCart, rememberOrder, sessionToken } from '../browser'
import { BaseService, emptyPage, mediaUrl, toPage } from './base.service'

/**
 * The gateways whose webhook a store sets up by hand, so it can be missing. An order still pending
 * is later cancelled with no word to the gateway, and a paid one would go with it, so reading an
 * order this browser placed asks the gateway too. The engine limits how often it passes that on.
 * PayPal's route also captures a payment the shopper approved, which is the webhook's job otherwise.
 */
const VERIFY: Record<string, (reference: string) => string> = {
	paystack: (r) => `/x/payments-paystack/transactions/${r}/verify`,
	flutterwave: (r) => `/x/payments-flutterwave/transactions/${r}/verify`,
	cashfree: (r) => `/x/payments-cashfree/orders/${r}/verify`,
	paypal: (r) => `/x/payments-paypal/orders/${r}/capture`,
}

/**
 * Orders, read back two ways.
 *
 * A guest's order is read with the access token checkout returned, which this
 * connector kept in the browser that placed it (`GET /api/orders/{n}?token=`).
 * A signed-in shopper's orders are the ones joined to their account
 * (ext/identity's `/me/orders`). There is no third way: an order list that
 * answered without either would be every order in the shop.
 */
export class OrderService extends BaseService {
	/**
	 * The order-success page's lookup, by the number and cart in its URL.
	 *
	 * It runs on the server, where neither the token nor the session exists —
	 * they live in the shopper's browser — so there it answers nothing and the
	 * page says the details are not available yet. In the browser it answers
	 * the order. Inventing a server-side credential from the cart token in the
	 * URL would make that URL, which lands in history and referrers, a key to
	 * the shopper's address.
	 */
	async listOrdersByParent({ orderNo, cartId }: { orderNo?: string; cartId?: string } = {}) {
		const number = clean(orderNo) ?? (clean(cartId) ? placedOrderForCart(clean(cartId) as string)?.number : undefined)
		if (!number) return { data: [] }
		try {
			return { data: [await this.getOrder(number)] }
		} catch (err) {
			if (err instanceof GoCommerceError && (err.status === 404 || err.status === 401)) return { data: [] }
			throw err
		}
	}

	/** The signed-in shopper's orders, newest claim first. */
	async list({ page = 1, limit = 20 }: { page?: number; limit?: number; q?: string; sort?: string } = {}) {
		const env = await this.engine<Order[] | null>('/x/identity/me/orders', { query: { page, limit }, auth: true })
		return toPage(env, toOrder)
	}

	/** One order by number: the account's when signed in, otherwise one this browser placed. */
	async getOrder(number: string) {
		const kept = placedOrder(number)
		if (kept) {
			const read = () => this.data<Order>(`/api/orders/${encodeURIComponent(number)}`, { query: { token: kept.token } })
			const order = await read()
			const verify = VERIFY[order.payment_provider]
			if (!verify || !kept.reference || !['pending', 'failed'].includes(order.payment_status)) {
				return this.withInvoice(order, kept.token)
			}
			// A failed check leaves the order as it read; the webhook may still settle it.
			const checked = await this.data<{ payment_status: string }>(verify(encodeURIComponent(kept.reference)), {
				method: 'POST',
			}).catch(() => null)
			return this.withInvoice(checked && checked.payment_status !== order.payment_status ? await read() : order, kept.token)
		}
		if (sessionToken()) {
			const order = await this.data<Order>(`/x/identity/me/orders/${encodeURIComponent(number)}`, { auth: true })
			return this.withInvoice(order, order.access_token)
		}
		throw new GoCommerceError(
			inBrowser() ? 'Sign in to see this order, or open it from the browser that placed it.' : 'order not found',
			404,
			'not_found',
		)
	}

	/**
	 * The order with a link to its invoice, once one has been issued. Issued on payment by a module a
	 * store may not have, so an unpaid order is not asked about and any answer but the invoice is none.
	 */
	private async withInvoice(order: Order, token?: string) {
		const mapped = toOrder(order)
		if (!token || ['pending', 'failed'].includes(order.payment_status)) return { ...mapped, downloads: null }
		const path = `/x/invoices/${encodeURIComponent(order.number)}`
		const [issued, downloads] = await Promise.all([
			this.data(path, { query: { token } }).then(
				() => true,
				() => false,
			),
			this.downloads(order.number, token),
		])
		const invoiceLink = issued ? this.engineURL(path, { token, ...(this.store ? { store: this.store } : {}) }) : null
		return { ...mapped, invoiceLink, downloads }
	}

	/**
	 * The order's files to download once it is paid (ext/digital, D254), or null from a store
	 * without the module. Each says whether it can still be had; the link itself is made on click
	 * by `downloadLink`, because a link lasts minutes.
	 */
	private async downloads(number: string, token: string) {
		const res = await this.data<{ downloads: DigitalDownload[] | null }>(
			`/x/digital/orders/${encodeURIComponent(number)}`,
			{ query: { token } },
		).catch(() => null)
		if (!res) return null
		return (res.downloads ?? []).map((d) => ({
			id: String(d.id),
			title: d.title,
			filename: d.filename,
			size: d.size_bytes,
			downloads: d.downloads,
			limit: d.download_limit,
			expiresAt: d.expires_at,
			status: d.status,
		}))
	}

	/**
	 * A fresh link to one download of an order, valid for minutes: the URL to send the browser to.
	 * The order's key is the one this browser holds (placed here, or opened from its email) or the
	 * signed-in account's. A refusal is a GoCommerceError carrying the engine's sentence — the limit
	 * reached, the days run out, the order refunded — which is worth showing as it is.
	 */
	async downloadLink({ orderNo, id }: { orderNo: string; id: string }) {
		const number = orderNo.trim()
		let token = placedOrder(number)?.token
		if (!token && sessionToken()) {
			token = (await this.data<Order>(`/x/identity/me/orders/${encodeURIComponent(number)}`, { auth: true })).access_token
		}
		if (!token) throw new GoCommerceError('Open this order again to download its files.', 404, 'not_found')
		const res = await this.data<{ url: string; expires_at: string }>(
			`/x/digital/orders/${encodeURIComponent(number)}/downloads/${encodeURIComponent(id)}`,
			{ method: 'POST', query: { token } },
		)
		return { url: this.engineURL(res.url, this.store ? { store: this.store } : undefined), expiresAt: res.expires_at }
	}

	/** Everything the signed-in shopper has bought, once each, most recent first. */
	async buyAgain() {
		const orders =
			(await this.data<Order[] | null>('/x/identity/me/orders', { query: { limit: 20 }, auth: true })) ?? []
		const seen = new Set<number>()
		const lines: {
			productId: number
			variantId: number
			title: string
			img: string | null
			price: number
			qty: number
			designId: string | null
		}[] = []
		for (const o of orders) {
			for (const l of o.line_items ?? []) {
				if (!l.product_id || !l.variant_id || seen.has(l.variant_id)) continue
				seen.add(l.variant_id)
				lines.push({
					productId: l.product_id,
					variantId: l.variant_id,
					title: l.title,
					img: mediaUrl(l.image_url),
					price: toMajor(l.unit_price),
					qty: l.quantity,
					designId: l.metadata?.design?.id ?? null,
				})
			}
		}
		// A product taken off sale is no longer something to buy again.
		const live = await Promise.all(
			lines.map((l) => this.data<Product>(`/api/products/${l.productId}`).catch(() => null)),
		)
		return lines.flatMap((l, i) => {
			const p = live[i]
			if (!p) return []
			const designable = typeof p.designable === 'boolean' ? p.designable : undefined
			return [{ ...l, productId: String(l.productId), variantId: String(l.variantId), slug: p.slug, designable }]
		})
	}

	/** The "someone just bought" popup would publish other shoppers' purchases; the engine offers none. */
	async listPublic(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}

	/**
	 * Opens an order with its number and the email or phone on it, no code. The
	 * engine answers one 404 for an unknown number and a wrong contact. The
	 * token it answers is kept like an order placed in this browser, so the
	 * order page and `getOrder` read it again.
	 */
	async openOrder({ orderNo, contact }: { orderNo: string; contact: string }) {
		const res = await this.data<{ order: Order; access_token: string }>(
			`/api/orders/${encodeURIComponent(orderNo.trim())}/open`,
			{ method: 'POST', body: { contact: contact.trim() } },
		)
		rememberOrder({ number: res.order.number, token: res.access_token, cartId: '' })
		return { data: [await this.withInvoice(res.order, res.access_token)] }
	}

	/**
	 * Opens an order from the link in its emails, which carries the order's key
	 * (`/order-tracking?order=…&key=…`). The key is kept like an order placed in
	 * this browser, so the page can drop it from the address bar.
	 */
	async openOrderWithKey({ orderNo, key }: { orderNo: string; key: string }) {
		const number = orderNo.trim()
		const order = await this.data<Order>(`/api/orders/${encodeURIComponent(number)}`, { query: { token: key.trim() } })
		rememberOrder({ number: order.number, token: key.trim(), cartId: '' })
		return { data: [await this.withInvoice(order, key.trim())] }
	}

	/**
	 * Sends a 4-digit code to the email or phone on the order, when `contact`
	 * is that email or phone. The engine answers the same either way, so this
	 * resolves whether or not anything was sent.
	 */
	async requestOrderCode({ orderNo, contact }: { orderNo: string; contact: string }) {
		const res = await this.data<{ expires_in_minutes: number }>(
			`/api/orders/${encodeURIComponent(orderNo.trim())}/code`,
			{ method: 'POST', body: { contact: contact.trim() } },
		)
		return { expiresInMinutes: res?.expires_in_minutes ?? 10 }
	}

	/**
	 * Opens an order with the code `requestOrderCode` sent. The token it answers
	 * is kept like an order placed in this browser, so the order page and
	 * `getOrder` read it again without another code.
	 */
	async getOrderByEmailAndOTP({ orderNo, otp }: { orderNo: string; otp: string; email?: string }) {
		const number = orderNo.trim()
		const res = await this.data<{ order: Order; access_token: string }>(
			`/api/orders/${encodeURIComponent(number)}/code/verify`,
			{ method: 'POST', body: { code: String(otp).trim() } },
		)
		rememberOrder({ number: res.order.number, token: res.access_token, cartId: '' })
		return { data: [await this.withInvoice(res.order, res.access_token)] }
	}
}

const clean = (v?: string | null) => (v && v !== 'undefined' && v !== 'null' ? v : undefined)

export const orderService = new OrderService()
