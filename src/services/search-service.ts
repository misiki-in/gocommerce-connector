import type { ProductFacets } from '../engine'
import { toMajor } from '../money'
import { CatalogService } from './catalog'

const num = (v: string | null): number | undefined => {
	if (v === null || v.trim() === '') return undefined
	const n = Number(v)
	return Number.isFinite(n) ? n : undefined
}

/** Decoded once more when it decodes: the storefront's filter rail encodes a value before the URL does. */
function decodeOnce(v: string): string {
	try {
		return decodeURIComponent(v)
	} catch {
		return v
	}
}

/** `?key=a,b` (repeatable) as `['a', 'b']`. */
function listParam(p: URLSearchParams, key: string): string[] | undefined {
	const out = p
		.getAll(key)
		.flatMap((v) => decodeOnce(v).split(','))
		.map((v) => v.trim())
		.filter(Boolean)
	return out.length ? out : undefined
}

/** `?attributes.color=Red,Blue` — the storefront's facet params — as `{ color: ['Red', 'Blue'] }`. */
function attributesFrom(p: URLSearchParams): Record<string, string[]> | undefined {
	const out: Record<string, string[]> = {}
	for (const key of new Set(p.keys())) {
		if (!key.startsWith('attributes.')) continue
		const handle = key.slice('attributes.'.length)
		const values = listParam(p, key)
		if (handle && values) out[handle] = values
	}
	return Object.keys(out).length ? out : undefined
}

const counts = (values: { value: string; count: number }[] | null | undefined) =>
	Object.fromEntries((values ?? []).map((v) => [v.value, v.count]))

/**
 * The engine's counts in the shape the storefront's filter rail reads. Each
 * `allFilters` key is also the URL parameter the rail writes when a value is
 * ticked, and `searchWithUrl` reads it back: `vendor`, `product_type` and
 * `attributes.<handle>`. Tags go to the rail's own tag group, written as `tags`.
 */
export function toStorefrontFacets(f?: ProductFacets | null) {
	if (!f) return { priceStat: {}, categories: [], tags: [], allFilters: {} }
	const allFilters: Record<string, Record<string, number>> = {}
	const group = (key: string, values: { value: string; count: number }[] | null | undefined) => {
		if (values?.length) allFilters[key] = counts(values)
	}
	group('vendor', f.vendors)
	group('product_type', f.product_types)
	for (const [handle, values] of Object.entries(f.attributes ?? {})) group(`attributes.${handle}`, values)
	return {
		priceStat: f.price ? { min: toMajor(f.price.min), max: toMajor(f.price.max) } : {},
		categories: (f.categories ?? []).map((c) => ({ name: c.title, slug: c.slug, count: c.count })),
		tags: (f.tags ?? []).map((t) => ({ name: t.value, count: t.count })),
		allFilters,
	}
}

/**
 * The listing pages' search: `/products?search=&sort=&page=` and the category
 * catch-all `/{slug}`.
 *
 * Facets come from the engine, counted over the whole listing rather than the
 * page (D130). An engine too old to count them leaves them empty, and an empty
 * `priceStat` hides the price slider rather than drawing one with a made-up
 * range.
 */
export class SearchService extends CatalogService {
	emptyResult() {
		return {
			data: [],
			count: 0,
			totalPages: 0,
			categoryHierarchy: [] as { name: string; slug: string }[],
			facets: toStorefrontFacets(),
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
				attributes: attributesFrom(p),
				tags: listParam(p, 'tags'),
				vendors: listParam(p, 'vendor'),
				productTypes: listParam(p, 'product_type'),
				facets: true,
			})
			return {
				data: res.data,
				count: res.count,
				totalPages: res.noOfPage,
				page: res.page,
				categoryHierarchy: res.categoryHierarchy,
				facets: toStorefrontFacets(res.facets),
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
