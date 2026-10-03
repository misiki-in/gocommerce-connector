import type { Category, Product, SearchResult } from '../engine'
import { fromSearchDoc, toProduct } from '../map'
import { toMinor } from '../money'
import { BaseService, toPage } from './base.service'
import { StoreFacts } from './facts'

export const PAGE_SIZE = 24

export type CatalogQuery = {
	page?: number
	limit?: number
	search?: string
	/** The family's sort spellings: `-createdAt`, `price`, `price:asc`, `updatedAt:desc`, `-popularity`… */
	sort?: string
	/** A category slug: the page sells it and everything under it. */
	category?: string
	priceFrom?: number
	priceTo?: number
	/**
	 * Attribute answers, `{ color: ['Red', 'Blue'] }`: one handle's values OR-ed,
	 * different handles AND-ed. The engine filters on them in the whole-shop
	 * listing only — its category route takes none — so inside a category they
	 * are not applied.
	 */
	attributes?: Record<string, string[]>
}

export type CatalogPage = {
	data: ReturnType<typeof toProduct>[] | ReturnType<typeof fromSearchDoc>[]
	count: number
	pageSize: number
	noOfPage: number
	page: number
	categoryHierarchy: { name: string; slug: string }[]
	/** Whether the answer honoured `sort` and the price range, or had to drop them. */
	sorted: boolean
}

/**
 * The family's sort names, in the search index's terms. The engine's own
 * listing has one order — newest first — so anything else needs the index.
 * Popularity has no answer anywhere: the engine keeps no such score, and
 * inventing one would sort the shop into a plausible-looking lie.
 */
function indexSort(sort?: string): string | undefined {
	if (!sort) return undefined
	const s = sort.trim()
	const [field, dir] = s.startsWith('-') ? [s.slice(1), 'desc'] : s.includes(':') ? s.split(':') : [s, 'asc']
	const d = dir === 'desc' ? 'desc' : 'asc'
	switch (field) {
		case 'price':
			return `price_minor:${d}`
		case 'updatedAt':
		case 'updated_at':
		case 'createdAt':
		case 'created_at':
			return `updated_at:${d}`
		case 'title':
		case 'name':
			return `title:${d}`
		default:
			return undefined
	}
}

/** Newest first is the engine's own order, so these need no index. */
const NATURAL = new Set([
	'-createdAt',
	'createdAt:desc',
	'-updatedAt',
	'updatedAt:desc',
	'-popularity',
	'popularity:desc',
])

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * One shelf of products, from whichever engine route can answer the question.
 *
 * - A category, no reordering: `GET /api/categories/{slug}`, which sells the
 *   category and its descendants.
 * - A search or the whole shop, no reordering: `GET /api/products?q=`.
 * - Any sort but newest, or a price range: the Meilisearch module, when it is
 *   installed and configured. Without it the shelf comes back in the engine's
 *   order with `sorted: false`, rather than failing or pretending.
 */
export class CatalogService extends BaseService {
	protected readonly facts = new StoreFacts(this._fetch)

	protected async queryCatalog(q: CatalogQuery): Promise<CatalogPage> {
		const page = Math.max(1, Number(q.page) || 1)
		const limit = Math.min(100, Math.max(1, Number(q.limit) || PAGE_SIZE))
		const search = q.search?.trim() || undefined
		const wantsRange = Number.isFinite(q.priceFrom) || Number.isFinite(q.priceTo)
		const sortKey = q.sort && !NATURAL.has(q.sort) ? indexSort(q.sort) : undefined
		const hierarchy = q.category ? await this.facts.hierarchy(q.category) : []

		if ((sortKey || wantsRange) && (await this.facts.pluginOn('meilisearch'))) {
			const filters: string[] = []
			if (q.category) {
				const names = (await this.facts.subtree(q.category).catch(() => [] as Category[])).map((c) =>
					quote(c.full_name),
				)
				// A slug the tree does not know sells nothing — say so, don't widen to the shop.
				if (!names.length) return { ...emptyCatalog(limit), categoryHierarchy: hierarchy, sorted: true }
				filters.push(`category IN [${names.join(', ')}]`)
			}
			if (wantsRange) {
				const { currency } = await this.facts.ready()
				if (Number.isFinite(q.priceFrom)) filters.push(`price_minor >= ${toMinor(q.priceFrom as number, currency)}`)
				if (Number.isFinite(q.priceTo)) filters.push(`price_minor <= ${toMinor(q.priceTo as number, currency)}`)
			}
			const res = await this.data<SearchResult>('/x/meilisearch/search', {
				query: {
					q: search ?? '',
					limit,
					offset: (page - 1) * limit,
					filter: filters.join(' AND ') || undefined,
					sort: sortKey,
				},
			})
			const total = res.total ?? 0
			return {
				data: (res.hits ?? []).map(fromSearchDoc),
				count: total,
				pageSize: limit,
				noOfPage: Math.max(1, Math.ceil(total / limit)),
				page,
				categoryHierarchy: hierarchy,
				sorted: true,
			}
		}

		const sorted = !sortKey && !wantsRange
		if (q.category && !search) {
			const env = await this.engine<{ products: Product[] | null }>(
				`/api/categories/${encodeURIComponent(q.category)}`,
				{ query: { page, limit } },
			)
			const products = env.data?.products ?? []
			return {
				...toPage({ data: products, meta: env.meta }, (p: Product) => toProduct(p)),
				categoryHierarchy: hierarchy,
				sorted,
			}
		}
		// A search inside a category, without the index, searches the whole shop:
		// the engine's category route takes no query and its search takes no
		// category, and filtering one page client-side would make the count a lie.
		const attr = Object.entries(q.attributes ?? {}).flatMap(([handle, values]) =>
			values.filter(Boolean).map((v) => `${handle}:${v}`),
		)
		const env = await this.engine<Product[] | null>('/api/products', {
			query: { q: search, page, limit, channel: this.creds.channel, attr },
		})
		return { ...toPage(env, (p: Product) => toProduct(p)), categoryHierarchy: hierarchy, sorted }
	}
}

export function emptyCatalog(limit = PAGE_SIZE) {
	return { data: [], count: 0, pageSize: limit, noOfPage: 0, page: 1 }
}
