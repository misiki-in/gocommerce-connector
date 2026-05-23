import type { Order, Product } from '../engine'
import { GoCommerceError, NotSupportedError } from '../errors'
import { toOrder } from '../map'
import { toMajor } from '../money'
import { inBrowser, placedOrder, placedOrderForCart, sessionToken } from '../browser'
import { BaseService, emptyPage, toPage } from './base.service'

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
			return toOrder(
				await this.data<Order>(`/api/orders/${encodeURIComponent(number)}`, { query: { token: kept.token } }),
			)
		}
		if (sessionToken()) {
			return toOrder(await this.data<Order>(`/x/identity/me/orders/${encodeURIComponent(number)}`, { auth: true }))
		}
		throw new GoCommerceError(
			inBrowser() ? 'Sign in to see this order, or open it from the browser that placed it.' : 'order not found',
			404,
			'not_found',
		)
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
		}[] = []
		for (const o of orders) {
			for (const l of o.line_items ?? []) {
				if (!l.product_id || !l.variant_id || seen.has(l.variant_id)) continue
				seen.add(l.variant_id)
				lines.push({
					productId: l.product_id,
					variantId: l.variant_id,
					title: l.title,
					img: l.image_url ?? null,
					price: toMajor(l.unit_price),
					qty: l.quantity,
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
			return [{ ...l, productId: String(l.productId), variantId: String(l.variantId), slug: p.slug }]
		})
	}

	/** The "someone just bought" popup would publish other shoppers' purchases; the engine offers none. */
	async listPublic(_args: Record<string, unknown> = {}) {
		return emptyPage()
	}

	async getOrderByEmailAndOTP(): Promise<never> {
		throw new NotSupportedError(
			'OrderService',
			'getOrderByEmailAndOTP',
			'the engine sends no one-time codes; a guest reads an order with its access token',
		)
	}
}

const clean = (v?: string | null) => (v && v !== 'undefined' && v !== 'null' ? v : undefined)

export const orderService = new OrderService()
