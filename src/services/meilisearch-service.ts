import type { Product } from '../engine'
import { toProduct } from '../map'
import { CatalogService } from './catalog'

/**
 * The two places the storefront asks for raw search hits: "more from this
 * category" on a product page, and the header's type-ahead.
 *
 * Both go through ext/search-meilisearch when it is installed, and through the
 * engine's own listing when it is not — a type-ahead backed by a LIKE query is
 * slower and unranked, but it is not empty.
 */
export class MeilisearchService extends CatalogService {
	/** `{ query, categories, page }` → a Meilisearch-shaped answer: `hits`, `totalHits`, `totalPages`. */
	async search({
		query,
		search,
		categories,
		page = 1,
		limit,
	}: { query?: string; search?: string; categories?: string; page?: number; limit?: number } = {}) {
		const res = await this.queryCatalog({ page, limit, search: query ?? search, category: categories || undefined })
		return {
			hits: res.data,
			totalHits: res.count,
			estimatedTotalHits: res.count,
			totalPages: res.noOfPage,
			page: res.page,
			categories: res.categoryHierarchy,
			facetDistribution: {},
		}
	}

	/** The header's type-ahead: `{ data: [{ slug, title, thumbnail, price }] }`. */
	async searchAutoComplete({ query, search, limit = 8 }: { query?: string; search?: string; limit?: number } = {}) {
		const q = (query ?? search ?? '').trim()
		if (!q) return { data: [] }
		const found = await this.fromIndex({}, { page: 1, limit, search: q, wantsRange: false, hierarchy: [] })
		if (found) return { data: found.data }
		const rows =
			(await this.data<Product[] | null>('/api/products', { query: { q, limit, channel: this.creds.channel } })) ?? []
		return { data: rows.map((p) => toProduct(p)) }
	}
}

export const meilisearchService = new MeilisearchService()
