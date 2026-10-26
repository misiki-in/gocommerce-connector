import type { Product } from '../engine'
import { GoCommerceError } from '../errors'
import { toProduct, type StorefrontProduct } from '../map'
import { BaseService, mediaUrl } from './base.service'

/** One section as the engine stores it, before the storefront maps anything. */
type EngineLayoutSection = {
	id: string
	type: string
	settings: Record<string, unknown> | null
	products?: Product[] | null
}

type EngineLayout = {
	page: string
	theme: string
	revision?: number
	preview?: boolean
	sections: EngineLayoutSection[] | null
}

/**
 * One section of a composed page. `settings` is the merchant's, as validated
 * by the engine: plain text (never HTML) and links that are `/path` or
 * `http(s)://`. A product grid also carries its products, resolved live and
 * mapped like any other product the storefront renders.
 */
export type HomeLayoutSection = {
	id: string
	type: string
	settings: Record<string, unknown>
	products?: StorefrontProduct[]
}

export type HomeLayout = {
	page: string
	theme: string
	/** The published revision this is; absent on a preview. */
	revision?: number
	/** True when this is the saved draft shown through a preview key. */
	preview: boolean
	sections: HomeLayoutSection[]
}

/** Settings that hold a picture's address, which may be the engine's own upload. */
const IMAGE_KEYS = ['image', 'mobile_image']

/**
 * Composed pages from ext/layouts. A store without one — the plugin off,
 * nothing published, an engine built without the module, or a preview key
 * that is wrong or expired — answers null, and the storefront renders its
 * built-in page.
 */
export class LayoutService extends BaseService {
	async getHomeLayout({ preview }: { preview?: string | null } = {}): Promise<HomeLayout | null> {
		let layout: EngineLayout
		try {
			layout = await this.data<EngineLayout>('/x/layouts/home', {
				query: { preview: preview?.trim() || undefined },
			})
		} catch (err) {
			if (err instanceof GoCommerceError && err.status === 404) return null
			throw err
		}
		if (!layout) return null
		return {
			page: layout.page,
			theme: layout.theme,
			revision: layout.revision,
			preview: !!layout.preview,
			sections: (layout.sections ?? []).map(toSection),
		}
	}
}

function toSection(s: EngineLayoutSection): HomeLayoutSection {
	const settings: Record<string, unknown> = { ...(s.settings ?? {}) }
	// An upload is answered root-relative, which the shopper's browser would
	// resolve against the storefront rather than the engine.
	for (const key of IMAGE_KEYS) {
		if (typeof settings[key] === 'string') settings[key] = mediaUrl(settings[key] as string)
	}
	const out: HomeLayoutSection = { id: s.id, type: s.type, settings }
	if (s.type === 'product-grid') out.products = (s.products ?? []).map((p) => toProduct(p))
	return out
}

export const layoutService = new LayoutService()
