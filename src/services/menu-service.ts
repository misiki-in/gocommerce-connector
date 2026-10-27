import type { Menu, MenuItem, MenuSummary } from '../engine'
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

	/** Every menu the store keeps, by handle — not only the header and footer. */
	async listMenus() {
		return (await this.data<MenuSummary[] | null>('/x/navigation/menus')) ?? []
	}

	/** One menu by handle, in the storefront's shape: `{ menuId, name, items: [{ id, name, link, items }] }`. */
	async getMenu(handle: string): Promise<StorefrontMenu> {
		const m = await this.data<Menu>(`/x/navigation/menus/${encodeURIComponent(handle)}`)
		return { menuId: m.handle, name: m.title, items: (m.items ?? []).map(toItem) }
	}

	/**
	 * The header and footer menus, or `null` when the module is not there. Cached: a menu is
	 * store-level. Each is the menu the shop chose for it in the theme editor's header or footer
	 * (GoCommerce D131), still under the `header` / `footer` id every storefront looks for, so the
	 * choice reaches every place that draws one; the menus named so are the default.
	 */
	async engineMenus(): Promise<StorefrontMenu[] | null> {
		if (!(await this.facts.pluginOn('navigation'))) return null
		return remember(`${this.engineBase()}|${this.store ?? ''}|menus`, async () => {
			const out: StorefrontMenu[] = []
			for (const part of ['header', 'footer'] as const) {
				try {
					const handle = await this.chosenMenu(part)
					const m = await this.data<Menu>(`/x/navigation/menus/${encodeURIComponent(handle)}`)
					out.push({ menuId: part, name: m.title, items: (m.items ?? []).map(toItem) })
				} catch {
					// A store may have deleted one of the two.
				}
			}
			return out
		}).catch(() => null)
	}

	/** The handle of the menu the published header or footer names, else the part's own name. */
	private async chosenMenu(part: 'header' | 'footer'): Promise<string> {
		if (!(await this.facts.pluginOn('layouts'))) return part
		try {
			const layout = await this.data<{ sections?: { type: string; settings?: { menu?: unknown } | null }[] | null }>(`/x/layouts/${part}`)
			const menu = layout?.sections?.find((s) => s.type === part)?.settings?.menu
			return typeof menu === 'string' && menu ? menu : part
		} catch {
			// Nothing published, or an engine without the editor.
			return part
		}
	}
}

export const menuService = new MenuService()
