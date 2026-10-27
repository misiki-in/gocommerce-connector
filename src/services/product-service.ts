import type { AddOn, Product, ReviewPage } from '../engine'
import { GoCommerceError, NotSupportedError } from '../errors'
import { toAddOn, toProduct, toRating } from '../map'
import { currentMe } from '../browser'
import { CatalogService, PAGE_SIZE, type CatalogQuery } from './catalog'

/**
 * Products: one by slug, and the shelves the homepage and listings draw.
 *
 * "Featured" and "trending" are curated rather than computed — the engine
 * keeps no sales or view counts to rank by. A collection with the slug
 * `featured` (or `trending`) is that shelf, so a merchant curates it in the
 * panel; without one, the shelf is the newest products, and says nothing more
 * about them than that.
 */
export class ProductService extends CatalogService {
	/**
	 * A product page. `slug` may also be a numeric id or a variant SKU, which is
	 * how an old link or a search hit sometimes arrives.
	 *
	 * Reviews ride along when ext/reviews is installed and switched on; a review
	 * failure never costs the shopper the product page.
	 */
	async getOne(slug: string) {
		const p = await this.findProduct(String(slug))
		const product = toProduct(p, {
			categoryHierarchy: p.category ? await this.facts.hierarchy(p.category.slug) : [],
		})
		if (await this.facts.pluginOn('product-reviews')) {
			try {
				const res = await this.data<ReviewPage>('/x/reviews', { query: { product_id: p.id, limit: 50 } })
				product.ratings = (res.reviews ?? []).map(toRating)
				product.rating = res.summary?.count ? res.summary.average : null
				product.ratingCount = res.summary?.count ?? 0
				product.reviewCount = res.summary?.count ?? 0
			} catch {
				// The page renders without stars rather than not at all.
			}
		}
		return product
	}

	private async findProduct(slug: string): Promise<Product> {
		try {
			return await this.data<Product>(`/api/products/slug/${encodeURIComponent(slug)}`)
		} catch (err) {
			if (!(err instanceof GoCommerceError) || err.status !== 404) throw err
			// Not a slug. An id or a SKU is worth one more question each, and a
			// miss on all three is the product's 404, not theirs.
			const fallback = /^\d+$/.test(slug) ? `/api/products/${slug}` : `/api/products/sku/${encodeURIComponent(slug)}`
			try {
				return await this.data<Product>(fallback)
			} catch {
				throw err
			}
		}
	}

	/** The shop's listing: `{ page, search, sort }`, newest first unless the index can reorder it. */
	async list({
		page = 1,
		search,
		q,
		sort,
		limit,
		categories,
	}: CatalogQuery & { q?: string; categories?: string } = {}) {
		const res = await this.queryCatalog({ page, search: search ?? q, sort, limit, category: categories || undefined })
		return { data: res.data, count: res.count, pageSize: res.pageSize, noOfPage: res.noOfPage, page: res.page }
	}

	async listFeaturedProducts({ page = 1, sort, limit }: { page?: number; sort?: string; limit?: number } = {}) {
		return this.shelf('featured', { page, sort, limit })
	}

	async listTrendingProducts({ page = 1, limit }: { page?: number; limit?: number } = {}) {
		return this.shelf('trending', { page, limit })
	}

	/**
	 * More like this product. Given `product` (a slug or id), it is the
	 * product's category first, then its collections, then the newest — never
	 * the product itself. Many shops never fill in categories, and an empty
	 * rail under every product page reads as a broken shop.
	 *
	 * Without `product`, it is the old answer: more from `categoryId`.
	 */
	async listRelatedProducts({
		page = 1,
		categoryId,
		product,
		limit,
	}: { page?: number; categoryId?: string; product?: string; limit?: number } = {}) {
		if (product) return this.relatedTo(String(product), limit)
		if (!categoryId) return this.list({ page, limit })
		const category = (await this.facts.categories()).find((c) => String(c.id) === String(categoryId))
		if (!category) return this.list({ page, limit })
		return this.list({ page, limit, categories: category.slug })
	}

	/**
	 * What the shop offers with a product, ticked in its buy box (D132): each
	 * add-on at the price ticking it adds. Only add-ons that can be bought
	 * arrive; an engine without the route offers none.
	 */
	async listAddOns({ product }: { product: string }) {
		const p = await this.findProduct(String(product))
		try {
			return ((await this.data<AddOn[] | null>('/api/add-ons', { query: { product_id: p.id } })) ?? []).map(toAddOn)
		} catch (err) {
			if (err instanceof GoCommerceError && err.status === 404) return []
			throw err
		}
	}

	/**
	 * "You may also like": the products the shop chose for this one, at their
	 * own prices (D132). Curated only, and empty when none were chosen: the
	 * related products already fill in from the category, and the page should
	 * not draw the same fill twice.
	 */
	async listCrossSells({ product, limit }: { product: string; limit?: number }) {
		const p = await this.findProduct(String(product))
		try {
			const rows = (await this.data<Product[] | null>('/api/cross-sells', { query: { product_id: p.id, limit } })) ?? []
			return rows.map((r) => toProduct(r))
		} catch (err) {
			if (err instanceof GoCommerceError && err.status === 404) return []
			throw err
		}
	}

	private async relatedTo(slug: string, limit?: number) {
		const size = Math.min(100, Math.max(1, Number(limit) || PAGE_SIZE))
		const p = await this.findProduct(slug)
		const self = String(p.id)
		// The listing answers either the engine's cards or the search index's,
		// so all a pick needs to know is the id.
		const picked = new Map<string, { id: string }>()
		const add = (rows: readonly { id: string }[]) => {
			for (const r of rows) {
				if (picked.size >= size) return
				if (r.id !== self && !picked.has(r.id)) picked.set(r.id, r)
			}
		}
		// One more than needed, since the product itself may be among them.
		if (p.category) add((await this.list({ limit: size + 1, categories: p.category.slug })).data)
		for (const c of p.collections ?? []) {
			if (picked.size >= size) break
			add((await this.shelf(c.slug, { page: 1, limit: size + 1 })).data)
		}
		if (picked.size < size) add((await this.list({ limit: size + 1 })).data)
		const data = [...picked.values()]
		return { data, count: data.length, pageSize: size, noOfPage: 1, page: 1 }
	}

	private async shelf(slug: string, { page, sort, limit }: { page: number; sort?: string; limit?: number }) {
		const size = Math.min(100, Math.max(1, Number(limit) || PAGE_SIZE))
		try {
			const env = await this.engine<{ products: Product[] | null }>(`/api/collections/${slug}`, {
				query: { page, limit: size },
			})
			const rows = env.data?.products ?? []
			return {
				data: rows.map((p) => toProduct(p)),
				count: env.meta?.total ?? rows.length,
				pageSize: env.meta?.limit ?? size,
				noOfPage: env.meta?.total_pages ?? 1,
				page: env.meta?.page ?? page,
			}
		} catch (err) {
			if (!(err instanceof GoCommerceError) || err.status !== 404) throw err
			return this.list({ page, sort, limit: size })
		}
	}

	/**
	 * A review, through ext/reviews. The engine asks for a name and an email
	 * with every review, so a signed-out shopper is asked to sign in rather
	 * than having one made up for them. Uploaded photos have nowhere to go: the
	 * module stores text.
	 */
	async addReview({
		productId,
		rating,
		review,
		title,
	}: {
		productId: string
		variantId?: string
		rating: number
		review: string
		title?: string
	}) {
		const me = currentMe()
		if (!me?.email) throw new GoCommerceError('Please sign in to write a review.', 401, 'unauthorized')
		const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email.split('@')[0]
		return this.data<{ status: string; verified: boolean }>('/x/reviews', {
			method: 'POST',
			body: {
				product_id: Number(productId),
				name,
				email: me.email,
				rating: Math.round(Number(rating)),
				...(title ? { title } : {}),
				body: String(review ?? ''),
			},
		})
	}

	async fetchReels(): Promise<never> {
		throw new NotSupportedError('ProductService', 'fetchReels', 'the engine has no reels')
	}
}

export const productService = new ProductService()
