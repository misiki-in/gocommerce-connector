import type { StorePassAnswer } from '../engine'
import { GoCommerceError } from '../errors'
import { readStaticStore } from '../static-store'
import { BaseService, mediaUrl } from './base.service'
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
 * Theme and the rest are the storefront's own (its static store, registered
 * through `setStaticStore`); the engine has no opinion on them. Where the
 * engine does have one, it wins:
 * - the store's name, contact, logo and icon, as its owner set them in the
 *   panel. One storefront serves every store under `baseDomain`, so a name or
 *   a logo in the static record would be every store's;
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
		const plugins = await this.facts.plugins().catch((err) => {
			if (store && isStoreMissing(err)) {
				throw new GoCommerceError(`store not found: no store "${store}" on this engine`, 404, 'store_not_found')
			}
			return undefined
		})
		const live = await this.live().catch(() => ({}))
		// `id` must be truthy and stable: the storefront keys a cookie on it.
		return { ...base, ...live, closed: closedOf(plugins), id: base.id || 'gocommerce' }
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

	/**
	 * A closed store's password (D170), traded for a pass. Never throws. The
	 * engine allows 20 tries an hour per client, and sees this server as the
	 * client unless `clientAddress`, the shopper's, travels as `X-Forwarded-For`.
	 */
	async unlockStore(password: string, { clientAddress }: { clientAddress?: string } = {}): Promise<StoreUnlock> {
		const typed = password.trim()
		if (!typed) return { outcome: 'wrong' }
		try {
			return { outcome: 'unlocked', pass: await this.storePass({ password: typed }, clientAddress) }
		} catch (err) {
			return { outcome: (err instanceof GoCommerceError && UNLOCK_REFUSED[err.status]) || 'unavailable' }
		}
	}

	/**
	 * A pass checked without spending a try: the pass, or null when it is wrong,
	 * expired, ended by a new password, or the store takes none now. Throws when
	 * the engine cannot say.
	 */
	async checkStorePass(token: string): Promise<StorePass | null> {
		if (!token) return null
		try {
			return await this.storePass({ token })
		} catch (err) {
			if (err instanceof GoCommerceError && (err.status === 422 || err.status === 404)) return null
			throw err
		}
	}

	private async storePass(body: { password: string } | { token: string }, clientAddress?: string): Promise<StorePass> {
		const answer = await this.data<StorePassAnswer | null>('/api/store/password', {
			method: 'POST',
			body,
			headers: clientAddress ? { 'X-Forwarded-For': clientAddress } : undefined,
		})
		const expiresAt = new Date(answer?.expires_at ?? NaN)
		if (!answer?.token || Number.isNaN(expiresAt.getTime())) {
			throw new GoCommerceError('The commerce engine answered a store pass without its token or expiry.', 200)
		}
		return { token: answer.token, expiresAt }
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
			// The store's pictures (D148), the same: one it has not chosen keeps the static one.
			// Its own logo also replaces the static dark logo, which would be the deployment's
			// mark beside this store's; without a dark one of its own, its logo is the fallback.
			...(profile?.logo_url ? { logo: mediaUrl(profile.logo_url), logoDark: undefined } : {}),
			...(profile?.logo_dark_url ? { logoDark: mediaUrl(profile.logo_dark_url) } : {}),
			...(profile?.icon_url ? { favicon: mediaUrl(profile.icon_url) } : {}),
			// What the contact page shows (D156), only what the store published. The address
			// in the shape the storefront's contact page and home-page JSON-LD already read. The
			// country beside it, not over `country`: that is the address form's default country.
			...(profile?.country ? { businessCountry: profile.country } : {}),
			...(profile?.address
				? {
						address: {
							street: [profile.address.line1, profile.address.line2].filter(Boolean).join(', '),
							city: profile.address.city,
							state: profile.address.state,
							pincode: profile.address.postal_code,
							country: profile.address.country,
						},
					}
				: {}),
			...(profile?.map_location ? { mapLocation: profile.map_location } : {}),
			...(profile?.opening_hours?.length ? { openingHours: profile.opening_hours } : {}),
			currencyCode: code,
			currencySymbol: sameCurrency ? (base.currencySymbol ?? symbolFor(code)) : symbolFor(code),
			currency: {
				...(base.currency ?? {}),
				code,
				symbol: sameCurrency ? (base.currency?.symbol ?? symbolFor(code)) : symbolFor(code),
				includesTax: profile?.prices_include_tax,
			},
			language: ready.language,
			plugins: {
				...basePlugins,
				// Features this connector serves from a module: on exactly when the
				// module is installed and switched on, whatever the static record says.
				isWishlist: { ...basePlugins.isWishlist, ...flag(plugins.has('wishlist')) },
				// The corner button and the contact page's WhatsApp card read the number from
				// here; the engine's plugin holds it, in international digits.
				whatsappChatButton: {
					...basePlugins.whatsappChatButton,
					...flag(plugins.has('whatsapp-chat')),
					...(plugins.has('whatsapp-chat')
						? {
								phone: String(plugins.get('whatsapp-chat')?.settings?.phone ?? ''),
								message: String(plugins.get('whatsapp-chat')?.settings?.message ?? ''),
							}
						: {}),
				},
				// Criteo's OneTag, for this store's own account. The engine decides: on a shared
				// deployment the static record is every store's, and one store's account must
				// never load on another's pages.
				criteo: {
					...basePlugins.criteo,
					...flag(plugins.has('criteo')),
					...(plugins.has('criteo') ? { accountId: String(plugins.get('criteo')?.settings?.account_id ?? '') } : {}),
				},
				isProductReviewsAndRatings: {
					...basePlugins.isProductReviewsAndRatings,
					...flag(plugins.has('product-reviews')),
				},
				// Google Customer Reviews (ext/google-reviews): the confirmation page's survey offer,
				// whose fields the engine builds from the order, and Google's store widget, which
				// belongs to the same programme and so needs the survey on.
				googleReviewsOptIn: {
					...basePlugins.googleReviewsOptIn,
					...flag(googleSetting(plugins, 'customer_reviews') === true),
				},
				googleStoreWidget: storeWidget(plugins),
				// The footer's sign-up box posts to ext/newsletter, and the theme editor's footer
				// switch (D131) can only show it while that is on.
				newsletter: { ...basePlugins.newsletter, ...flag(plugins.has('newsletter')) },
				// The ad and analytics tags (D160). The engine decides, not the static record:
				// one storefront serves every store, and one store's pixel must never
				// load on another's pages.
				...adTags(plugins),
				googleTagManager: googleTags(plugins),
				// Discount codes are core: every GoCommerce store takes them, so
				// the code box is shown whatever the static record says.
				isDiscountCoupons: { ...basePlugins.isDiscountCoupons, active: true },
				// The engine resizes the store's own pictures in Cloudflare's URL shape
				// (D139), so the storefront's srcset asks it for each width. Its public
				// origin, not the proxy path: an <img> needs no CORS, and the proxy would
				// put every picture through the storefront's server.
				...(profile?.images_path && this.creds.apiUrl
					? {
							imageCdn: {
								provider: 'cloudflare',
								url: this.creds.apiUrl.trim().replace(/\/+$/, '') + profile.images_path,
								active: true,
							},
						}
					: {}),
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

/** A store its owner closed (D170): the message to show, and whether a password lets a visitor in. */
export type StoreClosed = { message: string; password: boolean }

export type StorePass = { token: string; expiresAt: Date }

export type StoreUnlock =
	{ outcome: 'unlocked'; pass: StorePass } | { outcome: 'wrong' | 'throttled' | 'open' | 'unavailable' }

const UNLOCK_REFUSED: Partial<Record<number, 'wrong' | 'throttled' | 'open'>> = {
	422: 'wrong',
	429: 'throttled',
	404: 'open',
}

function closedOf(plugins: Map<string, { settings?: Record<string, unknown> }> | undefined): StoreClosed | undefined {
	const plugin = plugins?.get('store-close')
	if (!plugin) return undefined
	return { message: String(plugin.settings?.message ?? ''), password: plugin.settings?.password === true }
}

/** Each tag's engine plugin, the setting that holds its ID, and its name on the store record. */
const AD_TAGS = [
	['meta-pixel', 'pixel_id', 'facebookPixel'],
	['microsoft-clarity', 'project_id', 'microsoftClarity'],
	['hotjar', 'site_id', 'hotjar'],
	['tiktok-pixel', 'pixel_id', 'tiktokPixel'],
	['pinterest-tag', 'tag_id', 'pinterestTag'],
	['snapchat-pixel', 'pixel_id', 'snapchatPixel'],
] as const

/** On with its ID, or off with none, so a storefront has nothing to load by mistake. */
function adTags(plugins: Map<string, { settings?: Record<string, unknown> }>) {
	return Object.fromEntries(
		AD_TAGS.map(([key, field, name]) => {
			const id = String(plugins.get(key)?.settings?.[field] ?? '').trim()
			return [name, id ? { active: true, id } : { active: false }]
		}),
	)
}

/**
 * The google-analytics plugin in the shape the storefront has always read under
 * `googleTagManager`: its tag IDs, and the Ads conversion label as the purchase's
 * conversion. Off with no IDs when none is filled in.
 */
function googleTags(plugins: Map<string, { settings?: Record<string, unknown> }>) {
	const s = plugins.get('google-analytics')?.settings ?? {}
	const id = (field: string) => String(s[field] ?? '').trim()
	// Google Ads shows a conversion as `send_to: 'AW-…/label'`, and an owner may paste all of it.
	const [account, part] = id('conversion_label').split('/')
	const label = part === undefined ? account : part
	const ads = id('google_ads_id') || (part === undefined ? '' : account)
	const tags = [id('ga4_measurement_id'), ads, id('gtm_container_id')].filter(Boolean)
	if (!tags.length) return { active: false }
	return { active: true, tags, conversions: ads && label ? [{ event: 'purchase', label }] : [] }
}

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

const googleSetting = (plugins: Map<string, { settings?: Record<string, unknown> }>, key: string) =>
	plugins.get('google-reviews')?.settings?.[key]

/** Google's store widget, where the store placed it; off without the survey. */
function storeWidget(plugins: Map<string, { settings?: Record<string, unknown> }>) {
	const where = googleSetting(plugins, 'store_widget')
	if (googleSetting(plugins, 'customer_reviews') !== true || !where) return { active: false }
	return { active: true, position: where === 'Bottom left' ? 'LEFT_BOTTOM' : 'RIGHT_BOTTOM' }
}

/** The sign-in form's names for the store's choice (D116, D118). */
const LOGIN_TYPES: Record<string, string> = { phone_otp: 'PHONE', email_or_phone: 'BOTH', email_password: 'EMAIL' }
