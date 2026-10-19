import { remember } from '../cache'
import type { Category, CheckoutOptions, Plugin, StoreProfile } from '../engine'
import { BaseService } from './base.service'

/**
 * Store-level questions several services ask, answered once a minute.
 *
 * Not exported from the package: it is plumbing the other services share.
 */
export class StoreFacts extends BaseService {
	private key(name: string) {
		return `${this.engineBase()}|${this.store ?? ''}|${this.language ?? ''}|${name}`
	}

	/**
	 * The pages GET /x/layouts/{page} answers for this store, from the theme
	 * answer's `pages` (GoCommerce #367), remembered half a minute as the
	 * engine caches it. A page not on it is not asked for: a store that
	 * arranged no product page used to cost every product page a 404 in the
	 * shopper's console, and the header and footer the same. Null, and every
	 * page asked for as before, from an engine that sends no list or when the
	 * theme cannot be read.
	 */
	layoutPages(): Promise<Set<string> | null> {
		return remember(
			this.key('layout-pages'),
			async () => {
				try {
					const out = await this.data<{ pages?: unknown } | null>('/x/layouts/theme')
					return Array.isArray(out?.pages) ? new Set(out.pages.map(String)) : null
				} catch {
					return null
				}
			},
			30_000,
		)
	}

	/** Enabled plugins by key. A module that is not installed has no key here. */
	plugins(): Promise<Map<string, Plugin>> {
		return remember(this.key('plugins'), async () => {
			const list = (await this.data<Plugin[] | null>('/api/plugins')) ?? []
			return new Map(list.map((p) => [p.key, p]))
		})
	}

	async pluginOn(key: string): Promise<boolean> {
		try {
			return (await this.plugins()).has(key)
		} catch {
			return false
		}
	}

	/**
	 * The store's settlement currency and default language, from routes bound
	 * to the store: `/health/ready` answers for the install, so on a shared
	 * engine every store read as the install's currency.
	 */
	ready(): Promise<{ currency: string; language: string }> {
		return remember(this.key('ready'), async () => {
			const [{ currency }, { language }] = await Promise.all([this.checkoutOptions(), this.profile()])
			return { currency, language }
		})
	}

	/** The store's own name and how a buyer reaches it, as set in its panel. */
	profile(): Promise<StoreProfile> {
		return remember(this.key('profile'), () => this.data<StoreProfile>('/api/store'))
	}

	/** Where the store delivers (D117): its priced zones' countries, or everywhere. */
	shipsTo(): Promise<{ everywhere: boolean; countries: string[] }> {
		return remember(this.key('ships-to'), async () => {
			const r = await this.data<{ everywhere: boolean; countries: string[] } | null>('/api/checkout/countries')
			return { everywhere: r?.everywhere ?? true, countries: r?.countries ?? [] }
		})
	}

	checkoutOptions(): Promise<CheckoutOptions> {
		return remember(this.key('checkout'), () => this.data<CheckoutOptions>('/api/checkout'))
	}

	/**
	 * The whole tree, flat and depth-first. Past 500 categories the engine
	 * answers a truncated list; the tree then serves what it has, and a
	 * breadcrumb for a category outside it falls back to the category alone.
	 */
	categories(): Promise<Category[]> {
		return remember(
			this.key('categories'),
			async () => (await this.data<Category[] | null>('/api/categories', { query: { flat: 1 } })) ?? [],
		)
	}

	/** Root → `slug`, by walking parents in the flat tree. */
	async hierarchy(slug: string): Promise<{ name: string; slug: string }[]> {
		const all = await this.categories().catch(() => [] as Category[])
		const byId = new Map(all.map((c) => [c.id, c]))
		const out: { name: string; slug: string }[] = []
		let c = all.find((x) => x.slug === slug)
		while (c) {
			out.unshift({ name: c.title, slug: c.slug })
			c = c.parent_id === null ? undefined : byId.get(c.parent_id)
		}
		return out
	}

	/** `slug` and every category under it — what a category page sells. */
	async subtree(slug: string): Promise<Category[]> {
		const all = await this.categories()
		const root = all.find((c) => c.slug === slug)
		if (!root) return []
		const ids = new Set([root.id])
		const out = [root]
		// Depth-first and flat, so a parent always precedes its children.
		for (const c of all) {
			if (c.parent_id !== null && ids.has(c.parent_id) && !ids.has(c.id)) {
				ids.add(c.id)
				out.push(c)
			}
		}
		return out
	}
}
