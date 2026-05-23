import type { Menu, MenuItem } from '../engine'
import { resolveRestLocally } from '../rest-guard'
import { BaseService } from './base.service'
import { StoreFacts } from './facts'
import { remember } from '../cache'

export type StorefrontMenu = { menuId: string; name: string; items: StorefrontMenuItem[] }
type StorefrontMenuItem = { id: string; name: string; link: string; items: StorefrontMenuItem[] }

/**
 * A link where this storefront serves it. The navigation module resolves URLs
 * from its own patterns, whose defaults suit a different storefront; the
 * targets it names are slugs, so they are re-pointed at this one's routes.
 */
function linkFor(item: MenuItem): string {
	const t = item.target ?? ''
	switch (item.kind) {
		case 'home':
			return '/'
		case 'product':
			return t ? `/products/${t}` : item.url
		case 'collection':
			return t ? `/collections/${t}` : item.url
		case 'category':
			return t ? `/${t}` : item.url
		case 'page':
			return t ? `/p/${t}` : item.url
		default:
			return item.url
	}
}

const toItem = (item: MenuItem, i: number): StorefrontMenuItem => ({
	id: String(item.id ?? i),
	name: item.title,
	link: linkFor(item),
	items: (item.children ?? []).map(toItem),
})

/**
 * Menus from ext/navigation, when it is installed and switched on; otherwise
 * the storefront's own `store.menu`, which is what it shows anyway.
 */
export class MenuService extends BaseService {
	private readonly facts = new StoreFacts(this._fetch)

	async list(_args: Record<string, unknown> = {}) {
		const menus = await this.engineMenus()
		if (menus) return { data: menus }
		return resolveRestLocally('get', '/api/menu')
	}

	/** The header and footer menus, or `null` when the module is not there. Cached: a menu is store-level. */
	async engineMenus(): Promise<StorefrontMenu[] | null> {
		if (!(await this.facts.pluginOn('navigation'))) return null
		return remember(`${this.engineBase()}|${this.creds.store ?? ''}|menus`, async () => {
			const out: StorefrontMenu[] = []
			for (const handle of ['header', 'footer']) {
				try {
					const m = await this.data<Menu>(`/x/navigation/menus/${handle}`)
					out.push({ menuId: handle, name: m.title, items: (m.items ?? []).map(toItem) })
				} catch {
					// A store may have deleted one of the two.
				}
			}
			return out
		}).catch(() => null)
	}
}

export const menuService = new MenuService()
