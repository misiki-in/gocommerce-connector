import type { Collection, Product } from '../engine'
import { toCollection, toProduct } from '../map'
import { BaseService, toPage } from './base.service'

/** Curated lists. Only collections holding at least one product on sale are listed. */
export class CollectionService extends BaseService {
	async list({ page = 1, limit = 24 }: { page?: number; limit?: number; sort?: string; q?: string } = {}) {
		const env = await this.engine<Collection[] | null>('/api/collections', { query: { page, limit } })
		return toPage(env, toCollection)
	}

	/** A collection page: the collection, and its products in the merchant's order. */
	async getOne(slug: string, { page = 1, limit = 48 }: { page?: number; limit?: number } = {}) {
		const env = await this.engine<Collection & { products: Product[] | null }>(
			`/api/collections/${encodeURIComponent(slug)}`,
			{ query: { page, limit } },
		)
		const products = (env.data.products ?? []).map((p) => toProduct(p))
		return {
			...toCollection(env.data),
			products,
			// The family's shape for a collection's members.
			collectionvalues: products.map((p) => ({ products: p })),
			count: env.meta?.total ?? products.length,
			noOfPage: env.meta?.total_pages ?? 1,
			page: env.meta?.page ?? page,
		}
	}

	/** Collection-level ratings are a Litekart aggregate; the engine has none to report. */
	async getAllRatings() {
		return { data: [] as unknown[] }
	}
}

export const collectionService = new CollectionService()
