import { CatalogService } from './catalog'

const num = (v: string | null): number | undefined => {
	if (v === null || v.trim() === '') return undefined
	const n = Number(v)
	return Number.isFinite(n) ? n : undefined
}

/**
 * The listing pages' search: `/products?search=&sort=&page=` and the category
 * catch-all `/{slug}`.
 *
 * Facets are empty. The engine's search route returns hits and a total, not
 * distributions, and a facet list made from one page of hits would count that
 * page, not the shop. An empty `priceStat` hides the price slider rather than
 * drawing one with a made-up range.
 */
export class SearchService extends CatalogService {
	emptyResult() {
		return {
			data: [],
			count: 0,
			totalPages: 0,
			categoryHierarchy: [] as { name: string; slug: string }[],
			facets: { priceStat: {}, categories: [], tags: [], allFilters: {} },
		}
	}

	async searchWithUrl(url: URL | string, slug?: string) {
		try {
			const u = typeof url === 'string' ? new URL(url, 'http://localhost') : url
			const p = u.searchParams
			// `?price=10,50` is the chip form; priceFrom/priceTo the slider's.
			const [from, to] = (p.get('price') ?? '').split(/[,-]/)
			const res = await this.queryCatalog({
				page: num(p.get('page')),
				search: p.get('search') ?? p.get('q') ?? undefined,
				sort: p.get('sort') ?? undefined,
				category: slug || p.get('categories')?.split(',')[0] || undefined,
				priceFrom: num(p.get('priceFrom')) ?? num(from ?? null),
				priceTo: num(p.get('priceTo')) ?? num(to ?? null),
			})
			return {
				data: res.data,
				count: res.count,
				totalPages: res.noOfPage,
				page: res.page,
				categoryHierarchy: res.categoryHierarchy,
				facets: { priceStat: {}, categories: [], tags: [], allFilters: {} },
			}
		} catch (err) {
			// A missing category is an empty result — the route turns that into
			// its 404 — but an engine that cannot be reached is not, and says so.
			if ((err as { status?: number })?.status === 404) return this.emptyResult()
			throw err
		}
	}
}

export const searchService = new SearchService()
