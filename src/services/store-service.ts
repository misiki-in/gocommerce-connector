import { readStaticStore } from '../static-store'
import { BaseService } from './base.service'
import { StoreFacts } from './facts'
import { MenuService } from './menu-service'

/** `$`, `€`, `₹` — from the platform's own tables rather than a list kept here. */
function symbolFor(code: string): string {
	try {
		const part = new Intl.NumberFormat('en', { style: 'currency', currency: code })
			.formatToParts(0)
			.find((p) => p.type === 'currency')
		return part?.value ?? code
	} catch {
		return code
	}
}

/**
 * The store record every page renders from.
 *
 * Name, logo, theme and the rest are the storefront's own (its static store,
 * registered through `setStaticStore`); the engine has no opinion on them.
 * Where the engine does have one, it wins: the settlement currency — every
 * price on the site is formatted with it, and a store record saying USD over
 * an engine charging INR would print the wrong symbol on every price — the
 * modules that back a storefront feature, and the menus.
 *
 * This runs on every request and a throw here takes every page down, so the
 * engine's half is best-effort: unreachable, the storefront still renders
 * from its own record, and the failure shows up where a price is fetched.
 */
export class StoreService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	async getStoreByIdOrDomain(_args: { storeId?: string; domain?: string } = {}) {
		const base = await readStaticStore()
		const live = await this.live().catch(() => ({}))
		// `id` must be truthy and stable: the storefront keys a cookie on it.
		return { ...base, ...live, id: base.id || 'gocommerce' }
	}

	async getStore(storeId?: string) {
		return this.getStoreByIdOrDomain({ storeId })
	}

	/**
	 * The storefront's sitemap route asks for `/api/stores/<id>` and serves the
	 * `sitemap` path it gets back from `PUBLIC_SITEMAP_URL`. With ext/sitemaps
	 * installed, `/sitemaps/sitemap.xml` under `PUBLIC_SITEMAP_URL=<engine>/x`
	 * is the engine's own sitemap; without it, an empty path is the route's
	 * clean 404 rather than a crash.
	 */
	override async get<T = any>(path: string): Promise<T> {
		if (path.split('?')[0].startsWith('/api/stores/')) {
			const on = await this.facts.pluginOn('sitemap')
			return { sitemap: on ? '/sitemaps/sitemap.xml' : '' } as T
		}
		return super.get<T>(path)
	}

	private async live(): Promise<Record<string, unknown>> {
		const [ready, plugins, menus, base] = await Promise.all([
			this.facts.ready(),
			this.facts.plugins().catch(() => new Map()),
			new MenuService(this._fetch).engineMenus(),
			readStaticStore(),
		])
		const code = ready.currency
		const sameCurrency = (base.currency?.code ?? base.currencyCode) === code
		const flag = (on: boolean) => ({ ...(on ? { active: true } : { active: false }) })
		const basePlugins = (base.plugins ?? {}) as Record<string, Record<string, unknown>>
		return {
			currencyCode: code,
			currencySymbol: sameCurrency ? (base.currencySymbol ?? symbolFor(code)) : symbolFor(code),
			currency: {
				...(base.currency ?? {}),
				code,
				symbol: sameCurrency ? (base.currency?.symbol ?? symbolFor(code)) : symbolFor(code),
			},
			language: ready.language,
			plugins: {
				...basePlugins,
				// Features this connector serves from a module: on exactly when the
				// module is installed and switched on, whatever the static record says.
				isWishlist: { ...basePlugins.isWishlist, ...flag(plugins.has('wishlist')) },
				isProductReviewsAndRatings: {
					...basePlugins.isProductReviewsAndRatings,
					...flag(plugins.has('product-reviews')),
				},
			},
			...(menus?.length ? { menu: menus } : {}),
		}
	}
}

export const storeService = new StoreService()
