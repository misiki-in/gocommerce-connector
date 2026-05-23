import type { Product, Wishlist } from '../engine'
import { GoCommerceError } from '../errors'
import { toProduct } from '../map'
import { currentMe, forgetWishlistToken, rememberWishlistToken, wishlistToken } from '../browser'
import { BaseService } from './base.service'

/**
 * Saved products, through ext/wishlist.
 *
 * The module keys a list by a token of its own rather than by an account, so
 * a guest can save things too; this connector keeps that token in the browser.
 * The signed-in shopper's email is attached so the store can tell them when a
 * saved product comes back in stock.
 */
export class WishlistService extends BaseService {
	async fetchWishlist(_args: Record<string, unknown> = {}) {
		const list = await this.current()
		if (!list) return { data: [], count: 0 }
		const items = (list.items ?? []).filter((i) => !i.deleted)
		const products = await Promise.all(
			items.map((i) => this.data<Product>(`/api/products/${i.product_id}`).catch(() => null)),
		)
		const data = items.flatMap((item, n) => {
			const p = products[n]
			if (!p) return []
			return [
				{
					id: String(item.id),
					productId: String(item.product_id),
					variantId: item.variant_id ? String(item.variant_id) : null,
					product: toProduct(p),
					variant: { id: item.variant_id ? String(item.variant_id) : null },
					createdAt: item.created_at,
				},
			]
		})
		return { data, count: data.length }
	}

	/** Saved → removed, removed → saved. `{ active }` is the state after the click. */
	async toggleWishlist({ productId, variantId }: { productId: string; variantId?: string | null }) {
		const list = (await this.current()) ?? (await this.create())
		const item = (list.items ?? []).find((i) => String(i.product_id) === String(productId))
		if (item) {
			await this.data<Wishlist>(`/x/wishlist/${enc(list.token!)}/items/${item.id}`, { method: 'DELETE' })
			return { active: false, id: String(item.id) }
		}
		const next = await this.data<Wishlist>(`/x/wishlist/${enc(list.token!)}/items`, {
			method: 'POST',
			body: { product_id: Number(productId), ...(variantId ? { variant_id: Number(variantId) } : {}) },
		})
		const added = (next.items ?? []).find((i) => String(i.product_id) === String(productId))
		return { active: true, id: added ? String(added.id) : null }
	}

	async checkWishlist({ productId }: { productId: string; variantId?: string | null }) {
		const list = await this.current()
		return !!list && (list.items ?? []).some((i) => String(i.product_id) === String(productId))
	}

	async checkWishlistInBulk(pairs: { productId: string; variantId?: string | null }[]) {
		const list = await this.current()
		const saved = new Set((list?.items ?? []).map((i) => String(i.product_id)))
		return (pairs ?? []).map((p) => ({ ...p, exists: saved.has(String(p.productId)) }))
	}

	private async current(): Promise<(Wishlist & { token: string }) | null> {
		const token = wishlistToken()
		if (!token) return null
		try {
			return { ...(await this.data<Wishlist>(`/x/wishlist/${enc(token)}`)), token }
		} catch (err) {
			if (err instanceof GoCommerceError && err.status === 404 && !/no wishlist|no route/i.test(err.message)) {
				forgetWishlistToken()
				return null
			}
			throw err
		}
	}

	private async create(): Promise<Wishlist & { token: string }> {
		const email = currentMe()?.email
		const list = await this.data<Wishlist>('/x/wishlist', { method: 'POST', ...(email ? { body: { email } } : {}) })
		if (!list.token) throw new GoCommerceError('The store did not return a wishlist token.', 500)
		rememberWishlistToken(list.token)
		return { ...list, token: list.token }
	}
}

const enc = (s: string) => encodeURIComponent(s)

export const wishlistService = new WishlistService()
