import type { Category } from '../engine'
import { toCategory } from '../map'
import { BaseService } from './base.service'
import { StoreFacts } from './facts'

const asList = (rows: ReturnType<typeof toCategory>[]) => ({
	data: rows,
	count: rows.length,
	pageSize: rows.length,
	noOfPage: 1,
	page: 1,
})

/**
 * The category tree. The engine has no "featured" flag on a category, so the
 * featured row is the top level of the tree, in the merchant's order — which
 * is what a shop's first row of category tiles usually is anyway.
 */
export class CategoryService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	/** Every category, flat, each naming its parent. The storefront builds the tree. */
	async fetchAllCategories(_args: Record<string, unknown> = {}) {
		const all = await this.facts.categories()
		return asList(all.map(flat))
	}

	async fetchFeaturedCategories({ limit = 18 }: { limit?: number } = {}) {
		const roots = (await this.facts.categories()).filter((c) => c.parent_id === null)
		return asList(roots.slice(0, Math.max(0, Number(limit) || 18)).map(flat))
	}

	async fetchFooterCategories(args: { limit?: number } = {}) {
		return this.fetchFeaturedCategories(args)
	}

	/** The nested tree, roots first. */
	async getMegamenu(_args: Record<string, unknown> = {}) {
		const tree = (await this.data<Category[] | null>('/api/categories')) ?? []
		return tree.map(toCategory)
	}

	async fetchCategory(slug: string) {
		const c = await this.data<Category>(`/api/categories/${encodeURIComponent(slug)}`, { query: { limit: 1 } })
		return toCategory(c)
	}

	/**
	 * kitcommerce-core's category filter asks for `/api/categories/all` by path,
	 * through the family's raw `get`. That is a Litekart path the rest-guard
	 * would swallow, so it is answered here, from the engine's tree.
	 */
	override async get<T = any>(path: string): Promise<T> {
		if (path.split('?')[0] === '/api/categories/all') return (await this.fetchAllCategories()) as T
		return super.get<T>(path)
	}
}

/** One row of the flat tree: no `children`, so the storefront's builder is the only one. */
const flat = (c: Category) => ({ ...toCategory(c), children: [] })

export const categoryService = new CategoryService()
