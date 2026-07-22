import type { Category, Product, ProductFacets, SearchResult } from '../engine'
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
	tags?: string[]
	vendors?: string[]
	productTypes?: string[]
	/**
	 * Ask the engine to count the filter values too. Such a query goes to
	 * `GET /api/products`, which then also answers the category, the price
	 * range, the sort and every filter above (D130); an engine too old to count
	 * them is asked the way it always was, and the page has no facets.
	 */
	facets?: boolean
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
	facets?: ProductFacets
}

/**
 * The family's sort names, in the search index's terms. The engine's own
 * listing has one order — newest first — so anything else needs the index.
 * Popularity has no answer anywhere: the engine keeps no such score, and
 * inventing one would sort the shop into a plausible-looking lie.
 */
function sortParts(sort: string): [string, 'asc' | 'desc'] {
	const s = sort.trim()
	const [field, dir] = s.startsWith('-') ? [s.slice(1), 'desc'] : s.includes(':') ? s.split(':') : [s, 'asc']
	return [field, dir === 'desc' ? 'desc' : 'asc']
}

function indexSort(sort?: string): string | undefined {
	if (!sort) return undefined
	const [field, d] = sortParts(sort)
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

/** The same names in the engine listing's own `sort` and `order`. */
function engineSort(sort?: string): { sort?: string; order?: string } {
	if (!sort || NATURAL.has(sort)) return {}
	const [field, order] = sortParts(sort)
	const key = (
		{
			price: 'price',
			createdAt: 'created_at',
			created_at: 'created_at',
			updatedAt: 'updated_at',
			updated_at: 'updated_at',
			title: 'title',
			name: 'title',
		} as Record<string, string>
	)[field]
	return key ? { sort: key, order } : {}
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
 * - Words, with no tag, vendor, type or attribute ticked, on a store with the
 *   Meilisearch plugin on: its index, which forgives typos, with the facet
 *   rail the database counts for the same words.
 * - Asked for facets: `GET /api/products?facets=1`, which answers every filter,
 *   the category and the sort on its own (D130).
 * - A category, no reordering: `GET /api/categories/{slug}`, which sells the
 *   category and its descendants.
 * - A search or the whole shop, no reordering: `GET /api/products?q=`.
 * - Any sort but newest, or a price range: the Meilisearch module, when it is
 *   installed and configured. Without it the shelf comes back in the engine's
 *   order with `sorted: false`, rather than failing or pretending.
 *
 * Whenever the index cannot answer (Meilisearch down), the database does.
 */
/** Engines, by base URL, that answered `facets=1` without facets. */
const legacyListing = new Set<string>()

export class CatalogService extends BaseService {
	protected readonly facts = new StoreFacts(this._fetch)

	protected async queryCatalog(q: CatalogQuery): Promise<CatalogPage> {
		const page = Math.max(1, Number(q.page) || 1)
		const limit = Math.min(100, Math.max(1, Number(q.limit) || PAGE_SIZE))
		const search = q.search?.trim() || undefined
		const wantsRange = Number.isFinite(q.priceFrom) || Number.isFinite(q.priceTo)
		const sortKey = q.sort && !NATURAL.has(q.sort) ? indexSort(q.sort) : undefined
		const hierarchy = q.category ? await this.facts.hierarchy(q.category) : []
		const attr = Object.entries(q.attributes ?? {}).flatMap(([handle, values]) =>
			values.filter(Boolean).map((v) => `${handle}:${v}`),
		)

		// A shopper's words go to the index first: it forgives typos and ranks
		// by relevance. Not once they have ticked a tag, vendor, type or
		// attribute, which only the database filters and counts.
		const refined = attr.length > 0 || !!(q.tags?.length || q.vendors?.length || q.productTypes?.length)
		const triedIndex = !!search && !refined
		const counted = q.facets && !legacyListing.has(this.engineBase())
		const facetListing = async (page: number, limit: number) => {
			const { currency } = await this.facts.ready()
			const minor = (n?: number) => (Number.isFinite(n) ? Math.max(0, toMinor(n as number, currency)) : undefined)
			return this.engine<Product[] | null>('/api/products', {
				query: {
					q: search,
					page,
					limit,
					channel: this.creds.channel,
					category: q.category,
					tag: q.tags,
					vendor: q.vendors,
					product_type: q.productTypes,
					attr,
					price_min: minor(q.priceFrom),
					price_max: minor(q.priceTo),
					...engineSort(q.sort),
					facets: 1,
				},
			})
		}
		if (triedIndex && (await this.facts.pluginOn('meilisearch'))) {
			const [found, rail] = await Promise.all([
				this.fromIndex(q, { page, limit, search, sortKey, wantsRange, hierarchy }),
				counted ? facetListing(1, 1).catch(() => null) : null,
			])
			// The rail is the database's count for the same words: there to narrow
			// by when they match exactly, empty for a typo only the index forgives.
			if (found) return rail?.meta?.facets ? { ...found, facets: rail.meta.facets } : found
		}

		if (counted) {
			const env = await facetListing(page, limit)
			if (env.meta?.facets) {
				return {
					...toPage(env, (p: Product) => toProduct(p)),
					categoryHierarchy: hierarchy,
					sorted: true,
					facets: env.meta.facets,
				}
			}
			// ponytail: remembered until restart, so an engine upgraded under a running storefront gets facets after the next deploy.
			legacyListing.add(this.engineBase())
		}

		if (!triedIndex && (sortKey || wantsRange)) {
			const found = await this.fromIndex(q, { page, limit, search, sortKey, wantsRange, hierarchy })
			if (found) return found
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
		const env = await this.engine<Product[] | null>('/api/products', {
			query: { q: search, page, limit, channel: this.creds.channel, attr },
		})
		return { ...toPage(env, (p: Product) => toProduct(p)), categoryHierarchy: hierarchy, sorted }
	}

	/**
	 * The shelf from the Meilisearch module, or null when the store has it off,
	 * sells through a channel, finds nothing for the words, or it cannot answer (Meilisearch down: the engine says `unavailable`), so
	 * the caller asks the database instead of showing the shopper an error.
	 */
	protected async fromIndex(
		q: CatalogQuery,
		o: { page: number; limit: number; search?: string; sortKey?: string; wantsRange: boolean; hierarchy: CatalogPage['categoryHierarchy'] },
	): Promise<CatalogPage | null> {
		// The index knows nothing of channels: a channel's shopper searches the
		// database, which shows only what the channel sells, at its prices.
		if (this.creds.channel || !(await this.facts.pluginOn('meilisearch'))) return null
		const filters: string[] = []
		if (q.category) {
			const names = (await this.facts.subtree(q.category).catch(() => [] as Category[])).map((c) => quote(c.full_name))
			// A slug the tree does not know sells nothing — say so, don't widen to the shop.
			if (!names.length) return { ...emptyCatalog(o.limit), categoryHierarchy: o.hierarchy, sorted: true }
			filters.push(`category IN [${names.join(', ')}]`)
		}
		if (o.wantsRange) {
			const { currency } = await this.facts.ready()
			if (Number.isFinite(q.priceFrom)) filters.push(`price_minor >= ${toMinor(q.priceFrom as number, currency)}`)
			if (Number.isFinite(q.priceTo)) filters.push(`price_minor <= ${toMinor(q.priceTo as number, currency)}`)
		}
		const res = await this.data<SearchResult>('/x/meilisearch/search', {
			query: {
				q: o.search ?? '',
				limit: o.limit,
				offset: (o.page - 1) * o.limit,
				filter: filters.join(' AND ') || undefined,
				sort: o.sortKey,
			},
		}).catch(() => null)
		// No hits for words may be an index still being built for a store that
		// just switched it on, or a sync that keeps failing: the database's
		// answer costs one query and is never worse than nothing.
		if (!res || res.unavailable || (o.search && !res.hits?.length)) return null
		const total = res.total ?? 0
		return {
			data: (res.hits ?? []).map(fromSearchDoc),
			count: total,
			pageSize: o.limit,
			noOfPage: Math.max(1, Math.ceil(total / o.limit)),
			page: o.page,
			categoryHierarchy: o.hierarchy,
			sorted: true,
		}
	}
}

export function emptyCatalog(limit = PAGE_SIZE) {
	return { data: [], count: 0, pageSize: limit, noOfPage: 0, page: 1 }
}
