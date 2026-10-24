import { GoCommerceError } from '../errors'
import { readStaticStore } from '../static-store'
import { BaseService } from './base.service'
import { StoreFacts } from './facts'
import { MenuService } from './menu-service'
import { NewsletterService } from './newsletter-service'

/**
 * The engine's "no such store" answer to an `X-Store` it cannot resolve, and
 * nothing else: a 404 for a product or a page is a different question.
 */
const isStoreMissing = (err: unknown) =>
	err instanceof GoCommerceError &&
	err.status === 404 &&
	(err.code === 'store_not_found' || /store not found|no such store/i.test(err.message))

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
 * Logo, theme and the rest are the storefront's own (its static store,
 * registered through `setStaticStore`); the engine has no opinion on them.
 * Where the engine does have one, it wins:
 * - the store's name and contact, as its owner set them in the panel. One
 *   storefront serves every store under `baseDomain`, so a name in the static
 *   record would be every store's name;
 * - the settlement currency. Every price on the site is formatted with it, and
 *   a store record saying USD over an engine charging INR would print the
 *   wrong symbol on every price;
 * - the modules that back a storefront feature, and the menus.
 *
 * This runs on every request and a throw here takes every page down, so the
 * engine's half is best-effort: unreachable, the storefront still renders
 * from its own record, and the failure shows up where a price is fetched.
 */
export class StoreService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	async getStoreByIdOrDomain(_args: { storeId?: string; domain?: string } = {}) {
		const base = await readStaticStore()
		// The one failure that is not best-effort: a host under `baseDomain` naming
		// a store the engine has never heard of. That page is a 404, not a render
		// of the static record, so the storefront's 404 route can take it from here.
		const store = this.store
		if (store) {
			await this.facts.plugins().catch((err) => {
				if (isStoreMissing(err)) {
					throw new GoCommerceError(`store not found: no store "${store}" on this engine`, 404, 'store_not_found')
				}
			})
		}
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

	/**
	 * The storefront's newsletter box posts `{ email }` to Litekart's
	 * `/api/newsletter/subscribe` through this verb; ext/newsletter is where
	 * that list lives here.
	 */
	override async post<T = any>(path: string, data?: unknown): Promise<T> {
		if (path.split('?')[0] === '/api/newsletter/subscribe') {
			const { email, name } = (data ?? {}) as { email?: string; name?: string }
			return (await new NewsletterService(this._fetch).subscribe({
				email: email ?? '',
				name,
				source: 'storefront',
			})) as T
		}
		return super.post<T>(path, data)
	}

	private async live(): Promise<Record<string, unknown>> {
		const [ready, plugins, menus, base, profile, ships] = await Promise.all([
			this.facts.ready(),
			this.facts.plugins().catch(() => new Map()),
			new MenuService(this._fetch).engineMenus(),
			readStaticStore(),
			this.facts.profile().catch(() => null),
			// An engine without the route rules nothing out.
			this.facts.shipsTo().catch(() => ({ everywhere: true, countries: [] as string[] })),
		])
		const code = ready.currency
		const sameCurrency = (base.currency?.code ?? base.currencyCode) === code
		const flag = (on: boolean) => ({ ...(on ? { active: true } : { active: false }) })
		const basePlugins = (base.plugins ?? {}) as Record<string, Record<string, unknown>>
		return {
			// Only what the owner filled in: an empty name keeps the static one.
			...(profile?.name ? { name: profile.name } : {}),
			...(profile?.email ? { businessEmail: profile.email } : {}),
			...(profile?.phone ? { businessPhone: profile.phone } : {}),
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
			...deliverable(base, ships),
			// The one way this store signs customers in (D116), which the sign-in
			// form reads as PHONE or EMAIL. Without the accounts module the static
			// record says.
			...(plugins.has('identity')
				? { loginType: LOGIN_TYPES[String(plugins.get('identity')?.settings?.login_method)] ?? 'EMAIL' }
				: {}),
		}
	}
}

export const storeService = new StoreService()

type Country = { code: string; name: string; [k: string]: unknown }

/**
 * The address form's countries narrowed to where the store delivers (D117).
 * Each keeps the static record's entry, which may carry more than a name; a
 * country the record lacks is named by the browser's own list. One country is
 * also the default, and so is the first when the static default is not one of
 * them. Everywhere changes nothing.
 */
function deliverable(
	base: { country?: Country; countries?: Country[] },
	ships: { everywhere: boolean; countries: string[] },
): { countries?: Country[]; country?: Country } {
	if (ships.everywhere || !ships.countries.length) return {}
	const known = new Map((base.countries ?? []).map((c) => [String(c.code).toUpperCase(), c]))
	const countries = ships.countries.map((code) => known.get(code) ?? { code, name: regionName(code) })
	const keep = base.country && ships.countries.includes(String(base.country.code).toUpperCase())
	return { countries, ...(keep ? {} : { country: countries[0] }) }
}

function regionName(code: string): string {
	try {
		return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
	} catch {
		return code
	}
}

/** The sign-in form's names for the store's choice (D116, D118). */
const LOGIN_TYPES: Record<string, string> = { phone_otp: 'PHONE', email_or_phone: 'BOTH', email_password: 'EMAIL' }
